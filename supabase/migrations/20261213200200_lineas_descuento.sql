-- F-VTA-32 (MSF-340, épica MSF-193, spec 20261027-100000-ventas-mejoras, FR-011, FR-013): el precio de
-- una línea aplica el descuento del cliente sobre el neto de escala.
--
-- Esquema (Principio VII, re-verificado): `dominio.comprobantes_venta_lineas` es dominio; solo se agrega la
-- columna `descuento_pct` (qué descuento se aplicó, para mostrarlo y que lo ya vendido no cambie si luego
-- cambia la ficha). Sin tablas nuevas; RLS vigente.
--
-- `guardar_lineas_comprobante`: MISMA firma y mismo retorno (sin BREAKING). El descuento se lee de
-- `public.clientes` del comprobante en el servidor (nunca del payload): precio = round(neto de escala *
-- (1 - descuento / 100), 2), antes del IVA. Un `precio_manual` no se altera y su línea guarda 0 %.
-- `obtener_comprobante`: mismo cuerpo que 20261203200300; la línea suma la clave `descuento_pct`.
--
-- Migración aditiva. Reversión (migración posterior): restaurar `public.guardar_lineas_comprobante` y
-- `public.obtener_comprobante` de 20261203200300_lineas_rpc.sql y luego
--   alter table dominio.comprobantes_venta_lineas drop column descuento_pct;

alter table dominio.comprobantes_venta_lineas
  add column if not exists descuento_pct numeric(5, 2) not null default 0
    check (descuento_pct >= 0 and descuento_pct <= 100);

comment on column dominio.comprobantes_venta_lineas.descuento_pct is
  'F-VTA-32: porcentaje de descuento del cliente aplicado al neto de escala al calcular la línea (0 si no hubo o si el precio es manual).';

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
  v_texto text;
  v_producto dominio.productos;
  v_cantidad integer;
  v_deposito uuid;
  v_manual numeric;
  v_precio record;
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

  -- F-VTA-32: el descuento sale de la ficha del cliente en el servidor, nunca del payload.
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

  delete from dominio.comprobantes_venta_lineas where comprobante_id = v_c.id;

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

    -- Precio, escala e IVA (FR-014, FR-015): los calcula el servidor.
    select * into v_precio
      from private.precio_para(v_producto.id, v_c.empresa_id, private.escala_para_linea(v_tipo_cliente, v_cantidad));
    if not found then
      raise exception 'No pudimos calcular el precio de la línea %', v_orden using errcode = '22023', hint = 'producto_id';
    end if;
    -- El descuento aplica solo sobre el neto de escala, antes del IVA; un precio manual no se toca.
    v_unitario := coalesce(v_manual, round(v_precio.neto * (1 - v_descuento / 100), 2));
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
      descuento_pct
    )
    values (
      v_org, v_c.id, v_orden, v_producto.id, v_producto.nombre, v_producto.sku, v_cantidad, v_unitario,
      v_precio.escala_usada, v_manual is not null, v_precio.alicuota_id, v_porcentaje, v_deposito,
      v_producto.disponibilidad_manual is not distinct from 'a_pedido', v_subtotal, v_iva,
      case when v_manual is null then v_descuento else 0 end
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

revoke execute on function public.guardar_lineas_comprobante(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.guardar_lineas_comprobante(uuid, jsonb, timestamptz) to authenticated;

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
          'alicuota_porcentaje', l.alicuota_porcentaje,
          'deposito_id', l.deposito_id,
          'deposito', d.nombre,
          'a_pedido', l.a_pedido,
          'stock', coalesce(x.cantidad, 0),
          'reservado', coalesce(x.reservado, 0),
          'subtotal_sin_iva', l.subtotal_sin_iva,
          'iva', l.iva
        )
        order by l.orden
      )
      from dominio.comprobantes_venta_lineas l
      join dominio.depositos d on d.id = l.deposito_id and d.organizacion_id = l.organizacion_id
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
  'Cabecera, cliente, líneas (con depósito, stock y reservado) y totales de un comprobante; exige ventas en lectura o edición en su empresa (F-VTA-05/F-VTA-06).';
