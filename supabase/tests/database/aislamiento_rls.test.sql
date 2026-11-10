-- Cierre de la épica MSF-363 (FR-020, T023): aislamiento de las dos tablas nuevas de
-- `dominio` sobre los esquemas expuestos (`public` + `dominio`), con su política de
-- lectura por organización y sin escritura ni lectura para `anon`.
--
-- `rls_en_toda_tabla.test.sql` ya recorre el catálogo completo; esta prueba es la que
-- nombra FR-020 y agrega lo que ese barrido no mira: que la RLS de las dos tablas
-- nuevas tenga política (RLS habilitada sin política es un deny-all silencioso) y que
-- los grants de `authenticated`/`anon` sean los esperados.
begin;

select plan(12);

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

-- Recorrido de los esquemas expuestos (no una lista fija): una tabla nueva sin RLS
-- rompe esta prueba sin tocarla.
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
  (select coalesce(array_agg(esquema || '.' || tabla order by esquema, tabla), array[]::text[])
     from tablas_expuestas where not rls),
  array[]::text[],
  'ninguna tabla de public ni de dominio tiene RLS desactivado'
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

select is(
  (select count(distinct tablename)::int from pg_policies
    where schemaname = 'dominio'
      and tablename in ('actualizaciones_precio', 'promociones_precio')
      and qual like '%organizacion_id%'
      and qual like '%private.organizacion_id()%'),
  2, 'las políticas acotan por la organización de la sesión'
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
