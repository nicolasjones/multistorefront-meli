-- Cierre de MSF-338 (T014, FR-010): guardas de la superficie nueva de «Ventas · Reportes». Complementan
-- los tests de F-VTA-22 y F-VTA-23 con los invariantes de seguridad que no deben romperse al sumar
-- vistas o RPC: `anon` sin acceso, esquema `analitica` cerrado, rol `superset_analitica` de solo
-- lectura, columnas `organizacion_id` + `empresa_id` para la cláusula `rls` del guest token y
-- `search_path` fijo en toda función `security definer`. Esta épica NO crea tablas: el Principio VII
-- se verifica con que no aparezca ninguna tabla nueva en `analitica`.
begin;

select plan(18);

-- ============================================================================
-- Vistas: contrato de aislamiento (organización + empresa) y acceso
-- ============================================================================

select is(
  (select count(*)::int from pg_catalog.pg_class
    where relnamespace = 'analitica'::regnamespace
      and relname in ('ventas_producto_mas_vendido', 'ventas_ranking_clientes') and relkind = 'v'),
  2, 'las dos vistas de Ventas · Reportes existen en analitica y son vistas (no tablas)'
);
select is(
  (select count(*)::int from unnest(array['organizacion_id', 'empresa_id', 'empresa_nombre', 'fecha']) col
    where not exists (
      select 1 from pg_catalog.pg_attribute a
       where a.attrelid = 'analitica.ventas_producto_mas_vendido'::regclass
         and a.attname = col and a.attnum > 0 and not a.attisdropped)),
  0, 'ventas_producto_mas_vendido expone organizacion_id y empresa_id (cláusula rls) y fecha (filtro de período)'
);
select is(
  (select count(*)::int from unnest(array['organizacion_id', 'empresa_id', 'empresa_nombre', 'fecha', 'consumidor_final']) col
    where not exists (
      select 1 from pg_catalog.pg_attribute a
       where a.attrelid = 'analitica.ventas_ranking_clientes'::regclass
         and a.attname = col and a.attnum > 0 and not a.attisdropped)),
  0, 'ventas_ranking_clientes expone organizacion_id y empresa_id (cláusula rls), fecha y consumidor_final'
);
select ok(
  not has_table_privilege('anon', 'analitica.ventas_producto_mas_vendido', 'SELECT')
  and not has_table_privilege('anon', 'analitica.ventas_ranking_clientes', 'SELECT'),
  'anon no lee las vistas de Ventas · Reportes'
);
select ok(
  not has_table_privilege('authenticated', 'analitica.ventas_producto_mas_vendido', 'SELECT')
  and not has_table_privilege('authenticated', 'analitica.ventas_ranking_clientes', 'SELECT'),
  'authenticated no lee las vistas directamente (solo por la RPC con autorización adentro)'
);
select ok(
  has_table_privilege('superset_analitica', 'analitica.ventas_producto_mas_vendido', 'SELECT')
  and has_table_privilege('superset_analitica', 'analitica.ventas_ranking_clientes', 'SELECT'),
  'el rol de Superset lee las dos vistas'
);
select ok(
  not has_table_privilege('superset_analitica', 'analitica.ventas_producto_mas_vendido', 'INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('superset_analitica', 'analitica.ventas_ranking_clientes', 'INSERT,UPDATE,DELETE,TRUNCATE'),
  'el rol de Superset no escribe en las vistas de Ventas · Reportes'
);

-- ============================================================================
-- Esquema `analitica` cerrado y rol de Superset de solo lectura
-- ============================================================================

select ok(not has_schema_privilege('anon', 'analitica', 'USAGE'), 'anon sin USAGE sobre analitica');
select ok(not has_schema_privilege('authenticated', 'analitica', 'USAGE'), 'authenticated sin USAGE sobre analitica');
select is(
  (select count(*)::int from pg_catalog.pg_class
    where relnamespace = 'analitica'::regnamespace and relkind in ('r', 'p', 'f', 'm')),
  0, 'analitica sigue sin tablas: esta épica no crea tablas (Principio VII, sin tablas nuevas)'
);
select is(
  (select rolsuper or rolcreatedb or rolcreaterole or rolbypassrls from pg_catalog.pg_roles where rolname = 'superset_analitica'),
  false, 'el rol de Superset no es superusuario ni crea bases/roles ni salta RLS'
);
select ok(
  not has_table_privilege('superset_analitica', 'dominio.comprobantes_venta', 'SELECT')
  and not has_table_privilege('superset_analitica', 'dominio.comprobantes_venta_lineas', 'SELECT')
  and not has_table_privilege('superset_analitica', 'public.clientes', 'SELECT'),
  'el rol de Superset no lee las tablas de ventas ni clientes directamente (solo a través de las vistas)'
);

-- ============================================================================
-- Funciones: privilegios y search_path
-- ============================================================================

select is(
  (select count(*)::int from pg_catalog.pg_proc p
    where p.pronamespace = 'analitica'::regnamespace
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0, 'ninguna función de analitica (incluidas las de apoyo de ventas) es ejecutable por anon ni authenticated'
);
select ok(
  has_function_privilege('superset_analitica', 'analitica.comprobante_cuenta_como_facturado(text,text)', 'EXECUTE')
  and has_function_privilege('superset_analitica', 'analitica.signo_comprobante(text)', 'EXECUTE')
  and has_function_privilege('superset_analitica', 'analitica.stock_de_producto(uuid,uuid)', 'EXECUTE'),
  'el rol de Superset ejecuta las funciones de apoyo del predicado y del signo'
);
select ok(
  not has_function_privilege('anon', 'public.leer_ranking_ventas(date,date,boolean,uuid,integer,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.ventas_reportes_conteo(date,date,uuid)', 'EXECUTE'),
  'anon no ejecuta ninguna RPC de Ventas · Reportes'
);
select ok(
  has_function_privilege('authenticated', 'public.leer_ranking_ventas(date,date,boolean,uuid,integer,integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.ventas_reportes_conteo(date,date,uuid)', 'EXECUTE'),
  'authenticated ejecuta las RPC de Ventas · Reportes (la sección reportes se controla adentro)'
);
select is(
  (select count(*)::int from pg_catalog.pg_proc p
    where (p.pronamespace = 'analitica'::regnamespace
           or p.oid in ('public.leer_ranking_ventas(date,date,boolean,uuid,integer,integer)'::regprocedure,
                        'public.ventas_reportes_conteo(date,date,uuid)'::regprocedure))
      and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg where cfg like 'search_path=%')),
  0, 'toda función security definer de la superficie fija search_path'
);
select is(
  (select count(*)::int from pg_catalog.pg_proc p
    where p.oid in ('public.leer_ranking_ventas(date,date,boolean,uuid,integer,integer)'::regprocedure,
                    'public.ventas_reportes_conteo(date,date,uuid)'::regprocedure)
      and p.prosecdef
      and has_function_privilege('public', p.oid, 'EXECUTE')),
  0, 'ninguna RPC security definer de Ventas · Reportes queda ejecutable por PUBLIC'
);

select * from finish();
rollback;
