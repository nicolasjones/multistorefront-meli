-- T019 (SC-002, MSF-180): seed de ~5.000 clientes mixtos y EXPLAIN de búsqueda y paginación.
-- Manual: todo corre en una transacción que termina en ROLLBACK (nada persiste, pero el insert toma locks).
-- SOLO contra la base LOCAL de `pnpm dev:supabase`: nunca apuntar $DATABASE_URL a una base compartida.
-- Corre como owner (sin RLS ni private.organizacion_id()): compara el plan del índice, no el de la RPC.
-- Uso (con `pnpm dev:supabase` corriendo):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/verificacion/clientes_explain.sql
-- Resultado esperado: el plan de la búsqueda parcial usa `clientes_busqueda_trgm_idx` (Bitmap Index Scan)
-- y el de la paginación por defecto usa `clientes_org_nombre_idx`. Si no, ajustar el índice M1.
-- Con 5.000 filas el planner puede preferir Seq Scan aunque el índice sea válido: por eso la búsqueda
-- se corre dos veces (la segunda con enable_seqscan = off) para comprobar que el índice es utilizable.
begin;

insert into public.organizaciones (id, nombre)
values ('00000000-0000-0000-0000-000000000019', 'Org T019')
on conflict do nothing;

insert into public.clientes (organizacion_id, nombre, documento, correo, localidad, tipo, archivado_en)
select '00000000-0000-0000-0000-000000000019',
       (array['José','María','Ñandú','Sofía','Andrés','Luciana'])[1 + g % 6] || ' Cliente ' || g,
       lpad((20000000 + g)::text, 8, '0'),
       'cliente' || g || '@ejemplo.test',
       (array['Córdoba','Rosario','Mendoza','Tucumán'])[1 + g % 4],
       case when g % 3 = 0 then 'mayorista' else 'minorista' end,
       case when g % 10 = 0 then now() end
  from generate_series(1, 5000) g;

analyze public.clientes;

-- Búsqueda parcial (mismo predicado que public.buscar_clientes).
explain (analyze, buffers)
select c.id from public.clientes c
 where c.organizacion_id = '00000000-0000-0000-0000-000000000019'
   and c.archivado_en is null
   and lower(coalesce(c.nombre, '') || ' ' || coalesce(c.documento, '') || ' ' || coalesce(c.correo, '') || ' '
       || coalesce(c.telefono, '') || ' ' || coalesce(c.celular, '') || ' ' || coalesce(c.localidad, '') || ' '
       || c.numero::text) like '%andrés cliente 42%';  -- sin unaccent: el índice es lower() puro, la tilde cuenta

-- Misma búsqueda forzando el índice (descarta el falso negativo por tamaño de tabla).
set local enable_seqscan = off;
explain (analyze, buffers)
select c.id from public.clientes c
 where c.organizacion_id = '00000000-0000-0000-0000-000000000019'
   and c.archivado_en is null
   and lower(coalesce(c.nombre, '') || ' ' || coalesce(c.documento, '') || ' ' || coalesce(c.correo, '') || ' '
       || coalesce(c.telefono, '') || ' ' || coalesce(c.celular, '') || ' ' || coalesce(c.localidad, '') || ' '
       || c.numero::text) like '%andrés cliente 42%';
reset enable_seqscan;

-- Paginación por defecto (orden por nombre, página 3 de 25).
explain (analyze, buffers)
select c.id from public.clientes c
 where c.organizacion_id = '00000000-0000-0000-0000-000000000019' and c.archivado_en is null
 order by lower(c.nombre), c.id limit 25 offset 50;

rollback;
