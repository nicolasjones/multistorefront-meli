-- F-STK-10 (MSF-407, épica MSF-131, FR-009): lecturas del historial de lotes.
-- `security invoker`: la RLS de `lotes_stock` y `movimientos_stock` (lectura/edición en Stock,
-- por organización) decide qué ve el llamador. Esquema: sin tablas nuevas (Principio VII).
--
-- `listar_lotes_stock` devuelve además `id` (necesario para abrir el detalle con
-- `listar_movimientos_lote`); paginación por cursor sobre el número: {"numero": n}.
--
-- Migración aditiva. Reversión (en una migración posterior):
--   drop function public.listar_lotes_stock(integer, jsonb);
--   drop function public.listar_movimientos_lote(uuid);

create or replace function public.listar_lotes_stock(
  p_limite integer default 50,
  p_cursor jsonb default null
)
returns table (
  id uuid,
  numero integer,
  fecha date,
  proveedor text,
  productos bigint,
  unidades bigint,
  creado_en timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    l.id, l.numero, l.fecha, l.proveedor,
    count(m.id) as productos,
    coalesce(sum(m.cantidad), 0)::bigint as unidades,
    l.creado_en
  from dominio.lotes_stock l
  left join dominio.movimientos_stock m
    on m.lote_id = l.id and m.organizacion_id = l.organizacion_id
  where p_cursor is null
     or l.numero < (p_cursor ->> 'numero')::integer
  group by l.id
  order by l.numero desc
  limit greatest(1, least(coalesce(p_limite, 50), 100));
$$;

comment on function public.listar_lotes_stock(integer, jsonb) is
  'F-STK-10: historial de lotes de stock, más reciente primero, keyset por número. Solo lectura, security invoker (RLS).';

revoke execute on function public.listar_lotes_stock(integer, jsonb) from public, anon;
grant execute on function public.listar_lotes_stock(integer, jsonb) to authenticated;

create or replace function public.listar_movimientos_lote(p_lote uuid)
returns table (
  movimiento_id uuid,
  producto text,
  sku text,
  cantidad integer,
  saldo integer,
  creado_en timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.id, coalesce(p.nombre, 'Producto no disponible'), p.sku, m.cantidad, m.saldo, m.creado_en
  from dominio.movimientos_stock m
  left join dominio.productos p
    on p.id = m.producto_id and p.organizacion_id = m.organizacion_id
  where m.lote_id = p_lote
  order by m.creado_en, coalesce(p.nombre, ''), m.id;
$$;

comment on function public.listar_movimientos_lote(uuid) is
  'F-STK-10: movimientos de un lote de stock. Solo lectura, security invoker (RLS).';

revoke execute on function public.listar_movimientos_lote(uuid) from public, anon;
grant execute on function public.listar_movimientos_lote(uuid) to authenticated;
