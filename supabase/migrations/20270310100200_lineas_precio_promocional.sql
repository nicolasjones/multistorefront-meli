-- MSF-816 / F-1 (spec 20261113-120000-precio-promocional-en-pos-y-comprobantes, FR-004, FR-005, FR-006, FR-015):
-- `guardar_lineas_comprobante` cobra con la función única de precio y guarda el snapshot; `obtener_comprobante`
-- expone `precio_referencia`.
--
-- Esquema (Principio VII): sin tablas nuevas. Escriben/leen `dominio.comprobantes_venta_lineas` (dominio) con las
-- columnas `precio_referencia` y `promocion_id` de 20270310100000; las funciones viven en `public` (superficie
-- expuesta) y no almacenan datos.
--
-- Cambios sobre los cuerpos VIGENTES (misma firma, `security definer`, `search_path = ''`, mismos grants):
--   · `public.guardar_lineas_comprobante` (cuerpo de 20270201200129, con `descuento_pct` y `sin_stock`):
--       - el precio sale de `private.precio_linea_venta` (reemplaza `precio_para` + `round(neto × (1 − d/100), 2)`):
--         con la bandera `promociones_precio` APAGADA da exactamente lo mismo que antes;
--       - el instante es `clock_timestamp()` tomado DESPUÉS del `for update` del comprobante;
--       - la línea guarda `precio_referencia` y `promocion_id` solo si ganó la promoción; con precio manual van
--         nulos y `descuento_pct = 0` (manual manda siempre); si ganó la promoción `descuento_pct = 0`
--         (el descuento no se aplicó);
--       - las claves `precio_referencia`/`promocion_id` dentro de `p_lineas` se IGNORAN (la RPC solo lee
--         `producto_id`, `cantidad`, `deposito_id` y `precio_manual`).
--   · `public.obtener_comprobante` (cuerpo de 20270201200132): cada línea suma `precio_referencia`; NO expone
--     `promocion_id` (un rol de ventas sin `productos` no debe recibir el id de una promoción que no puede leer).
--
-- Migración aditiva. Pasa `node scripts/verificar-migraciones.mjs --estricto` y el guard de DDL.
-- Reversión (migración posterior): restaurar `public.guardar_lineas_comprobante` de 20270201200129 y
-- `public.obtener_comprobante` de 20270201200132.

create or replace function public.guardar_lineas_comprobante(
  p_id uuid,
  p_lineas jsonb,
  p_actualizado_en timestamptz
)
returns dominio.comprobantes_venta
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_c dominio.comprobantes_venta;
  v_fila dominio.comprobantes_venta;
  v_tipo_cliente text;
  v_descuento numeric := 0;
  v_defecto uuid;
  v_puede_precio boolean;
  v_previas jsonb;
  v_elem jsonb;
  v_orden integer := 0;
  v_base integer := 0;
  v_texto text;
  v_producto dominio.productos;
  v_cantidad integer;
  v_deposito uuid;
  v_manual numeric;
  v_precio record;
  v_ahora timestamptz;
  v_unitario numeric;
  v_porcentaje numeric;
  v_subtotal numeric;
  v_iva numeric;
  v_total_sin numeric := 0;
  v_total_iva numeric := 0;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para editar comprobantes' using errcode = '42501';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'Las líneas deben ser una lista' using errcode = '22023', hint = 'lineas';
  end if;
  if jsonb_array_length(p_lineas) > 200 then
    raise exception 'Un comprobante admite hasta 200 líneas' using errcode = '22023', hint = 'lineas';
  end if;

  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org
   for update;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
  -- MSF-816 (FR-002, R3c): el instante del precio se toma DESPUÉS del bloqueo del comprobante (no el `now()` del
  -- inicio de la transacción): una promoción que vence mientras se esperaba el bloqueo no se cobra.
  v_ahora := clock_timestamp();
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede editar comprobantes de esta tienda' using errcode = '42501';
  end if;
  if not ((v_c.tipo = 'factura' and v_c.estado = 'borrador')
       or (v_c.tipo = 'presupuesto' and v_c.estado = 'pendiente')) then
    raise exception 'El comprobante ya está cerrado y no se puede modificar' using errcode = '55000';
  end if;
  if p_actualizado_en is distinct from v_c.updated_at then
    raise exception 'Otra persona modificó este comprobante. Recargalo para ver los cambios' using errcode = '40001';
  end if;

  -- F-VTA-32 (MSF-340): el descuento sale de la ficha del cliente en el servidor, nunca del payload.
  select cl.tipo, coalesce(cl.descuento, 0) into v_tipo_cliente, v_descuento
    from public.clientes cl
   where cl.id = v_c.cliente_id and cl.organizacion_id = v_org;
  select d.id into v_defecto
    from dominio.depositos d
    join dominio.depositos_empresas de on de.deposito_id = d.id and de.empresa_id = v_c.empresa_id
   where d.organizacion_id = v_org and d.por_defecto and d.activo;
  v_puede_precio := (select private.puede_editar_precio_en_empresa(v_c.empresa_id));

  -- Precios manuales ya guardados: un re-guardado sin permiso no puede perderlos ni cambiarlos.
  select coalesce(jsonb_agg(jsonb_build_object('producto_id', l.producto_id, 'precio', l.precio_unitario)), '[]'::jsonb)
    into v_previas
    from dominio.comprobantes_venta_lineas l
   where l.comprobante_id = v_c.id and l.precio_manual;

  -- Las líneas sin_stock (de Service) no se editan acá: se conservan y suman a los totales.
  delete from dominio.comprobantes_venta_lineas where comprobante_id = v_c.id and not sin_stock;
  select coalesce(max(l.orden), 0), coalesce(sum(l.subtotal_sin_iva), 0), coalesce(sum(l.iva), 0)
    into v_base, v_total_sin, v_total_iva
    from dominio.comprobantes_venta_lineas l
   where l.comprobante_id = v_c.id and l.organizacion_id = v_org;

  for v_elem in select e.value from jsonb_array_elements(p_lineas) as e(value) loop
    v_orden := v_orden + 1;
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception 'La línea % no es válida', v_orden using errcode = '22023', hint = 'lineas';
    end if;

    -- Producto: de la organización y activo (FR-011).
    v_texto := v_elem ->> 'producto_id';
    begin
      select * into v_producto
        from dominio.productos p
       where p.id = v_texto::uuid and p.organizacion_id = v_org and p.activo;
    exception when invalid_text_representation then
      raise exception 'La línea % tiene un producto inválido', v_orden using errcode = '22023', hint = 'producto_id';
    end;
    if not found then
      raise exception 'La línea % tiene un producto que no existe o está inactivo', v_orden
        using errcode = '22023', hint = 'producto_id';
    end if;

    -- Cantidad entera mayor a cero (FR-011).
    v_texto := v_elem ->> 'cantidad';
    if v_texto is null or v_texto !~ '^[0-9]{1,7}$' or v_texto::integer < 1 then
      raise exception 'La cantidad de la línea % debe ser un entero mayor a cero', v_orden
        using errcode = '22023', hint = 'cantidad';
    end if;
    v_cantidad := v_texto::integer;

    -- Depósito de salida (FR-011, FR-013): de la organización y activo; sin elegir, el principal.
    v_texto := v_elem ->> 'deposito_id';
    if v_texto is null then
      v_deposito := v_defecto;
    else
      begin
        v_deposito := v_texto::uuid;
      exception when invalid_text_representation then
        raise exception 'La línea % tiene un depósito inválido', v_orden using errcode = '22023', hint = 'deposito_id';
      end;
    end if;
    if v_deposito is null or not exists (
      select 1 from dominio.depositos d where d.id = v_deposito and d.organizacion_id = v_org and d.activo
    ) then
      raise exception 'La línea % tiene un depósito que no existe o está inactivo', v_orden
        using errcode = '22023', hint = 'deposito_id';
    end if;
    if not exists (
      select 1 from dominio.depositos_empresas de
       where de.deposito_id = v_deposito and de.empresa_id = v_c.empresa_id and de.organizacion_id = v_org
    ) then
      raise exception 'La línea % tiene un depósito desde el que esta tienda no vende', v_orden
        using errcode = '22023', hint = 'deposito_id';
    end if;

    -- Precio manual (FR-016): número >= 0, solo con permiso o si ya estaba guardado igual.
    v_manual := null;
    if v_elem ? 'precio_manual' and jsonb_typeof(v_elem -> 'precio_manual') <> 'null' then
      if jsonb_typeof(v_elem -> 'precio_manual') <> 'number' then
        raise exception 'El precio de la línea % debe ser un número de cero o más', v_orden
          using errcode = '22023', hint = 'precio_manual';
      end if;
      v_manual := round((v_elem ->> 'precio_manual')::numeric, 2);
      if v_manual < 0 or v_manual >= 1000000000000 then
        raise exception 'El precio de la línea % debe ser un número de cero o más', v_orden
          using errcode = '22023', hint = 'precio_manual';
      end if;
      if not v_puede_precio and not exists (
        select 1 from jsonb_array_elements(v_previas) q
         where (q.value ->> 'producto_id')::uuid = v_producto.id and (q.value ->> 'precio')::numeric = v_manual
      ) then
        raise exception 'Tu rol no puede editar precios' using errcode = '42501', hint = 'precio_manual';
      end if;
    end if;

    -- Precio, escala e IVA (FR-014, FR-015): los calcula el servidor con la función única de precio de línea
    -- (MSF-816): escala/propio/lista con el descuento del cliente, o la promoción vigente de la tienda del
    -- comprobante si es menor (sin acumular). El precio manual manda siempre y no lleva referencia.
    select * into v_precio
      from private.precio_linea_venta(v_producto.id, v_c.empresa_id, v_tipo_cliente, v_cantidad, v_descuento, v_ahora);
    if not found then
      raise exception 'No pudimos calcular el precio de la línea %', v_orden using errcode = '22023', hint = 'producto_id';
    end if;
    v_unitario := coalesce(v_manual, v_precio.neto_unitario);
    if v_unitario is null then
      raise exception 'El producto de la línea % no tiene precio en pesos (falta la cotización del dólar)', v_orden
        using errcode = '22023', hint = 'producto_id';
    end if;
    v_porcentaje := case when v_precio.alicuota_exenta then 0 else coalesce(v_precio.alicuota_porcentaje, 0) end;
    v_subtotal := round(v_unitario * v_cantidad, 2);
    if v_subtotal >= 1000000000000 then
      raise exception 'El importe de la línea % es demasiado grande', v_orden using errcode = '22023', hint = 'cantidad';
    end if;
    v_iva := round(v_subtotal * v_porcentaje / 100, 2);

    insert into dominio.comprobantes_venta_lineas (
      organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad, precio_unitario, escala,
      precio_manual, alicuota_id, alicuota_porcentaje, deposito_id, a_pedido, subtotal_sin_iva, iva,
      descuento_pct, precio_referencia, promocion_id
    )
    values (
      v_org, v_c.id, v_base + v_orden, v_producto.id, v_producto.nombre, v_producto.sku, v_cantidad, v_unitario,
      v_precio.escala_usada, v_manual is not null, v_precio.alicuota_id, v_porcentaje, v_deposito,
      v_producto.disponibilidad_manual is not distinct from 'a_pedido', v_subtotal, v_iva,
      case when v_manual is null then v_precio.descuento_aplicado else 0 end,
      case when v_manual is null then v_precio.precio_referencia end,
      case when v_manual is null then v_precio.promocion_id end
    );

    v_total_sin := v_total_sin + v_subtotal;
    v_total_iva := v_total_iva + v_iva;
  end loop;

  if v_total_sin + v_total_iva >= 1000000000000 then
    raise exception 'El total del comprobante es demasiado grande' using errcode = '22023', hint = 'lineas';
  end if;

  update dominio.comprobantes_venta
     set total_sin_iva = v_total_sin,
         total_con_iva = v_total_sin + v_total_iva,
         updated_at = clock_timestamp()
   where id = v_c.id
  returning * into v_fila;

  perform private.registrar_actividad(
    'comprobante.editado',
    format('Actualizó las líneas de %s %s', case v_fila.tipo when 'factura' then 'la factura' else 'el presupuesto' end, v_fila.numero),
    v_fila.empresa_id
  );
  return v_fila;
end;
$$;

revoke execute on function public.guardar_lineas_comprobante(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.guardar_lineas_comprobante(uuid, jsonb, timestamptz) to authenticated;

comment on function public.guardar_lineas_comprobante(uuid, jsonb, timestamptz) is
  'Reemplaza las líneas de catálogo de un comprobante editable en una transacción y recalcula subtotal, IVA y total (F-VTA-06). Precio y escala los calcula private.precio_linea_venta (promoción vigente de la tienda si es menor, MSF-816); precio_manual exige editar_precio. Contrato en docs/ventas-comprobantes.md.';

create or replace function public.obtener_comprobante(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_c dominio.comprobantes_venta;
  v_nivel text;
  v_resultado jsonb;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver comprobantes' using errcode = '42501';
  end if;
  select * into v_c from dominio.comprobantes_venta c where c.id = p_id and c.organizacion_id = v_org;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
  v_nivel := (select private.nivel_ventas_en_empresa(v_c.empresa_id));
  if v_nivel not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver comprobantes de esta tienda' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', v_c.id,
    'tipo', v_c.tipo,
    'numero', v_c.numero,
    'estado', v_c.estado,
    'empresa_id', v_c.empresa_id,
    'empresa', e.nombre,
    'cliente', jsonb_build_object(
      'id', cl.id,
      'nombre', cl.nombre,
      'documento', cl.documento,
      'direccion', nullif(btrim(concat_ws(', ', nullif(cl.direccion, ''), nullif(cl.localidad, ''), nullif(cl.provincia, ''))), ''),
      'tipo', cl.tipo,
      'es_consumidor_final', cl.es_consumidor_final
    ),
    'canal', v_c.canal,
    'fecha', v_c.fecha,
    'valido_hasta', v_c.valido_hasta,
    'operador_id', v_c.operador_id,
    'operador', coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), 'Usuario sin nombre'),
    'forma_pago_id', v_c.forma_pago_id,
    'envio_id', v_c.envio_id,
    'origen_tipo', v_c.origen_tipo,
    'origen_id', v_c.origen_id,
    'origen_numero', case when v_c.origen_tipo = 'reparacion'
        and (select private.nivel_seccion('service_tecnico')) in ('lectura', 'edicion') then (
      select private.codigo_reparacion(r.numero) from dominio.reparaciones r
       where r.id = v_c.origen_id and r.organizacion_id = v_org) end,
    'lineas', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', l.id,
          'orden', l.orden,
          'producto_id', l.producto_id,
          'descripcion', l.descripcion,
          'codigo', l.codigo,
          'cantidad', l.cantidad,
          'precio_unitario', l.precio_unitario,
          'escala', l.escala,
          'precio_manual', l.precio_manual,
          'descuento_pct', l.descuento_pct,
          'precio_referencia', l.precio_referencia,
          'alicuota_porcentaje', l.alicuota_porcentaje,
          'deposito_id', l.deposito_id,
          'deposito', d.nombre,
          'a_pedido', l.a_pedido,
          'sin_stock', l.sin_stock,
          'stock', coalesce(x.cantidad, 0),
          'reservado', coalesce(x.reservado, 0),
          'subtotal_sin_iva', l.subtotal_sin_iva,
          'iva', l.iva
        )
        order by l.orden
      )
      from dominio.comprobantes_venta_lineas l
      left join dominio.depositos d on d.id = l.deposito_id and d.organizacion_id = l.organizacion_id
      left join dominio.existencias_deposito x
        on x.producto_id = l.producto_id and x.deposito_id = l.deposito_id and x.organizacion_id = l.organizacion_id
      where l.comprobante_id = v_c.id and l.organizacion_id = v_org
    ), '[]'::jsonb),
    'total_sin_iva', v_c.total_sin_iva,
    'iva', v_c.total_con_iva - v_c.total_sin_iva,
    'total_con_iva', v_c.total_con_iva,
    'editable', ((v_c.tipo = 'factura' and v_c.estado = 'borrador') or (v_c.tipo = 'presupuesto' and v_c.estado = 'pendiente')),
    'puede_editar', v_nivel = 'edicion',
    'puede_editar_precio', v_nivel = 'edicion' and (select private.puede_editar_precio_en_empresa(v_c.empresa_id)),
    'updated_at', v_c.updated_at
  )
  into v_resultado
  from dominio.empresas e
  join public.clientes cl on cl.id = v_c.cliente_id and cl.organizacion_id = v_org
  left join public.perfiles_usuario p on p.user_id = v_c.operador_id
  where e.id = v_c.empresa_id;

  return v_resultado;
end;
$$;

revoke execute on function public.obtener_comprobante(uuid) from public, anon;
grant execute on function public.obtener_comprobante(uuid) to authenticated;

comment on function public.obtener_comprobante(uuid) is
  'F-SVC-13: además de los datos del comprobante, expone el origen (origen_tipo, origen_id, origen_numero «R-000N») y la marca sin_stock de cada línea. MSF-816: cada línea suma precio_referencia (null sin promoción; no expone promocion_id). Cambio aditivo.';
