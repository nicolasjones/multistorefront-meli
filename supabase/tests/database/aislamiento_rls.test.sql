-- Cierre de la épica MSF-363 (FR-020, T023): aislamiento de las dos tablas nuevas de
-- `dominio` sobre los esquemas expuestos (`public` + `dominio`), con su política de
-- lectura por organización y sin escritura ni lectura para `anon`.
--
-- `rls_en_toda_tabla.test.sql` es el dueño del invariante «toda tabla expuesta tiene
-- RLS». Esta prueba usa el mismo catálogo `public` + `dominio` para acotar las dos
-- tablas nuevas (FR-020) y agrega lo que ese barrido no mira: que cada una tenga
-- política (RLS habilitada sin política es un deny-all silencioso), que la política
-- compare `organizacion_id` con la de la sesión y que los grants de
-- `authenticated`/`anon` sean los esperados.
begin;

select plan(11);

-- Esquema (Principio VII): las dos tablas son datos de negocio → `dominio`.
select is(
  (select array_agg(n.nspname || '.' || c.relname order by c.relname)
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where c.relname in ('actualizaciones_precio', 'promociones_precio')
      and c.relkind = 'r'),
  array['dominio.actualizaciones_precio', 'dominio.promociones_precio'],
  'las dos tablas nuevas viven en dominio'
);

-- Catálogo acotado de los esquemas expuestos para ubicar las dos tablas nuevas; el
-- invariante general de RLS lo verifica `rls_en_toda_tabla.test.sql`.
create temp table tablas_expuestas on commit drop as
select n.nspname as esquema, c.relname as tabla, c.relrowsecurity as rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'dominio')
  and c.relkind in ('r', 'p')
  and not c.relispartition
  and not exists (
    select 1 from pg_depend d
    where d.classid = 'pg_class'::regclass
      and d.objid = c.oid
      and d.deptype = 'e'
  );

select cmp_ok(
  (select count(*)::int from tablas_expuestas), '>', 0,
  'el recorrido encuentra tablas expuestas en public y dominio (no pasa en vacío)'
);

select is(
  (select count(*)::int from tablas_expuestas
    where esquema = 'dominio'
      and tabla in ('actualizaciones_precio', 'promociones_precio')
      and not rls),
  0, 'las dos tablas nuevas tienen RLS activada'
);

-- La RLS habilitada sin política deja la tabla inaccesible para todos: se exige la
-- política de lectura que diseño la épica.
select is(
  (select count(distinct tablename)::int from pg_policies
    where schemaname = 'dominio'
      and tablename in ('actualizaciones_precio', 'promociones_precio')),
  2, 'cada tabla nueva tiene su política'
);

select is(
  (select count(distinct tablename)::int from pg_policies
    where schemaname = 'dominio'
      and tablename in ('actualizaciones_precio', 'promociones_precio')
      and cmd = 'SELECT'
      and roles = array['authenticated']::name[]),
  2, 'las políticas son SELECT para authenticated'
);

-- Igual que en `stock_carga_exportacion_avisos_cierre.test.sql`: la política tiene que
-- COMPARAR la columna `organizacion_id` con la de la sesión. El nombre de la función
-- `private.organizacion_id()` también contiene ese texto, así que un `like` aceptaría
-- una política que llame a la función sin filtrar por la columna.
select is(
  (select count(distinct c.relname)::int
     from pg_policy pol
     join pg_class c on c.oid = pol.polrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'dominio'
      and c.relname in ('actualizaciones_precio', 'promociones_precio')
      and pol.polcmd = 'r'
      and pg_get_expr(pol.polqual, pol.polrelid) ~ 'organizacion_id[[:space:]]*='),
  2, 'las políticas comparan organizacion_id con la de la sesión'
);

select is(
  (select count(*)::int
     from unnest(array['actualizaciones_precio', 'promociones_precio']) t(tabla)
    where has_table_privilege('authenticated', format('dominio.%I', tabla), 'SELECT')),
  2, 'authenticated lee las dos tablas nuevas'
);

select is(
  (select count(*)::int
     from unnest(array['actualizaciones_precio', 'promociones_precio']) t(tabla)
     cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p(privilegio)
    where has_table_privilege('authenticated', format('dominio.%I', tabla), privilegio)),
  0, 'authenticated no escribe directamente: solo lo hacen las RPC'
);

select is(
  (select count(*)::int
     from unnest(array['actualizaciones_precio', 'promociones_precio']) t(tabla)
     cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p(privilegio)
    where has_table_privilege('anon', format('dominio.%I', tabla), privilegio)),
  0, 'anon no lee ni escribe las tablas nuevas'
);

select is(
  (select count(*)::int
     from unnest(array[
       'public.previsualizar_actualizacion_precios(text, jsonb)',
       'public.aplicar_actualizacion_precios(text, jsonb, uuid)',
       'public.guardar_promocion_precio(uuid, uuid, uuid, numeric, timestamptz, timestamptz, timestamptz)',
       'public.anular_promocion_precio(uuid, timestamptz)']) f(firma)
    where has_function_privilege('anon', f.firma, 'EXECUTE')),
  0, 'anon no ejecuta ninguna de las cuatro RPC nuevas'
);

select is(
  (select count(*)::int
     from unnest(array[
       'public.previsualizar_actualizacion_precios(text, jsonb)',
       'public.aplicar_actualizacion_precios(text, jsonb, uuid)',
       'public.guardar_promocion_precio(uuid, uuid, uuid, numeric, timestamptz, timestamptz, timestamptz)',
       'public.anular_promocion_precio(uuid, timestamptz)']) f(firma)
    where has_function_privilege('authenticated', f.firma, 'EXECUTE')),
  4, 'authenticated ejecuta las cuatro RPC nuevas (los permisos se validan adentro)'
);

select * from finish();

rollback;
