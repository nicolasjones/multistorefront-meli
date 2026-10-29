-- F-STK-14 (MSF-316, épica MSF-292, spec 20261022-180000-stock-depositos-y-reservas,
-- FR-005, FR-011, FR-012): lecturas de stock por depósito.
-- Esquema (Principio VII): sin tablas nuevas. Vistas de solo lectura en `public` (contrato que
-- consume la app, como `stock_estados`) sobre tablas de `dominio`; `security_invoker`: rige la
-- RLS de quien consulta (organización y `nivel_seccion('stock')`). `anon` sin acceso.
--
--   public.stock_estados          (ampliada) + reservado, disponible (columnas al final); el
--                                 estado pasa a calcularse sobre el DISPONIBLE total
--                                 (cantidad − reservado): sin_stock = 0, stock_bajo <= mínimo.
--                                 Con reservado = 0 el resultado es idéntico al anterior.
--   public.stock_por_deposito     (nueva)    cantidad / reservado / disponible por producto y depósito.
--   public.depositos_listado      (nueva)    depósitos con «Venden desde acá» (empresas y empresa_ids),
--                                 productos con stock y unidades (tabla de la pantalla Depósitos).
--   public.listar_movimientos_stock (ampliada) + deposito_id, deposito_nombre (columnas al final).
--
-- Migración aditiva. Reversión (migración posterior):
--   drop view public.depositos_listado, public.stock_por_deposito;
--   restaurar `public.stock_estados` de 20261017160000_stock_minimo_y_estados.sql;
--   restaurar `public.listar_movimientos_stock` de 20261017150000_stock_historial_inmutable.sql.

-- ============================================================================
-- stock_estados: estado sobre el disponible (FR-011)
-- ============================================================================

create or replace view public.stock_estados
with (security_invoker = true) as
select
  p.id as producto_id,
  p.organizacion_id,
  p.nombre,
  p.sku,
  p.activo,
  e.cantidad,
  e.minimo,
  case
    when e.cantidad - e.reservado <= 0 then 'sin_stock'
    when e.cantidad - e.reservado <= e.minimo then 'stock_bajo'
    else 'disponible'
  end as estado,
  e.ultimo_movimiento_en,
  e.reservado,
  e.cantidad - e.reservado as disponible
from dominio.productos p
join dominio.existencias e
  on e.producto_id = p.id and e.organizacion_id = p.organizacion_id;

comment on view public.stock_estados is
  'F-STK-05/F-STK-14: stock total, reservado, disponible, mínimo y estado (sin_stock / stock_bajo / disponible, calculado sobre el disponible) por producto. security_invoker; contrato para Inicio (MSF-156) y MSF-231.';

-- ============================================================================
-- stock_por_deposito (FR-011, D-4)
-- ============================================================================

create view public.stock_por_deposito
with (security_invoker = true) as
select
  x.producto_id,
  x.deposito_id,
  x.organizacion_id,
  x.cantidad,
  x.reservado,
  x.cantidad - x.reservado as disponible
from dominio.existencias_deposito x;

comment on view public.stock_por_deposito is
  'F-STK-14: cantidad, reservado y disponible por producto y depósito. security_invoker (RLS por organización y sección Stock). Un producto sin fila tiene 0 en ese depósito.';

revoke all on public.stock_por_deposito from public, anon, authenticated;
grant select on public.stock_por_deposito to authenticated;

-- ============================================================================
-- depositos_listado (FR-005): la tabla de la pantalla Depósitos
-- ============================================================================

create view public.depositos_listado
with (security_invoker = true) as
select
  d.id,
  d.organizacion_id,
  d.nombre,
  d.direccion,
  d.activo,
  d.por_defecto,
  coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre) order by e.nombre, e.id)
      from dominio.depositos_empresas de
      join dominio.empresas e on e.id = de.empresa_id
     where de.deposito_id = d.id
  ), '[]'::jsonb) as empresas,
  coalesce((
    select array_agg(de.empresa_id)
      from dominio.depositos_empresas de
     where de.deposito_id = d.id
  ), '{}'::uuid[]) as empresa_ids,
  (select count(*) from dominio.existencias_deposito x
    where x.deposito_id = d.id and x.cantidad > 0) as productos_con_stock,
  coalesce((select sum(x.cantidad) from dominio.existencias_deposito x
             where x.deposito_id = d.id), 0)::bigint as unidades,
  d.creado_en
from dominio.depositos d;

comment on view public.depositos_listado is
  'F-STK-14: depósitos con empresas «Venden desde acá», productos con stock y unidades. security_invoker (RLS por organización y sección Stock).';

revoke all on public.depositos_listado from public, anon, authenticated;
grant select on public.depositos_listado to authenticated;

-- ============================================================================
-- listar_movimientos_stock: + Depósito (FR-012). Cambia el tipo de retorno → drop + create.
-- ============================================================================

drop function IF EXISTS public.listar_movimientos_stock(uuid, integer, integer);

create function public.listar_movimientos_stock(
  p_producto uuid default null,
  p_limite integer default 25,
  p_desplazamiento integer default 0
)
returns table (
  id uuid,
  fecha date,
  creado_en timestamptz,
  producto_id uuid,
  producto_nombre text,
  producto_sku text,
  tipo text,
  motivo text,
  nota text,
  cantidad integer,
  diferencia integer,
  saldo integer,
  responsable text,
  total bigint,
  deposito_id uuid,
  deposito_nombre text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    m.id,
    m.fecha,
    m.creado_en,
    m.producto_id,
    p.nombre,
    p.sku,
    m.tipo,
    mo.nombre,
    m.nota,
    m.cantidad,
    m.diferencia,
    m.saldo,
    m.actor_nombre,
    count(*) over (),
    m.deposito_id,
    dep.nombre
  from dominio.movimientos_stock m
  left join dominio.productos p
    on p.id = m.producto_id and p.organizacion_id = m.organizacion_id
  left join dominio.motivos_movimiento mo
    on mo.id = m.motivo_id and mo.organizacion_id = m.organizacion_id
  left join dominio.depositos dep
    on dep.id = m.deposito_id and dep.organizacion_id = m.organizacion_id
  where (p_producto is null or m.producto_id = p_producto)
  order by m.creado_en desc, m.id desc
  limit greatest(1, least(coalesce(p_limite, 25), 100))
  offset greatest(0, coalesce(p_desplazamiento, 0));
$$;

comment on function public.listar_movimientos_stock(uuid, integer, integer) is
  'Historial de movimientos de stock (F-STK-03, + depósito en F-STK-14). Solo lectura, security invoker (RLS), paginado con tope 100 y total.';

revoke execute on function public.listar_movimientos_stock(uuid, integer, integer) from public, anon;
grant execute on function public.listar_movimientos_stock(uuid, integer, integer) to authenticated;
