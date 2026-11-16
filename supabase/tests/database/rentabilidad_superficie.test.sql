-- Cierre de MSF-120 (T031, FR-024): guardas de la superficie de Rentabilidad. Complementan los
-- tests de cada historia con invariantes que no deben romperse al sumar vistas o funciones:
-- el esquema `analitica` queda cerrado para `anon`/`authenticated`, solo tiene vistas con
-- `organizacion_id` (la cláusula `rls` del guest token filtra por esa columna), el rol de
-- Superset es de solo lectura y las funciones `security definer` fijan `search_path`.
begin;

select plan(17);

-- ============================================================================
-- Esquema `analitica` cerrado y solo de vistas
-- ============================================================================

select ok(not has_schema_privilege('anon', 'analitica', 'USAGE'), 'anon sin USAGE sobre analitica');
select ok(not has_schema_privilege('authenticated', 'analitica', 'USAGE'), 'authenticated sin USAGE sobre analitica');
select ok(has_schema_privilege('superset_analitica', 'analitica', 'USAGE'), 'el rol de Superset usa analitica');

select is(
  (select count(*)::int from pg_catalog.pg_class
    where relnamespace = 'analitica'::regnamespace and relkind in ('r', 'p', 'f', 'm')),
  0, 'analitica no tiene tablas ni vistas materializadas: solo vistas (el aislamiento no queda a medias)'
);
select is(
  (select count(*)::int from pg_catalog.pg_class c
    where c.relnamespace = 'analitica'::regnamespace and c.relkind = 'v'
      and not exists (
        select 1 from pg_catalog.pg_attribute a
         where a.attrelid = c.oid and a.attname = 'organizacion_id' and a.attnum > 0 and not a.attisdropped)),
  0, 'toda vista de analitica expone organizacion_id (lo exige la cláusula rls del guest token)'
);
select is(
  (select count(*)::int from pg_catalog.pg_class c
    where c.relnamespace = 'analitica'::regnamespace and c.relkind = 'v'
      and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'SELECT'))),
  0, 'ninguna vista de analitica es legible por anon ni authenticated'
);
select is(
  (select count(*)::int from pg_catalog.pg_class c
    where c.relnamespace = 'analitica'::regnamespace and c.relkind = 'v'
      and not has_table_privilege('superset_analitica', c.oid, 'SELECT')),
  0, 'el rol de Superset lee todas las vistas de analitica'
);
select is(
  (select count(*)::int from pg_catalog.pg_class c
    where c.relnamespace = 'analitica'::regnamespace and c.relkind = 'v'
      and has_table_privilege('superset_analitica', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),
  0, 'el rol de Superset no escribe en ninguna vista de analitica'
);

-- ============================================================================
-- Rol de Superset: solo lectura de analitica
-- ============================================================================

select is(
  (select rolsuper or rolcreatedb or rolcreaterole or rolbypassrls from pg_catalog.pg_roles where rolname = 'superset_analitica'),
  false, 'el rol de Superset no es superusuario ni crea bases/roles ni salta RLS'
);
select ok(
  not has_table_privilege('superset_analitica', 'dominio.productos', 'SELECT')
  and not has_table_privilege('superset_analitica', 'dominio.producto_costos', 'SELECT')
  and not has_table_privilege('superset_analitica', 'dominio.rentabilidad_config', 'SELECT'),
  'el rol de Superset no lee tablas de dominio directamente (solo a través de las vistas)'
);

-- ============================================================================
-- Funciones: privilegios y search_path
-- ============================================================================

select is(
  (select count(*)::int from pg_catalog.pg_proc p
    where p.pronamespace = 'analitica'::regnamespace
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0, 'ninguna función de analitica es ejecutable por anon ni authenticated'
);
select is(
  (select count(*)::int from pg_catalog.pg_proc p
    where (p.pronamespace = 'analitica'::regnamespace
           or p.oid = 'public.rentabilidad_conteo_margen()'::regprocedure)
      and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg where cfg like 'search_path=%')),
  0, 'toda función security definer de la superficie fija search_path'
);
select ok(
  not has_function_privilege('anon', 'public.leer_umbral_margen_bajo()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.guardar_umbral_margen_bajo(numeric, timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.rentabilidad_conteo_margen()', 'EXECUTE'),
  'anon no ejecuta ninguna RPC de Rentabilidad'
);
select ok(
  has_function_privilege('authenticated', 'public.leer_umbral_margen_bajo()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.guardar_umbral_margen_bajo(numeric, timestamptz)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.rentabilidad_conteo_margen()', 'EXECUTE'),
  'authenticated ejecuta las RPC de Rentabilidad (el control de sección está adentro)'
);
select is(
  (select count(*)::int from pg_catalog.pg_proc p
    where p.oid in ('public.leer_umbral_margen_bajo()'::regprocedure,
                    'public.guardar_umbral_margen_bajo(numeric, timestamptz)'::regprocedure)
      and p.prosecdef),
  0, 'leer/guardar el umbral son security invoker: rige la RLS de rentabilidad_config'
);

-- ============================================================================
-- Tabla de configuración (esquema `dominio`, Principio VII)
-- ============================================================================

select is(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'dominio.rentabilidad_config'::regclass),
  true, 'dominio.rentabilidad_config tiene RLS habilitada'
);
select is(
  (select count(*)::int from pg_catalog.pg_class
    where oid in ('dominio.rentabilidad_config'::regclass) and relnamespace = 'dominio'::regnamespace),
  1, 'la configuración de Rentabilidad vive en dominio, no en public'
);

select * from finish();
rollback;
