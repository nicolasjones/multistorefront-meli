-- Cierre de MSF-140 (T013, FR-010): guardas de la superficie nueva de los reportes de inventario.
-- Complementan los tests de F-REP-01/02 con los invariantes de seguridad que no deben romperse:
-- `anon`/`authenticated` sin acceso a `analitica`, rol `superset_analitica` de solo lectura, columna
-- `organizacion_id` para la cláusula `rls` del guest token y ninguna tabla nueva (Principio VII).
begin;

select plan(11);

select is(
  (select count(*)::int from pg_catalog.pg_class
    where relnamespace = 'analitica'::regnamespace
      and relname in ('inventario_productos_stock', 'inventario_reposicion') and relkind = 'v'),
  2, 'las dos vistas de inventario existen en analitica y son vistas (no tablas)'
);
select is(
  (select count(*)::int from unnest(array['inventario_productos_stock', 'inventario_reposicion']) v
    where not exists (
      select 1 from pg_catalog.pg_attribute a
       where a.attrelid = ('analitica.' || v)::regclass
         and a.attname = 'organizacion_id' and a.attnum > 0 and not a.attisdropped)),
  0, 'ambas vistas exponen organizacion_id (cláusula rls del guest token)'
);
select ok(
  not has_table_privilege('anon', 'analitica.inventario_productos_stock', 'SELECT')
  and not has_table_privilege('anon', 'analitica.inventario_reposicion', 'SELECT'),
  'anon no lee las vistas de inventario'
);
select ok(
  not has_table_privilege('authenticated', 'analitica.inventario_productos_stock', 'SELECT')
  and not has_table_privilege('authenticated', 'analitica.inventario_reposicion', 'SELECT'),
  'authenticated no lee las vistas de inventario directamente'
);
select ok(
  has_table_privilege('superset_analitica', 'analitica.inventario_productos_stock', 'SELECT')
  and has_table_privilege('superset_analitica', 'analitica.inventario_reposicion', 'SELECT'),
  'el rol de Superset lee las dos vistas'
);
select ok(
  not has_table_privilege('superset_analitica', 'analitica.inventario_productos_stock', 'INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('superset_analitica', 'analitica.inventario_reposicion', 'INSERT,UPDATE,DELETE,TRUNCATE'),
  'el rol de Superset no escribe en las vistas de inventario'
);
select ok(not has_schema_privilege('anon', 'analitica', 'USAGE'), 'anon sin USAGE sobre analitica');
select ok(not has_schema_privilege('authenticated', 'analitica', 'USAGE'), 'authenticated sin USAGE sobre analitica');
select is(
  (select count(*)::int from pg_catalog.pg_class
    where relnamespace = 'analitica'::regnamespace and relkind in ('r', 'p', 'f', 'm')),
  0, 'analitica sigue sin tablas: los reportes de inventario no crean tablas (Principio VII)'
);
select is(
  (select rolsuper or rolcreatedb or rolcreaterole or rolbypassrls from pg_catalog.pg_roles where rolname = 'superset_analitica'),
  false, 'el rol de Superset no es superusuario ni crea bases/roles ni salta RLS'
);
-- Decisión 3: el costo llega al tablero por la vista (dueño), no por acceso directo a la tabla.
select ok(
  not has_table_privilege('superset_analitica', 'dominio.producto_costos', 'SELECT')
  and not has_table_privilege('authenticated', 'analitica.inventario_productos_stock', 'SELECT'),
  'el rol de Superset no lee producto_costos directamente: el costo solo sale por la vista, tras el token de la sección stock'
);

select * from finish();
rollback;
