-- RF-GAS-18: los importes de gastos y la medida «margen después de costos fijos» no se exponen a ninguna otra superficie (correo
-- semanal, Inicio, comparativos, alertas, API pública). Estructural: ninguna otra función ni vista lee `dominio.gastos` ni las vistas
-- nuevas de analítica; el resultado idéntico con gastos cargados se prueba en `margen_costos_fijos_paridad.test.sql`.
begin;

select plan(5);

select is(
  (select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private', 'analitica')
      and p.prosrc ~* '(dominio\.gastos|costos_fijos_empresa_mes|margen_despues_costos_fijos|margen_costos_fijos)'
      and p.proname not in ('guardar_gasto', 'anular_gasto', 'listar_gastos', 'resumen_gastos', 'exportar_gastos', 'conjuntos_exportacion_total', 'bandera_activa')),
  '',
  'ninguna función fuera de las de Gastos y la exportación total lee gastos ni la medida nueva');

select is(
  (select coalesce(string_agg(n.nspname || '.' || c.relname, ', ' order by n.nspname, c.relname), '')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('v', 'm') and n.nspname in ('public', 'private', 'analitica', 'dominio')
      and pg_get_viewdef(c.oid) ~* '(dominio\.gastos|costos_fijos_empresa_mes|margen_despues_costos_fijos|ventas_netas_empresa_mes)'
      and c.relname not in ('costos_fijos_empresa_mes', 'ventas_netas_empresa_mes', 'margen_despues_costos_fijos', 'margen_costos_fijos_empresa_mes')),
  '',
  'ninguna otra vista lee gastos ni las vistas nuevas');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in ('resumen_inicio_bloques', 'resumen_inicio_periodo', 'armar_resumen_semanal')
      and p.prosrc ~* 'gasto'),
  0,
  'el resumen semanal y los bloques de Inicio no mencionan gastos');

select is(
  (select count(*)::int from information_schema.table_privileges
    where table_schema = 'analitica' and table_name in ('costos_fijos_empresa_mes', 'ventas_netas_empresa_mes', 'margen_despues_costos_fijos', 'margen_costos_fijos_empresa_mes')
      and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')),
  0,
  'las vistas nuevas de analítica no tienen privilegios para PUBLIC, anon, authenticated ni service_role');

select is(
  (select count(*)::int from information_schema.table_privileges
    where table_schema = 'analitica' and table_name in ('costos_fijos_empresa_mes', 'ventas_netas_empresa_mes', 'margen_despues_costos_fijos', 'margen_costos_fijos_empresa_mes')
      and grantee = 'superset_analitica' and privilege_type = 'SELECT'),
  4,
  'solo superset_analitica lee las cuatro vistas nuevas');

select * from finish();
rollback;
