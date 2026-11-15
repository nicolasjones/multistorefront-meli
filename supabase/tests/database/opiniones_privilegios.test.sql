-- MSF-467 · Opiniones de productos, Fase 1 y 2 (T003). RF-OPI-16, SC-003.
-- Privilegios exactos por rol de las funciones nuevas y su `search_path` fijo; las internas no se ejecutan desde la API.
begin;

select plan(14);

select is(has_function_privilege('anon', 'public.listar_opiniones(text, uuid, timestamptz, uuid, integer)', 'execute'), false, 'listar_opiniones: anon no');
select is(has_function_privilege('authenticated', 'public.listar_opiniones(text, uuid, timestamptz, uuid, integer)', 'execute'), true, 'listar_opiniones: authenticated sí');
select is(has_function_privilege('anon', 'public.moderar_opinion(uuid, text, text, timestamptz)', 'execute'), false, 'moderar_opinion: anon no');
select is(has_function_privilege('authenticated', 'public.moderar_opinion(uuid, text, text, timestamptz)', 'execute'), true, 'moderar_opinion: authenticated sí');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name in ('listar_opiniones', 'moderar_opinion') and grantee in ('PUBLIC', 'anon')),
  0, 'ni public ni anon figuran con execute en las RPC del panel');
select is(
  has_function_privilege('anon', 'private.validar_texto_opinion(integer, text)', 'execute')
  or has_function_privilege('authenticated', 'private.validar_texto_opinion(integer, text)', 'execute'),
  false, 'validar_texto_opinion no es ejecutable por la API');
select is(
  has_function_privilege('anon', 'private.nombre_publico_cliente(text)', 'execute')
  or has_function_privilege('authenticated', 'private.nombre_publico_cliente(text)', 'execute'),
  false, 'nombre_publico_cliente no es ejecutable por la API');
select is(
  (select bool_and(p.prosecdef) from pg_proc p where p.oid in ('public.listar_opiniones(text, uuid, timestamptz, uuid, integer)'::regprocedure, 'public.moderar_opinion(uuid, text, text, timestamptz)'::regprocedure)),
  true, 'las RPC del panel son security definer');
select is(
  (select bool_and(coalesce(p.proconfig, '{}') @> array['search_path=""']) from pg_proc p
    where p.oid in ('public.listar_opiniones(text, uuid, timestamptz, uuid, integer)'::regprocedure, 'public.moderar_opinion(uuid, text, text, timestamptz)'::regprocedure,
                    'private.validar_texto_opinion(integer, text)'::regprocedure, 'private.nombre_publico_cliente(text)'::regprocedure)),
  true, 'todas las funciones nuevas fijan search_path vacío');
select is((select relrowsecurity from pg_class where oid = 'dominio.opiniones_producto'::regclass), true, 'rls_en_toda_tabla: la tabla nueva tiene RLS');
select is(
  (select count(*)::int from information_schema.role_table_grants where table_schema = 'dominio' and table_name = 'opiniones_producto' and grantee in ('PUBLIC', 'anon', 'authenticated')),
  0, 'privilegios_anon_endurecidos: la tabla nueva no da nada a anon, authenticated ni public');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('listar_opiniones', 'moderar_opinion') and has_function_privilege('anon', p.oid, 'execute')),
  0, 'ninguna función nueva de public es ejecutable por anon');
select is((select sensible from public.tipos_evento_actividad where tipo = 'opinion.aceptada'), false, 'opinion.aceptada no es sensible');
select is((select sensible from public.tipos_evento_actividad where tipo = 'opinion.rechazada'), false, 'opinion.rechazada no es sensible');

select * from finish();
rollback;
