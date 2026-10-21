-- F-PRV-05 (MSF-393, épica MSF-219): listado paginado del ingreso de mercadería.
-- `security invoker`: la RLS de las tablas decide qué filas ve el llamador. Una fila
-- por línea, con el total de filas del conjunto filtrado para paginar en el servidor.
--
-- Migración aditiva. Reversión (en una migración posterior):
--   drop function public.listar_ingresos_mercaderia(date, date, uuid, uuid, uuid, uuid, integer, integer);

create or replace function public.listar_ingresos_mercaderia(
  p_desde date default null,
  p_hasta date default null,
  p_proveedor uuid default null,
  p_empresa uuid default null,
  p_producto uuid default null,
  p_operador uuid default null,
  p_pagina integer default 1,
  p_tamano integer default 25
)
returns table (
  ingreso_id uuid,
  fecha date,
  creado_en timestamptz,
  estado text,
  comprobante text,
  motivo_anulacion text,
  anulado_en timestamptz,
  producto_id uuid,
  producto_nombre text,
  producto_sku text,
  cantidad integer,
  costo_unitario_usd numeric,
  destino text,
  empresa text,
  proveedor text,
  operador text,
  total bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with filas as (
    select
      i.id as ingreso_id,
      i.fecha,
      i.creado_en,
      i.estado,
      i.comprobante,
      i.motivo_anulacion,
      i.anulado_en,
      l.producto_id,
      coalesce(p.nombre, 'Producto no disponible') as producto_nombre,
      p.sku as producto_sku,
      l.cantidad,
      l.costo_unitario_usd,
      'Depósito principal'::text as destino,
      coalesce(e.nombre, 'Empresa no disponible') as empresa,
      coalesce(pr.razon_social, 'Proveedor no disponible') as proveedor,
      coalesce(nullif(i.actor_nombre, ''), '—') as operador
    from dominio.ingresos_mercaderia i
    join dominio.ingresos_mercaderia_lineas l on l.ingreso_id = i.id
    left join dominio.productos p on p.id = l.producto_id
    left join dominio.empresas e on e.id = i.empresa_id
    left join dominio.proveedores pr on pr.id = i.proveedor_id
    where (p_desde is null or i.fecha >= p_desde)
      and (p_hasta is null or i.fecha <= p_hasta)
      and (p_proveedor is null or i.proveedor_id = p_proveedor)
      and (p_empresa is null or i.empresa_id = p_empresa)
      and (p_producto is null or l.producto_id = p_producto)
      and (p_operador is null or i.actor_id = p_operador)
  )
  select
    f.ingreso_id, f.fecha, f.creado_en, f.estado, f.comprobante,
    f.motivo_anulacion, f.anulado_en, f.producto_id, f.producto_nombre,
    f.producto_sku, f.cantidad, f.costo_unitario_usd, f.destino, f.empresa,
    f.proveedor, f.operador,
    count(*) over () as total
  from filas f
  order by f.creado_en desc, f.ingreso_id, f.producto_nombre
  limit greatest(1, least(coalesce(p_tamano, 25), 100))
  offset (greatest(coalesce(p_pagina, 1), 1) - 1)
    * greatest(1, least(coalesce(p_tamano, 25), 100));
$$;

comment on function public.listar_ingresos_mercaderia(date, date, uuid, uuid, uuid, uuid, integer, integer) is
  'F-PRV-05: historial de ingresos por proveedor con una fila por producto, filtros y total para paginar. RLS del llamador.';

revoke execute on function public.listar_ingresos_mercaderia(date, date, uuid, uuid, uuid, uuid, integer, integer) from public, anon;
grant execute on function public.listar_ingresos_mercaderia(date, date, uuid, uuid, uuid, uuid, integer, integer) to authenticated;

-- Detalle de un ingreso: cabecera + líneas + movimientos vinculados. `security invoker`:
-- la RLS de las tablas decide si el llamador puede verlo. Devuelve null si no existe
-- o es de otra organización.
create or replace function public.detalle_ingreso_mercaderia(p_ingreso uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id,
    'fecha', i.fecha,
    'creado_en', i.creado_en,
    'estado', i.estado,
    'comprobante', i.comprobante,
    'motivo_anulacion', i.motivo_anulacion,
    'anulado_en', i.anulado_en,
    'empresa', e.nombre,
    'proveedor', pr.razon_social,
    'operador', coalesce(nullif(i.actor_nombre, ''), '—'),
    'lineas', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'producto_id', l.producto_id,
          'producto_nombre', coalesce(p.nombre, 'Producto no disponible'),
          'producto_sku', p.sku,
          'cantidad', l.cantidad,
          'costo_unitario_usd', l.costo_unitario_usd,
          'movimiento_id', l.movimiento_id,
          'movimiento_anulacion_id', l.movimiento_anulacion_id
        )
        order by p.nombre, l.producto_id
      ),
      '[]'::jsonb
    )
  )
  from dominio.ingresos_mercaderia i
  join dominio.ingresos_mercaderia_lineas l on l.ingreso_id = i.id
  left join dominio.productos p on p.id = l.producto_id
  left join dominio.empresas e on e.id = i.empresa_id
  left join dominio.proveedores pr on pr.id = i.proveedor_id
  where i.id = p_ingreso
  group by i.id, e.nombre, pr.razon_social;
$$;

comment on function public.detalle_ingreso_mercaderia(uuid) is
  'F-PRV-05: detalle de un ingreso con líneas y movimientos vinculados. RLS del llamador; null si no existe o es de otra organización.';

revoke execute on function public.detalle_ingreso_mercaderia(uuid) from public, anon;
grant execute on function public.detalle_ingreso_mercaderia(uuid) to authenticated;
