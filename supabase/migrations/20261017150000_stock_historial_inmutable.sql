-- F-STK-03 (MSF-173, épica MSF-136, spec 20261017-120000-stock-movimientos,
-- FR-011, FR-012): historial de movimientos inmodificable y de solo lectura.
--
-- Esquema (Principio VII): no se crea ninguna tabla. `dominio.movimientos_stock` (dominio
-- del producto) ya existe desde F-STK-02; acá se la blinda y se agrega una RPC de lectura
-- en `public` (las RPC que llama la app viven en `public`, como el resto de las RPC).
--
-- 1. Disparador `BEFORE UPDATE OR DELETE` que siempre rechaza, incluso para el propietario
--    de la función que escribe (la RPC security definer solo inserta). Además
--    `BEFORE TRUNCATE` por sentencia y `revoke update, delete, truncate` a los roles de la app.
-- 2. `public.listar_movimientos_stock`: *security invoker* → rige la RLS por organización y
--    `nivel_seccion('stock')` (`ninguno` no recibe filas). Paginación en servidor con tope
--    de 100, total y filtro opcional por producto. El producto se une por `left join`: si la
--    persona ve Stock pero no Catálogo, el movimiento igual aparece (sin nombre).
--    `anon` sin acceso; `authenticated` con grant explícito.
--
-- Migración aditiva. Reversión (en una migración posterior):
--   drop function public.listar_movimientos_stock(uuid, integer, integer);
--   drop trigger movimientos_stock_inmutable_fila on dominio.movimientos_stock;
--   drop trigger movimientos_stock_inmutable_truncate on dominio.movimientos_stock;
--   drop function private.rechazar_cambio_movimiento_stock();

create or replace function private.rechazar_cambio_movimiento_stock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Los movimientos de stock no se pueden modificar' using errcode = '42501';
end;
$$;

revoke execute on function private.rechazar_cambio_movimiento_stock() from public, anon, authenticated;

create trigger movimientos_stock_inmutable_fila
  before update or delete on dominio.movimientos_stock
  for each row execute function private.rechazar_cambio_movimiento_stock();

create trigger movimientos_stock_inmutable_truncate
  before truncate on dominio.movimientos_stock
  for each statement execute function private.rechazar_cambio_movimiento_stock();

revoke update, delete, truncate on dominio.movimientos_stock from public, anon, authenticated;

create or replace function public.listar_movimientos_stock(
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
  total bigint
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
    count(*) over ()
  from dominio.movimientos_stock m
  left join dominio.productos p
    on p.id = m.producto_id and p.organizacion_id = m.organizacion_id
  left join dominio.motivos_movimiento mo
    on mo.id = m.motivo_id and mo.organizacion_id = m.organizacion_id
  where (p_producto is null or m.producto_id = p_producto)
  order by m.creado_en desc, m.id desc
  limit greatest(1, least(coalesce(p_limite, 25), 100))
  offset greatest(0, coalesce(p_desplazamiento, 0));
$$;

comment on function public.listar_movimientos_stock(uuid, integer, integer) is
  'Historial de movimientos de stock (F-STK-03). Solo lectura, security invoker (RLS), paginado con tope 100 y total.';

revoke execute on function public.listar_movimientos_stock(uuid, integer, integer) from public, anon;
grant execute on function public.listar_movimientos_stock(uuid, integer, integer) to authenticated;
