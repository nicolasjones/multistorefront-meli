-- MSF-722 (bug): la búsqueda de productos y de stock distinguía tildes («camara» no encontraba «Cámara»).
-- Columnas calculadas de PostgREST con el nombre normalizado (minúsculas, sin tildes) para filtrarlas con
-- `nombre_norm.ilike.%…%` desde el cliente; la normalización es la de la búsqueda de comprobantes y de la
-- tienda (`private.normalizar_busqueda`, sobre `unaccent`).
--
-- Esquemas (Principio VII, re-verificado): no se crean tablas. Son funciones de lectura sobre relaciones
-- existentes: `public.v_productos_listado` y `public.stock_estados` (función en `public`) y
-- `dominio.productos` (función en `dominio`, donde vive la tabla). Funciones SECURITY INVOKER: la RLS
-- de cada relación sigue mandando; no abren datos nuevos. `anon` sin acceso.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.nombre_norm(public.v_productos_listado);
--   drop function public.nombre_norm(public.stock_estados);
--   drop function dominio.nombre_norm(dominio.productos);

create or replace function public.nombre_norm(p public.v_productos_listado)
returns text
language sql
stable
set search_path = ''
as $$ select private.normalizar_busqueda(p.nombre); $$;

create or replace function public.nombre_norm(p public.stock_estados)
returns text
language sql
stable
set search_path = ''
as $$ select private.normalizar_busqueda(p.nombre); $$;

create or replace function dominio.nombre_norm(p dominio.productos)
returns text
language sql
stable
set search_path = ''
as $$ select private.normalizar_busqueda(p.nombre); $$;

revoke execute on function public.nombre_norm(public.v_productos_listado) from public, anon;
revoke execute on function public.nombre_norm(public.stock_estados) from public, anon;
revoke execute on function dominio.nombre_norm(dominio.productos) from public, anon;
grant execute on function public.nombre_norm(public.v_productos_listado) to authenticated;
grant execute on function public.nombre_norm(public.stock_estados) to authenticated;
grant execute on function dominio.nombre_norm(dominio.productos) to authenticated;
