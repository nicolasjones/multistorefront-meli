-- F-PRV-09 (MSF-454, épica MSF-450, spec 20261109-103000-ordenes-de-compra-a-proveedores):
-- API de la orden de compra a proveedor.
--
--   public.crear_orden_compra                   (security definer)  alta del pedido
--   public.cambiar_estado_orden_compra          (security definer)  recepción y anulación
--   public.productos_en_reposicion_de_proveedor  (security definer)  productos en alerta del proveedor
--   public.listar_ordenes_compra                 (security invoker)  listado paginado
--   public.detalle_orden_compra                  (security invoker)  cabecera y líneas
--
-- Por qué unas van `security definer` y otras `security invoker`:
--   - Las de ESCRITURA (`crear`, `cambiar_estado`) no tienen política de escritura en la tabla: la
--     autorización la hace la propia función (organización de la sesión, `nivel_seccion('stock')`).
--   - `productos_en_reposicion_de_proveedor` es `security definer` porque `dominio.productos` exige la
--     sección `productos` y esta pantalla es de `stock`: la función expone SOLO producto, nombre, SKU,
--     disponible, mínimo, estado y cantidad sugerida (nada de costos ni de contacto).
--   - Las de LECTURA son `security invoker`: decide la RLS de las tablas (organización y `stock`).
--     El nombre del proveedor sale de `public.proveedores_basico` (superficie mínima por nivel, sin CUIT).
--
-- Migración aditiva. Reversión (en una migración posterior):
--   drop function public.crear_orden_compra(uuid, uuid, date, text, jsonb);
--   drop function public.cambiar_estado_orden_compra(uuid, text, date, text);
--   drop function public.productos_en_reposicion_de_proveedor(uuid);
--   drop function public.listar_ordenes_compra(text, uuid, uuid, integer, integer);
--   drop function public.detalle_orden_compra(uuid);

-- ============================================================================
-- Alta de la orden
-- ============================================================================

create or replace function public.crear_orden_compra(
  p_empresa uuid,
  p_proveedor uuid,
  p_fecha date,
  p_observaciones text default null,
  p_items jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_fecha date := coalesce(p_fecha, current_date);
  v_observaciones text := nullif(btrim(coalesce(p_observaciones, '')), '');
  v_orden uuid := gen_random_uuid();
  v_item jsonb;
  v_producto_texto text;
  v_producto uuid;
  v_cantidad_texto text;
  v_cantidad integer;
  v_vistos uuid[] := '{}';
begin
  if v_actor is null or v_organizacion is null
     or (select private.nivel_seccion('stock')) <> 'edicion' then
    raise exception 'Tu rol no puede crear órdenes de compra' using errcode = '42501';
  end if;

  if p_empresa is null
     or p_empresa not in (select private.empresas_accesibles())
     or not exists (
       select 1 from dominio.empresas e
        where e.id = p_empresa
          and e.organizacion_id = v_organizacion
          and e.activa
     ) then
    raise exception 'Elegí una empresa activa a la que tengas acceso' using errcode = '22023';
  end if;

  if p_proveedor is null or not exists (
    select 1 from dominio.proveedores p
     where p.id = p_proveedor
       and p.organizacion_id = v_organizacion
       and p.activo
  ) then
    raise exception 'Elegí un proveedor activo de la organización' using errcode = '22023';
  end if;

  if v_fecha > current_date then
    raise exception 'La fecha de la orden no puede ser futura' using errcode = '22023';
  end if;

  if v_observaciones is not null and length(v_observaciones) > 1000 then
    raise exception 'Las observaciones admiten hasta 1000 caracteres' using errcode = '22023';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos un producto para la orden' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'Una orden admite hasta 100 productos' using errcode = '22023';
  end if;

  insert into dominio.ordenes_compra (
    id, organizacion_id, empresa_id, proveedor_id, fecha, observaciones, creado_por
  ) values (
    v_orden, v_organizacion, p_empresa, p_proveedor, v_fecha, v_observaciones, v_actor
  );

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_producto_texto := nullif(btrim(coalesce(v_item ->> 'producto_id', '')), '');
    v_cantidad_texto := nullif(btrim(coalesce(v_item ->> 'cantidad', '')), '');
    if v_producto_texto is null
       or v_producto_texto !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or v_cantidad_texto is null
       or v_cantidad_texto !~ '^[0-9]{1,7}$' then
      raise exception 'Revisá los productos: alguno no es válido' using errcode = '22023';
    end if;
    v_producto := v_producto_texto::uuid;
    v_cantidad := v_cantidad_texto::integer;
    if v_cantidad <= 0 then
      raise exception 'La cantidad debe ser un entero mayor a cero' using errcode = '22023';
    end if;
    if v_producto = any(v_vistos) then
      raise exception 'No repitas el mismo producto en una orden' using errcode = '22023';
    end if;
    if not exists (
      select 1 from dominio.productos pr
       where pr.id = v_producto
         and pr.organizacion_id = v_organizacion
         and pr.activo
         and pr.proveedor_id = p_proveedor
    ) then
      raise exception 'Revisá los productos: alguno no existe, está inactivo o es de otro proveedor'
        using errcode = '22023';
    end if;
    -- El producto tiene que seguir en alerta de reposición: la lista de la pantalla pudo cambiar.
    if not exists (
      select 1 from dominio.existencias e
       where e.producto_id = v_producto
         and e.organizacion_id = v_organizacion
         and e.cantidad - e.reservado <= e.minimo
    ) then
      raise exception 'Revisá los productos: alguno ya no está en alerta de reposición'
        using errcode = '22023';
    end if;

    v_vistos := v_vistos || v_producto;
    insert into dominio.ordenes_compra_items (orden_id, organizacion_id, producto_id, cantidad)
    values (v_orden, v_organizacion, v_producto, v_cantidad);
  end loop;

  return v_orden;
end;
$$;

comment on function public.crear_orden_compra(uuid, uuid, date, text, jsonb) is
  'F-PRV-09: crea una orden de compra (emitida) para un proveedor, con los productos en alerta de reposición de ese proveedor. Exige edición en Stock; la organización sale de la sesión.';

revoke execute on function public.crear_orden_compra(uuid, uuid, date, text, jsonb) from public, anon;
grant execute on function public.crear_orden_compra(uuid, uuid, date, text, jsonb) to authenticated;

-- ============================================================================
-- Recepción y anulación
-- ============================================================================

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
     and organizacion_id = v_organizacion;
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
  'F-PRV-09: marca la orden como recibida (con fecha) o la anula (con motivo). No mueve stock: la mercadería entra por Ingreso de mercadería. Exige edición en Stock.';

revoke execute on function public.cambiar_estado_orden_compra(uuid, text, date, text) from public, anon;
grant execute on function public.cambiar_estado_orden_compra(uuid, text, date, text) to authenticated;

-- ============================================================================
-- Productos en reposición de un proveedor (insumo del alta)
-- ============================================================================

create or replace function public.productos_en_reposicion_de_proveedor(p_proveedor uuid)
returns table (
  producto_id uuid,
  nombre text,
  sku text,
  disponible integer,
  minimo integer,
  estado text,
  cantidad_sugerida integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    pr.id,
    pr.nombre,
    pr.sku,
    e.cantidad - e.reservado,
    e.minimo,
    case when e.cantidad - e.reservado <= 0 then 'sin_stock' else 'stock_bajo' end,
    greatest(e.minimo - (e.cantidad - e.reservado), 1)
  from dominio.productos pr
  join dominio.existencias e
    on e.producto_id = pr.id and e.organizacion_id = pr.organizacion_id
  where pr.organizacion_id = (select private.organizacion_id())
    and pr.proveedor_id = p_proveedor
    and pr.activo
    and e.cantidad - e.reservado <= e.minimo
    and (select private.nivel_seccion('stock')) in ('lectura', 'edicion')
  order by pr.nombre, pr.id;
$$;

comment on function public.productos_en_reposicion_de_proveedor(uuid) is
  'F-PRV-09: productos del proveedor en alerta de reposición (disponible <= mínimo) con la cantidad sugerida (máximo 1). Expone solo datos de reposición, sin costos.';

revoke execute on function public.productos_en_reposicion_de_proveedor(uuid) from public, anon;
grant execute on function public.productos_en_reposicion_de_proveedor(uuid) to authenticated;

-- ============================================================================
-- Listado y detalle
-- ============================================================================

create or replace function public.listar_ordenes_compra(
  p_estado text default null,
  p_empresa uuid default null,
  p_proveedor uuid default null,
  p_pagina integer default 1,
  p_tamano integer default 25
)
returns table (
  orden_id uuid,
  fecha date,
  estado text,
  proveedor text,
  empresa text,
  unidades integer,
  fecha_recepcion date,
  motivo_anulacion text,
  total bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with cabeceras as (
    select
      o.id as orden_id,
      o.fecha,
      o.estado,
      coalesce(pb.razon_social, 'Proveedor no disponible') as proveedor,
      coalesce(e.nombre, 'Empresa no disponible') as empresa,
      coalesce((
        select sum(i.cantidad)
          from dominio.ordenes_compra_items i
         where i.orden_id = o.id
      ), 0)::integer as unidades,
      o.fecha_recepcion,
      o.motivo_anulacion
    from dominio.ordenes_compra o
    left join public.proveedores_basico pb on pb.id = o.proveedor_id
    left join dominio.empresas e on e.id = o.empresa_id
    where (p_estado is null or o.estado = p_estado)
      and (p_empresa is null or o.empresa_id = p_empresa)
      and (p_proveedor is null or o.proveedor_id = p_proveedor)
  )
  select
    c.orden_id, c.fecha, c.estado, c.proveedor, c.empresa, c.unidades,
    c.fecha_recepcion, c.motivo_anulacion,
    count(*) over () as total
  from cabeceras c
  order by c.fecha desc, c.orden_id
  limit greatest(1, least(coalesce(p_tamano, 25), 100))
  offset (greatest(coalesce(p_pagina, 1), 1) - 1)
    * greatest(1, least(coalesce(p_tamano, 25), 100));
$$;

comment on function public.listar_ordenes_compra(text, uuid, uuid, integer, integer) is
  'F-PRV-09: listado paginado de órdenes de compra con filtro por estado, empresa y proveedor. RLS del llamador.';

revoke execute on function public.listar_ordenes_compra(text, uuid, uuid, integer, integer) from public, anon;
grant execute on function public.listar_ordenes_compra(text, uuid, uuid, integer, integer) to authenticated;

create or replace function public.detalle_orden_compra(p_orden uuid)
returns jsonb
language sql
stable
security invoker
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
  group by o.id, e.nombre, pb.razon_social;
$$;

comment on function public.detalle_orden_compra(uuid) is
  'F-PRV-09: detalle de una orden de compra con sus líneas. RLS del llamador; null si no existe o es de otra organización.';

revoke execute on function public.detalle_orden_compra(uuid) from public, anon;
grant execute on function public.detalle_orden_compra(uuid) to authenticated;
