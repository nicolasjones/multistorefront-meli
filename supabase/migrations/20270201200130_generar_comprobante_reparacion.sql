-- F-SVC-13 (MSF-418, épica MSF-232, spec 20261028-100000-service-cobro-y-avisos, FR-001, FR-002, FR-003, FR-005,
-- FR-008): `public.generar_comprobante_reparacion`, el cobro de una reparación mediante un comprobante de Ventas.
--
-- Esquema (Principio VII): sin tablas nuevas. Escribe `dominio.comprobantes_venta` y
-- `dominio.comprobantes_venta_lineas` (`dominio`, columnas de 20270113100100 y 20270113100200) y, por
-- `private.registrar_actividad`, `public.registro_actividad`. Lee `dominio.reparaciones`, `reparacion_items`,
-- `public.clientes` y `dominio.alicuotas_iva`.
--
-- Qué hace: crea una FACTURA en `borrador` en la tienda de la reparación y con su cliente, con origen
-- `reparacion` + id y una línea por ítem (descripción, cantidad, precio unitario sin IVA) marcada `sin_stock`.
-- El comprobante es una FOTO del momento: no queda vínculo vivo con los ítems. Numeración de Ventas
-- (`private.siguiente_numero_comprobante`); totales calculados acá con la misma regla que `guardar_lineas_comprobante`
-- (subtotal = cantidad × precio, IVA = subtotal × alícuota, redondeo a 2 decimales).
--
-- Alícuota (Decisiones abiertas 1, PROVISORIA, a confirmar con el cliente): repuesto vinculado al catálogo → la
-- alícuota efectiva del producto (`private.alicuota_producto`); mano de obra y repuesto libre → la alícuota general
-- vigente de la organización (`private.alicuota_general`: la activa al 21 %, si no la mayor activa no exenta, si no
-- 0 %). No hay porcentaje fijo en código fuera de esa elección.
--
-- Idempotencia (FR-002): la reparación se toma `for update`; si ya tiene un comprobante vigente (no anulado) lo
-- devuelve con `creado = false`. El índice único parcial `comprobantes_venta_origen_vigente_uk` lo respalda bajo
-- concurrencia. Con el comprobante anulado, permite generar uno nuevo.
--
-- Permisos (FR-005): `service_tecnico` en `edicion` y `ventas` en `edicion` en la tienda de la reparación (42501);
-- reparación inexistente o de una tienda no accesible (P0002); sin ítems (22023), anulada (55000), cliente
-- archivado o tienda desactivada (22023). Organización y actor salen de la sesión.
-- `revoke … from public, anon` y `grant execute … to authenticated` explícitos.
--
-- Migración aditiva. Reversión (migración posterior; los comprobantes generados NO se borran solos: anularlos en Ventas):
--   drop function public.generar_comprobante_reparacion(uuid);
--   drop function private.alicuota_general(uuid);

create or replace function private.alicuota_general(p_organizacion uuid)
returns table (alicuota_id uuid, porcentaje numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.porcentaje
    from dominio.alicuotas_iva a
   where a.organizacion_id = p_organizacion and a.activa and not a.exento
   order by (a.porcentaje = 21) desc, a.porcentaje desc
   limit 1;
$$;

revoke execute on function private.alicuota_general(uuid) from public, anon, authenticated;

comment on function private.alicuota_general(uuid) is
  'F-SVC-13 (provisoria): alícuota general vigente de la organización = la activa al 21 %, si no la mayor activa no exenta. Sin filas si no hay ninguna.';

create or replace function public.generar_comprobante_reparacion(p_reparacion uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_rep dominio.reparaciones;
  v_empresa dominio.empresas;
  v_vigente uuid;
  v_nuevo dominio.comprobantes_venta;
  v_item record;
  v_gen_id uuid;
  v_gen_pct numeric;
  v_alicuota_id uuid;
  v_porcentaje numeric;
  v_codigo text;
  v_numero integer;
  v_orden integer := 0;
  v_subtotal numeric;
  v_iva numeric;
  v_total_sin numeric := 0;
  v_total_iva numeric := 0;
begin
  if v_org is null or v_actor is null
     or (select private.nivel_seccion('service_tecnico')) <> 'edicion' then
    raise exception 'Tu rol no puede generar el comprobante de una reparación' using errcode = '42501';
  end if;
  if p_reparacion is null then
    raise exception 'Indicá la reparación' using errcode = '22023';
  end if;

  -- Serializa a quienes generan sobre la misma reparación: la segunda espera y ve el comprobante.
  select * into v_rep
    from dominio.reparaciones r
   where r.id = p_reparacion and r.organizacion_id = v_org
   for update;
  if not found
     or not exists (select 1 from private.empresas_accesibles() a(id) where a.id = v_rep.empresa_id) then
    raise exception 'La reparación no existe' using errcode = 'P0002';
  end if;
  if (select private.nivel_ventas_en_empresa(v_rep.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede crear comprobantes en la tienda de esta reparación' using errcode = '42501';
  end if;
  if v_rep.anulada_en is not null then
    raise exception 'La reparación está anulada: no se puede generar su comprobante' using errcode = '55000';
  end if;

  -- Idempotente: con un comprobante vigente, se devuelve ese.
  select c.id into v_vigente
    from dominio.comprobantes_venta c
   where c.organizacion_id = v_org and c.origen_tipo = 'reparacion' and c.origen_id = v_rep.id
     and c.estado <> 'anulada';
  if found then
    return jsonb_build_object('comprobante_id', v_vigente, 'creado', false);
  end if;

  if not exists (
    select 1 from dominio.reparacion_items i where i.reparacion_id = v_rep.id and i.organizacion_id = v_org
  ) then
    raise exception 'La reparación no tiene ítems: cargá mano de obra o repuestos para generar el comprobante'
      using errcode = '22023';
  end if;
  select * into v_empresa from dominio.empresas e where e.id = v_rep.empresa_id and e.organizacion_id = v_org;
  if not found or not v_empresa.activa then
    raise exception 'La tienda de la reparación está desactivada' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.clientes c
     where c.id = v_rep.cliente_id and c.organizacion_id = v_org and c.archivado_en is null
  ) then
    raise exception 'El cliente de la reparación está archivado: restauralo para generar el comprobante'
      using errcode = '22023';
  end if;

  select g.alicuota_id, g.porcentaje into v_gen_id, v_gen_pct from private.alicuota_general(v_org) g;

  v_numero := private.siguiente_numero_comprobante(v_rep.empresa_id, 'factura');
  begin
    insert into dominio.comprobantes_venta (
      organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado,
      total_sin_iva, total_con_iva, canal, operador_id, origen_tipo, origen_id
    )
    values (
      v_org, v_rep.empresa_id, v_rep.cliente_id, 'factura', lpad(v_numero::text, 8, '0'), v_numero,
      current_date, 'borrador', 0, 0, 'mostrador', v_actor, 'reparacion', v_rep.id
    )
    returning * into v_nuevo;
  exception when unique_violation then
    -- Respaldo del índice único parcial: otra transacción ganó la carrera.
    select c.id into v_vigente
      from dominio.comprobantes_venta c
     where c.organizacion_id = v_org and c.origen_tipo = 'reparacion' and c.origen_id = v_rep.id
       and c.estado <> 'anulada';
    return jsonb_build_object('comprobante_id', v_vigente, 'creado', false);
  end;

  for v_item in
    select i.descripcion, i.cantidad, i.precio_unitario, i.producto_id, p.sku
      from dominio.reparacion_items i
      left join dominio.productos p on p.id = i.producto_id and p.organizacion_id = i.organizacion_id
     where i.reparacion_id = v_rep.id and i.organizacion_id = v_org
     order by i.creado_en, i.id
  loop
    v_orden := v_orden + 1;
    v_alicuota_id := null;
    v_porcentaje := null;
    if v_item.producto_id is not null then
      select a.alicuota_id, case when a.exento then 0 else a.porcentaje end
        into v_alicuota_id, v_porcentaje
        from private.alicuota_producto(v_item.producto_id) a;
    end if;
    if v_porcentaje is null then
      v_alicuota_id := v_gen_id;
      v_porcentaje := coalesce(v_gen_pct, 0);
    end if;
    v_subtotal := round(v_item.cantidad * v_item.precio_unitario, 2);
    v_iva := round(v_subtotal * v_porcentaje / 100, 2);

    insert into dominio.comprobantes_venta_lineas (
      organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad, precio_unitario, escala,
      precio_manual, alicuota_id, alicuota_porcentaje, deposito_id, a_pedido, sin_stock, subtotal_sin_iva, iva
    )
    values (
      v_org, v_nuevo.id, v_orden, null, v_item.descripcion, v_item.sku, v_item.cantidad, v_item.precio_unitario, null,
      false, v_alicuota_id, v_porcentaje, null, false, true, v_subtotal, v_iva
    );
    v_total_sin := v_total_sin + v_subtotal;
    v_total_iva := v_total_iva + v_iva;
  end loop;

  update dominio.comprobantes_venta
     set total_sin_iva = v_total_sin,
         total_con_iva = v_total_sin + v_total_iva,
         updated_at = clock_timestamp()
   where id = v_nuevo.id;

  v_codigo := private.codigo_reparacion(v_rep.numero);
  perform private.registrar_actividad(
    'reparacion.comprobante_generado',
    format('Generó la factura %s de la reparación %s', v_nuevo.numero, v_codigo),
    v_rep.empresa_id
  );
  return jsonb_build_object('comprobante_id', v_nuevo.id, 'creado', true);
end;
$$;

revoke execute on function public.generar_comprobante_reparacion(uuid) from public, anon;
grant execute on function public.generar_comprobante_reparacion(uuid) to authenticated;

comment on function public.generar_comprobante_reparacion(uuid) is
  'F-SVC-13: genera la factura en borrador de una reparación (líneas sin_stock, alícuota provisoria); idempotente por reparación. Exige service_tecnico y ventas en edición en la tienda.';
