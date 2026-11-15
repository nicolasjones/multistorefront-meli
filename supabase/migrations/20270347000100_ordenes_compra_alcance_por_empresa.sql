-- Seguridad retroactiva de #869 (órdenes de compra): el alcance por empresa faltaba. `crear_orden_compra` exige
-- `empresa_id in (select private.empresas_accesibles())`, pero la lectura (políticas y `detalle_orden_compra`) y
-- `cambiar_estado_orden_compra` (security definer) solo validaban organización y Stock: una persona acotada a la empresa A
-- podía ver, recibir o anular las órdenes de la empresa B de su organización.
--
-- Cambios (create or replace / políticas recreadas; sin tocar datos ni `conjuntos_exportacion_total`):
--   * ordenes_compra_select y ordenes_compra_items_select: suman el alcance por empresa (las líneas, vía su orden).
--     Con eso `listar_ordenes_compra` (security invoker) también queda acotada.
--   * detalle_orden_compra: filtra por empresa accesible.
--   * cambiar_estado_orden_compra: la orden de una empresa fuera del alcance responde «La orden no existe» (no revela
--     su existencia); `p_fecha_recepcion` no puede ser futura ni anterior a la fecha de la orden.
--
-- Reversión (migración posterior): recrear las políticas y las dos funciones con las definiciones de
-- `20270334000000_ordenes_compra_tablas.sql` y `20270334000001_ordenes_compra_rpc.sql`.

drop policy if exists ordenes_compra_select on dominio.ordenes_compra;
create policy ordenes_compra_select on dominio.ordenes_compra
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and empresa_id in (select private.empresas_accesibles())
    and (select private.nivel_seccion('stock')) in ('lectura', 'edicion')
  );

drop policy if exists ordenes_compra_items_select on dominio.ordenes_compra_items;
create policy ordenes_compra_items_select on dominio.ordenes_compra_items
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('stock')) in ('lectura', 'edicion')
    and orden_id in (
      select o.id from dominio.ordenes_compra o
       where o.organizacion_id = (select private.organizacion_id())
         and o.empresa_id in (select private.empresas_accesibles())
    )
  );

create or replace function public.cambiar_estado_orden_compra(
  p_orden uuid,
  p_estado text,
  p_fecha_recepcion date default null,
  p_motivo text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_orden dominio.ordenes_compra;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if v_actor is null or v_organizacion is null
     or (select private.nivel_seccion('stock')) <> 'edicion' then
    raise exception 'Tu rol no puede cambiar el estado de una orden de compra' using errcode = '42501';
  end if;

  if p_estado not in ('recibida', 'anulada') then
    raise exception 'El estado tiene que ser «recibida» o «anulada»' using errcode = '22023';
  end if;

  select * into v_orden
    from dominio.ordenes_compra
   where id = p_orden
     and organizacion_id = v_organizacion
     and empresa_id in (select private.empresas_accesibles());
  if not found then
    raise exception 'La orden no existe' using errcode = '22023';
  end if;

  -- Idempotente: repetir la transición deja la orden como está.
  if v_orden.estado = p_estado then
    return v_orden.id;
  end if;
  if v_orden.estado <> 'emitida' then
    raise exception 'Esa orden ya está cerrada: no se cambia más' using errcode = '22023';
  end if;

  if p_estado = 'recibida' then
    if p_fecha_recepcion is not null
       and (p_fecha_recepcion > current_date or p_fecha_recepcion < v_orden.fecha) then
      raise exception 'La fecha de recepción no puede ser futura ni anterior a la de la orden' using errcode = '22023';
    end if;
    update dominio.ordenes_compra
       set estado = 'recibida',
           fecha_recepcion = coalesce(p_fecha_recepcion, current_date)
     where id = v_orden.id;
  else
    if v_motivo is null or length(v_motivo) < 3 or length(v_motivo) > 500 then
      raise exception 'El motivo debe tener entre 3 y 500 caracteres' using errcode = '22023';
    end if;
    update dominio.ordenes_compra
       set estado = 'anulada',
           motivo_anulacion = v_motivo,
           anulado_por = v_actor,
           anulado_en = now()
     where id = v_orden.id;
  end if;

  return v_orden.id;
end;
$$;

comment on function public.cambiar_estado_orden_compra(uuid, text, date, text) is
  'F-PRV-09: marca la orden como recibida (con fecha entre la de la orden y hoy) o la anula (con motivo). Solo órdenes de empresas accesibles para la persona. No mueve stock: la mercadería entra por Ingreso de mercadería. Exige edición en Stock.';

revoke execute on function public.cambiar_estado_orden_compra(uuid, text, date, text) from public, anon;
grant execute on function public.cambiar_estado_orden_compra(uuid, text, date, text) to authenticated;

create or replace function public.detalle_orden_compra(p_orden uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id,
    'fecha', o.fecha,
    'estado', o.estado,
    'observaciones', o.observaciones,
    'fecha_recepcion', o.fecha_recepcion,
    'motivo_anulacion', o.motivo_anulacion,
    'empresa', e.nombre,
    'proveedor', coalesce(pb.razon_social, 'Proveedor no disponible'),
    'lineas', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'producto_id', i.producto_id,
          'producto_nombre', coalesce(pr.nombre, 'Producto no disponible'),
          'producto_sku', pr.sku,
          'cantidad', i.cantidad
        )
        order by pr.nombre, i.producto_id
      ),
      '[]'::jsonb
    )
  )
  from dominio.ordenes_compra o
  join dominio.ordenes_compra_items i on i.orden_id = o.id
  left join dominio.productos pr on pr.id = i.producto_id
  left join dominio.empresas e on e.id = o.empresa_id
  left join public.proveedores_basico pb on pb.id = o.proveedor_id
  where o.id = p_orden
    and o.organizacion_id = (select private.organizacion_id())
    and o.empresa_id in (select private.empresas_accesibles())
    and (select private.nivel_seccion('stock')) in ('lectura', 'edicion')
  group by o.id, e.nombre, pb.razon_social;
$$;

comment on function public.detalle_orden_compra(uuid) is
  'F-PRV-09: detalle de una orden de compra con sus líneas. Es security definer para que el nombre del producto salga con permiso solo de Stock (dominio.productos exige Productos): filtra por la organización de la sesión, por las empresas accesibles y exige lectura de Stock; null si no existe o está fuera del alcance.';

revoke execute on function public.detalle_orden_compra(uuid) from public, anon;
grant execute on function public.detalle_orden_compra(uuid) to authenticated;
