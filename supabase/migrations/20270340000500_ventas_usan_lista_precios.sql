-- F-CLI-21 (MSF-453, épica MSF-450, spec 20270327-100000-listas-de-precios-por-cliente, Fase 3, T016): las ventas usan la lista de
-- precios del cliente y guardan el snapshot en la línea (D12). Con la bandera `listas_precios` APAGADA (estado de nacimiento) todo
-- resultado es idéntico al anterior: el motor (`20270340000400`) ignora las listas y las columnas nuevas quedan nulas.
--
-- Esquemas (Principio VII): sin tablas nuevas; escriben `dominio.comprobantes_venta_lineas` (columnas de `20270340000300`) y leen
-- `dominio.listas_precios`. Las RPC viven en `public` (superficie expuesta) y no guardan datos.
--
-- Funciones redefinidas (cada cuerpo parte de la última versión de `dokploy`, verificada igual a la definición VIVA de dev; mismas
-- firmas, mismos `security definer`/`search_path`, mismos grants):
--   1. `public.guardar_lineas_comprobante` (de 20270310100200): pasa el cliente del comprobante al motor y guarda `lista_precio_id` y
--      `lista_ajuste_pct` de cada línea que NO tiene precio manual (el manual manda siempre y no lleva lista, D5).
--   2. `public.obtener_comprobante` (de 20270322100600): cada línea suma `lista_ajuste_pct` y `lista_nombre` (la marca «Lista: nombre
--      ±n %», CA-CLI-21-9). No cambia ninguna otra clave.
--   3. `public.copiar_presupuesto` (de 20270310100300): reprecia con la lista del cliente del original y guarda el snapshot.
--   4. `private.copiar_costo_linea_nota` (de 20270310100300): la línea de una devolución hereda también `lista_precio_id` y
--      `lista_ajuste_pct` de la línea original (gate propio): la nota de crédito nunca recalcula con la lista actual.
--   5. `private.lineas_con_promocion_desactualizada` (de 20270310100400): la guarda de la confirmación recalcula con la misma lista y,
--      además de las promociones, rechaza el comprobante cuyo snapshot de lista ya no coincide con el motor (porcentaje cambiado, lista
--      reasignada o quitada, bandera apagada después de guardar). `confirmar_comprobante` no se reescribe. Esto NO contradice D12:
--      D12 protege lo ya confirmado; un borrador cuyo precio cambió desde que se guardó se avisa y se recalcula guardando de nuevo.
--
-- Migración aditiva (`create or replace`). Reversión operativa inmediata, SIN migrar: apagar la bandera `listas_precios`.
-- Reversión de código (migración posterior): restaurar los cuerpos de las versiones nombradas arriba.

-- ============================================================================
-- 1. guardar_lineas_comprobante
-- ============================================================================
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
      from private.precio_linea_venta(v_producto.id, v_c.empresa_id, v_tipo_cliente, v_cantidad, v_descuento, v_ahora, true, v_c.cliente_id);
    if not found then
      raise exception 'No pudimos calcular el precio de la línea %', v_orden using errcode = '22023', hint = 'producto_id';
    end if;
    v_unitario := coalesce(v_manual, v_precio.neto_unitario);
    if v_unitario is null then
      raise exception 'El producto de la línea % no tiene precio en pesos (falta la cotización del dólar)', v_orden
        using errcode = '22023', hint = 'producto_id';
    end if;
    -- F-CLI-21: una lista con descuento fuerte sobre un producto muy barato puede redondear a cero; la tienda lo marca `sin_precio`
    -- (neto <= 0) y el panel no cobra $0 por esa vía. Solo aplica cuando fijó el precio la lista (no cambia nada sin lista).
    if v_manual is null and v_precio.lista_precio_id is not null and v_unitario <= 0 then
      raise exception 'El producto de la línea % queda sin precio con la lista de precios del cliente (el descuento lo lleva a cero)', v_orden
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
      descuento_pct, precio_referencia, promocion_id, lista_precio_id, lista_ajuste_pct
    )
    values (
      v_org, v_c.id, v_base + v_orden, v_producto.id, v_producto.nombre, v_producto.sku, v_cantidad, v_unitario,
      v_precio.escala_usada, v_manual is not null, v_precio.alicuota_id, v_porcentaje, v_deposito,
      v_producto.disponibilidad_manual is not distinct from 'a_pedido', v_subtotal, v_iva,
      case when v_manual is null then v_precio.descuento_aplicado else 0 end,
      case when v_manual is null then v_precio.precio_referencia end,
      case when v_manual is null then v_precio.promocion_id end,
      case when v_manual is null then v_precio.lista_precio_id end,
      case when v_manual is null then v_precio.lista_ajuste_pct end
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
  'Reemplaza las líneas de catálogo de un comprobante editable en una transacción y recalcula subtotal, IVA y total (F-VTA-06). Precio y escala los calcula private.precio_linea_venta (lista de precios del cliente con la bandera listas_precios, F-CLI-21; promoción vigente de la tienda si es menor, MSF-816); la línea guarda el snapshot lista_precio_id/lista_ajuste_pct; precio_manual exige editar_precio. Contrato en docs/ventas-comprobantes.md.';


-- ============================================================================
-- 2. obtener_comprobante
-- ============================================================================
CREATE OR REPLACE FUNCTION public.obtener_comprobante(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'operador', case when exists (select 1 from dominio.presupuestos_tienda pt where pt.comprobante_id = v_c.id and pt.organizacion_id = v_c.organizacion_id)
                     then 'Tienda online (cliente)'
                     else coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), 'Usuario sin nombre') end,
    'de_tienda', exists (select 1 from dominio.presupuestos_tienda pt where pt.comprobante_id = v_c.id and pt.organizacion_id = v_c.organizacion_id),
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
          'lista_ajuste_pct', l.lista_ajuste_pct,
          'lista_nombre', lp.nombre,
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
      left join dominio.listas_precios lp on lp.id = l.lista_precio_id and lp.organizacion_id = l.organizacion_id
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
$function$;

comment on function public.obtener_comprobante(uuid) is
  'F-SVC-13: además de los datos del comprobante, expone el origen (origen_tipo, origen_id, origen_numero «R-000N») y la marca sin_stock de cada línea. MSF-816: cada línea suma precio_referencia (null sin promoción; no expone promocion_id). MSF-176: operador y de_tienda. F-CLI-21: cada línea suma lista_ajuste_pct y lista_nombre (null si no rigió una lista; el porcentaje es el congelado al cobrar, el nombre es el actual de la lista). Cambio aditivo.';


-- ============================================================================
-- 3. copiar_presupuesto
-- ============================================================================
create or replace function public.copiar_presupuesto(p_id uuid)
returns dominio.comprobantes_venta
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_hoy date := (select private.hoy_argentina());
  v_o dominio.comprobantes_venta;
  v_nuevo dominio.comprobantes_venta;
  v_empresa_nombre text;
  v_tipo_cliente text;
  v_defecto uuid;
  v_linea dominio.comprobantes_venta_lineas;
  v_producto dominio.productos;
  v_precio record;
  v_deposito uuid;
  v_unitario numeric;
  v_ahora timestamptz;
  v_porcentaje numeric;
  v_subtotal numeric;
  v_iva numeric;
  v_total_sin numeric := 0;
  v_total_iva numeric := 0;
  v_orden integer := 0;
  v_numero integer;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para copiar presupuestos' using errcode = '42501';
  end if;

  -- `for share`: las líneas del original no cambian mientras se copian.
  select * into v_o
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org and c.tipo = 'presupuesto'
   for share;
  if not found or v_o.empresa_id is null then
    raise exception 'El presupuesto no existe' using errcode = 'P0002';
  end if;
  -- MSF-816 (FR-002, R3c): el instante del precio se toma después del bloqueo del original.
  v_ahora := clock_timestamp();
  if (select private.nivel_ventas_en_empresa(v_o.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede copiar presupuestos de esta tienda' using errcode = '42501';
  end if;

  select e.nombre into v_empresa_nombre
    from dominio.empresas e
   where e.id = v_o.empresa_id and e.organizacion_id = v_org and e.activa;
  if not found then
    raise exception 'La tienda del presupuesto está desactivada' using errcode = '22023', hint = 'empresa_id';
  end if;

  select cl.tipo into v_tipo_cliente
    from public.clientes cl
   where cl.id = v_o.cliente_id and cl.organizacion_id = v_org;
  if not found then
    raise exception 'El cliente del presupuesto ya no existe' using errcode = '22023', hint = 'cliente_id';
  end if;
  select d.id into v_defecto
    from dominio.depositos d
    join dominio.depositos_empresas de on de.deposito_id = d.id and de.empresa_id = v_o.empresa_id
   where d.organizacion_id = v_org and d.por_defecto and d.activo;

  v_numero := private.siguiente_numero_comprobante(v_o.empresa_id, 'presupuesto');
  insert into dominio.comprobantes_venta (
    organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado,
    total_sin_iva, total_con_iva, canal, operador_id, valido_hasta, forma_pago_id, envio_id
  )
  values (
    v_org, v_o.empresa_id, v_o.cliente_id, 'presupuesto', lpad(v_numero::text, 8, '0'), v_numero, v_hoy, 'pendiente',
    0, 0, v_o.canal, v_actor,
    case when v_o.valido_hasta is null then null else v_hoy + greatest(v_o.valido_hasta - v_o.fecha, 0) end,
    v_o.forma_pago_id, v_o.envio_id
  )
  returning * into v_nuevo;

  for v_linea in
    select l.* from dominio.comprobantes_venta_lineas l
     where l.comprobante_id = v_o.id and l.organizacion_id = v_org
     order by l.orden
  loop
    v_orden := v_orden + 1;
    select * into v_producto
      from dominio.productos p
     where p.id = v_linea.producto_id and p.organizacion_id = v_org and p.activo;
    if not found then
      raise exception 'El producto «%» ya no está activo: quitalo del presupuesto original o reactivalo para copiarlo', v_linea.descripcion
        using errcode = '22023', hint = 'producto_id';
    end if;

    v_deposito := v_linea.deposito_id;
    if not exists (
      select 1
        from dominio.depositos d
        join dominio.depositos_empresas de on de.deposito_id = d.id and de.empresa_id = v_o.empresa_id
       where d.id = v_deposito and d.organizacion_id = v_org and d.activo
    ) then
      v_deposito := v_defecto;
    end if;
    if v_deposito is null then
      raise exception 'La tienda no tiene un depósito desde el cual vender' using errcode = '22023', hint = 'deposito_id';
    end if;

    -- MSF-816 (FR-010): misma función de precio que `guardar_lineas_comprobante`, SIN el descuento del cliente
    -- (igual que hoy, hallazgo 3 de la spec: seguimiento S2) y con la promoción vigente de la tienda.
    select * into v_precio
      from private.precio_linea_venta(v_producto.id, v_o.empresa_id, v_tipo_cliente, v_linea.cantidad, 0, v_ahora, false, v_o.cliente_id);
    if not found then
      raise exception 'No pudimos calcular el precio de «%»', v_linea.descripcion using errcode = '22023', hint = 'producto_id';
    end if;
    v_unitario := case when v_linea.precio_manual then v_linea.precio_unitario else v_precio.neto_unitario end;
    if v_unitario is null then
      raise exception 'El producto «%» no tiene precio en pesos (falta la cotización del dólar)', v_linea.descripcion
        using errcode = '22023', hint = 'producto_id';
    end if;
    if not v_linea.precio_manual and v_precio.lista_precio_id is not null and v_unitario <= 0 then
      raise exception 'El producto «%» queda sin precio con la lista de precios del cliente (el descuento lo lleva a cero)', v_linea.descripcion
        using errcode = '22023', hint = 'producto_id';
    end if;
    v_porcentaje := case when v_precio.alicuota_exenta then 0 else coalesce(v_precio.alicuota_porcentaje, 0) end;
    v_subtotal := round(v_unitario * v_linea.cantidad, 2);
    v_iva := round(v_subtotal * v_porcentaje / 100, 2);

    insert into dominio.comprobantes_venta_lineas (
      organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad, precio_unitario, escala,
      precio_manual, alicuota_id, alicuota_porcentaje, deposito_id, a_pedido, subtotal_sin_iva, iva,
      precio_referencia, promocion_id, lista_precio_id, lista_ajuste_pct
    )
    values (
      v_org, v_nuevo.id, v_orden, v_producto.id, v_producto.nombre, v_producto.sku, v_linea.cantidad, v_unitario,
      v_precio.escala_usada, v_linea.precio_manual, v_precio.alicuota_id, v_porcentaje, v_deposito,
      v_producto.disponibilidad_manual is not distinct from 'a_pedido', v_subtotal, v_iva,
      case when v_linea.precio_manual then null else v_precio.precio_referencia end,
      case when v_linea.precio_manual then null else v_precio.promocion_id end,
      case when v_linea.precio_manual then null else v_precio.lista_precio_id end,
      case when v_linea.precio_manual then null else v_precio.lista_ajuste_pct end
    );
    v_total_sin := v_total_sin + v_subtotal;
    v_total_iva := v_total_iva + v_iva;
  end loop;

  update dominio.comprobantes_venta
     set total_sin_iva = v_total_sin,
         total_con_iva = v_total_sin + v_total_iva,
         updated_at = clock_timestamp()
   where id = v_nuevo.id
  returning * into v_nuevo;

  perform private.registrar_actividad(
    'presupuesto.copiado',
    format('Copió el presupuesto %s como %s en %s', v_o.numero, v_nuevo.numero, v_empresa_nombre),
    v_nuevo.empresa_id
  );
  return v_nuevo;
end;
$$;

revoke execute on function public.copiar_presupuesto(uuid) from public, anon;
grant execute on function public.copiar_presupuesto(uuid) to authenticated;

comment on function public.copiar_presupuesto(uuid) is
  'Crea un presupuesto pendiente nuevo con las líneas del original (precios recalculados con private.precio_linea_venta con la lista de precios del cliente si rige, sin descuento del cliente, salvo manual); el original no cambia (F-VTA-08, FR-051; MSF-816). Contrato en docs/ventas-comprobantes.md.';


-- ============================================================================
-- 4. Las notas de crédito heredan el snapshot
-- ============================================================================
create or replace function private.copiar_costo_linea_nota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.costo_unitario is null and new.cotizacion is null then
    select o.costo_unitario, o.cotizacion into new.costo_unitario, new.cotizacion
      from dominio.comprobantes_venta n
      join dominio.comprobantes_venta_lineas o
        on o.comprobante_id = n.comprobante_origen_id and o.organizacion_id = n.organizacion_id and o.orden = new.orden
     where n.id = new.comprobante_id and n.organizacion_id = new.organizacion_id
       and n.tipo = 'nota_credito' and n.nc_tipo = 'devolucion_productos';
  end if;
  -- MSF-816 (FR-011): el snapshot de la promoción viaja con la devolución (gate propio, fuera del del costo).
  if new.precio_referencia is null and new.promocion_id is null then
    select o.precio_referencia, o.promocion_id into new.precio_referencia, new.promocion_id
      from dominio.comprobantes_venta n
      join dominio.comprobantes_venta_lineas o
        on o.comprobante_id = n.comprobante_origen_id and o.organizacion_id = n.organizacion_id and o.orden = new.orden
     where n.id = new.comprobante_id and n.organizacion_id = new.organizacion_id
       and n.tipo = 'nota_credito' and n.nc_tipo = 'devolucion_productos';
  end if;
  -- F-CLI-21 (D12): el snapshot de la lista de precios viaja con la devolución (gate propio).
  if new.lista_precio_id is null and new.lista_ajuste_pct is null then
    select o.lista_precio_id, o.lista_ajuste_pct into new.lista_precio_id, new.lista_ajuste_pct
      from dominio.comprobantes_venta n
      join dominio.comprobantes_venta_lineas o
        on o.comprobante_id = n.comprobante_origen_id and o.organizacion_id = n.organizacion_id and o.orden = new.orden
     where n.id = new.comprobante_id and n.organizacion_id = new.organizacion_id
       and n.tipo = 'nota_credito' and n.nc_tipo = 'devolucion_productos';
  end if;
  return new;
end;
$$;

revoke execute on function private.copiar_costo_linea_nota() from public, anon, authenticated;


-- ============================================================================
-- 5. Validación de precios desactualizados de la confirmación
-- ============================================================================
create or replace function private.lineas_con_promocion_desactualizada(
  p_comprobante uuid,
  p_ahora timestamptz default now()
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_c record;
  v_tipo_cliente text;
  v_descuento numeric := 0;
  v_promos boolean := private.bandera_activa('promociones_precio');
  v_lista_id uuid;
  v_lista_pct numeric;
  v_n integer;
begin
  -- Con las dos banderas apagadas no hay nada que vigilar (idéntico al comportamiento anterior).
  if not v_promos and not private.bandera_activa('listas_precios') and not exists (
    select 1 from dominio.comprobantes_venta_lineas l where l.comprobante_id = p_comprobante and l.lista_precio_id is not null
  ) then
    return 0;
  end if;

  select c.organizacion_id, c.empresa_id, c.cliente_id into v_c
    from dominio.comprobantes_venta c
   where c.id = p_comprobante;
  if not found or v_c.empresa_id is null then
    return 0;
  end if;

  -- Mismo origen del tipo y del descuento que `guardar_lineas_comprobante`.
  select cl.tipo, coalesce(cl.descuento, 0) into v_tipo_cliente, v_descuento
    from public.clientes cl
   where cl.id = v_c.cliente_id and cl.organizacion_id = v_c.organizacion_id;
  v_descuento := coalesce(v_descuento, 0);

  -- F-CLI-21: la lista que rige HOY para el cliente (nula con la bandera apagada, sin lista o lista archivada).
  select ls.lista_id, ls.ajuste_pct into v_lista_id, v_lista_pct
    from private.lista_precios_cliente(v_c.cliente_id, v_c.organizacion_id) ls;

  -- FR-024: `precio_para` (escala, propio, lista, cotización) cuesta mucho más que una búsqueda indexada. Primero se
  -- mira, por línea, solo la promoción vigente (`promocion_vigente_fila`, índice de MSF-363); únicamente las líneas
  -- candidatas (la promoción vigente no es la guardada, o es la misma con otro precio) pasan por el cálculo completo
  -- `precio_linea_venta`, que decide con la misma regla del guardado. Una línea sin promoción guardada ni vigente, o
  -- con la misma promoción al mismo precio, no se recalcula: un cambio solo del precio normal no se rechaza (la guarda
  -- mira promociones). F-CLI-21: además es candidata la línea cuyo snapshot de lista ya no coincide con la lista que rige hoy
  -- (porcentaje cambiado, lista reasignada o quitada, bandera apagada) y, si el cliente tiene lista hoy, la que no guardó ninguna
  -- (la recalcula el motor: una con precio propio o escala sigue sin lista y no cuenta). Un `cross join lateral` sin fila (precio
  -- no calculable) omite la línea, y `neto_unitario` nulo también.
  with candidatas as materialized (
    select l.producto_id, l.cantidad, l.promocion_id, l.precio_unitario, l.lista_precio_id, l.lista_ajuste_pct
      from dominio.comprobantes_venta_lineas l
      left join lateral private.promocion_vigente_fila(l.producto_id, v_c.empresa_id, p_ahora) f on true
     where l.comprobante_id = p_comprobante
       and l.organizacion_id = v_c.organizacion_id
       and not l.precio_manual
       and not l.sin_stock
       and l.producto_id is not null
       and ((v_promos and (f.promocion_id is distinct from l.promocion_id
                           or (f.promocion_id is not null and abs(f.precio - l.precio_unitario) > 0.005)))
            or (l.lista_precio_id is not null
                and (v_lista_id is null or l.lista_precio_id <> v_lista_id or l.lista_ajuste_pct <> v_lista_pct))
            or (l.lista_precio_id is null and v_lista_id is not null))
  )
  select count(*)::int into v_n
    from candidatas c
   cross join lateral private.precio_linea_venta(
           c.producto_id, v_c.empresa_id, v_tipo_cliente, c.cantidad, v_descuento, p_ahora, true, v_c.cliente_id) p
   where p.neto_unitario is not null
     and ((v_promos and (p.promocion_id is distinct from c.promocion_id
                         or (p.promocion_id is not null and abs(p.neto_unitario - c.precio_unitario) > 0.005)))
          or p.lista_precio_id is distinct from c.lista_precio_id
          or p.lista_ajuste_pct is distinct from c.lista_ajuste_pct);
  return v_n;
end;
$$;

revoke execute on function private.lineas_con_promocion_desactualizada(uuid, timestamptz)
  from public, anon, authenticated, service_role;

comment on function private.lineas_con_promocion_desactualizada(uuid, timestamptz) is
  'MSF-816: cuenta las líneas de un comprobante cuya promoción (o precio promocional) ya no es la que se cobraría ahora. Omite precio manual, sin_stock y líneas sin precio calculable; con la bandera promociones_precio apagada devuelve 0. La usa confirmar_comprobante. F-CLI-21: recalcula con la lista de precios del cliente del comprobante y también cuenta la línea cuyo snapshot de lista (id o porcentaje) ya no coincide con el motor.';
