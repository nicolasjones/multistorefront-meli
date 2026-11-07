-- MSF-354 (F-IMP-01, SC-003): tablas `public.procesos_masivos` y `public.procesos_masivos_errores`
-- (RLS solo administradores de la organización, sin escritura directa, `anon` sin privilegios) y
-- `iniciar_proceso_masivo` (permisos, validaciones, proceso + ejecución + orden de despacho en una
-- transacción, simultáneas). El fixture corre como postgres (RLS no aplica); las verificaciones, con
-- el rol que corresponda.
begin;

select plan(28);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000011', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000012', 'miembro-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000011', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'miembro'),
  ('d2000000-0000-0000-0000-000000000011', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a2000000-0000-0000-0000-0000000000a1', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into sistemas_externos (id, descripcion) values ('procesos-prueba', 'Sistema de prueba de procesos masivos')
on conflict (id) do nothing;
insert into conexiones (id, organizacion_id, sistema_externo, credencial_vault_id) values
  ('c1000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'procesos-prueba', gen_random_uuid()),
  ('c2000000-0000-0000-0000-0000000000c1', '22222222-2222-2222-2222-222222222222', 'procesos-prueba', gen_random_uuid());
insert into capacidades_ejecucion (organizacion_id, conexion_id, clave, tiempo_max_seg) values
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-0000000000c1', 'carga-a', 3600),
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-0000000000c1', 'carga-b', 3600),
  ('22222222-2222-2222-2222-222222222222', 'c2000000-0000-0000-0000-0000000000c1', 'carga-a', 3600);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Estructura: esquema, RLS y grants (FR-001, FR-010)
-- ============================================================================

select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and tablename in ('procesos_masivos', 'procesos_masivos_errores')),
  2,
  'las dos tablas de procesos masivos viven en el esquema public'
);

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('procesos_masivos', 'procesos_masivos_errores') and c.relrowsecurity),
  2,
  'las dos tablas tienen RLS activado'
);

select ok(
  not has_function_privilege('anon', 'public.iniciar_proceso_masivo(uuid, text, text, text, text, uuid, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.iniciar_proceso_masivo(uuid, text, text, text, text, uuid, jsonb)', 'execute'),
  'iniciar_proceso_masivo: authenticated sí, anon no'
);

-- ============================================================================
-- iniciar_proceso_masivo (FR-004)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000012');

select throws_ok(
  $$ select public.iniciar_proceso_masivo('c1000000-0000-0000-0000-0000000000c1', 'carga-a', 'importacion', 'catalogo', 'Carga') $$,
  '42501', null, 'quien no es administrador no inicia procesos'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000011');

select throws_ok(
  $$ select public.iniciar_proceso_masivo('c1000000-0000-0000-0000-0000000000c1', 'carga-a', 'migracion', 'catalogo', 'Carga') $$,
  '22023', null, 'un tipo desconocido se rechaza'
);

select throws_ok(
  $$ select public.iniciar_proceso_masivo('c1000000-0000-0000-0000-0000000000c1', 'carga-a', 'importacion', 'catalogo', '   ') $$,
  '22023', null, 'el nombre es obligatorio'
);

select throws_ok(
  $$ select public.iniciar_proceso_masivo('c2000000-0000-0000-0000-0000000000c1', 'carga-a', 'importacion', 'catalogo', 'Carga') $$,
  '42501', null, 'una conexión de otra organización se rechaza'
);

select throws_ok(
  $$ select public.iniciar_proceso_masivo('c1000000-0000-0000-0000-0000000000c1', 'carga-a', 'importacion', 'catalogo', 'Carga',
       'a2000000-0000-0000-0000-0000000000a1') $$,
  '22023', null, 'una empresa de otra organización se rechaza'
);

select throws_ok(
  $$ select public.iniciar_proceso_masivo('c1000000-0000-0000-0000-0000000000c1', 'carga-a', 'importacion', 'catalogo', 'Carga',
       null, '{"clave":"password=hunter2"}'::jsonb) $$,
  'P0001', null, 'los parámetros con forma de credencial se rechazan'
);

select throws_ok(
  $$ select public.iniciar_proceso_masivo('c1000000-0000-0000-0000-0000000000c1', 'no-existe', 'importacion', 'catalogo', 'Carga') $$,
  'P0001', null, 'una capacidad no registrada se rechaza con el error del ciclo'
);

select lives_ok(
  $$ select set_config('t.p1', public.iniciar_proceso_masivo(
       'c1000000-0000-0000-0000-0000000000c1', 'carga-a', 'importacion', 'catalogo', 'Carga de productos',
       'a1000000-0000-0000-0000-0000000000a1', '{"archivo":"productos.csv"}'::jsonb)::text, false) $$,
  'un administrador inicia un proceso masivo'
);

select is(
  (select estado || '/' || tipo || '/' || funcionalidad || '/' || procesados || '/' || con_errores || '/' || cancelacion_solicitada
    from public.procesos_masivos where id = current_setting('t.p1')::uuid),
  'pendiente/importacion/catalogo/0/0/false',
  'el proceso nace pendiente, sin avance ni errores'
);

select is(
  (select empresa_id::text || '/' || solicitado_por::text from public.procesos_masivos where id = current_setting('t.p1')::uuid),
  'a1000000-0000-0000-0000-0000000000a1/d1000000-0000-0000-0000-000000000011',
  'guarda la empresa y quién lo solicitó (FR-003)'
);

select is(
  (select count(*)::int from public.procesos_masivos p
     join public.ejecuciones_worker e on e.id = p.ejecucion_id
     join public.despachos_ejecucion d on d.ejecucion_id = e.id
    where p.id = current_setting('t.p1')::uuid
      and e.estado = 'en_curso' and e.origen = 'manual'
      and e.actor = 'd1000000-0000-0000-0000-000000000011'
      and d.estado = 'pendiente'
      and e.detalle->>'proceso_id' = p.id::text),
  1,
  'nacen en la misma transacción el proceso, su ejecución auditable y su orden de despacho'
);

select throws_ok(
  $$ select public.iniciar_proceso_masivo('c1000000-0000-0000-0000-0000000000c1', 'carga-a', 'importacion', 'catalogo', 'Otra') $$,
  'P0001', null, 'una segunda carga de la misma capacidad en curso falla con YA_EN_CURSO'
);

select lives_ok(
  $$ select set_config('t.p2', public.iniciar_proceso_masivo(
       'c1000000-0000-0000-0000-0000000000c1', 'carga-b', 'exportacion', 'exportacion-total', 'Exportación total')::text, false) $$,
  'otra capacidad inicia una exportación sin empresa'
);

select is(
  (select tipo || '/' || coalesce(empresa_id::text, 'toda la organización') from public.procesos_masivos where id = current_setting('t.p2')::uuid),
  'exportacion/toda la organización',
  'la empresa es opcional (FR-003)'
);

-- ============================================================================
-- Lectura y escritura (FR-010, SC-003)
-- ============================================================================

select is(
  (select count(*)::int from public.procesos_masivos),
  2,
  'el administrador lee los procesos de su organización'
);

select is(
  (select count(*)::int from public.procesos_masivos_errores),
  0,
  'el administrador lee los errores (ninguno todavía)'
);

select throws_ok(
  $$ insert into public.procesos_masivos (organizacion_id, tipo, funcionalidad, nombre)
     values ('11111111-1111-1111-1111-111111111111', 'importacion', 'x', 'x') $$,
  '42501', null, 'el administrador no inserta procesos directamente'
);

select throws_ok(
  $$ update public.procesos_masivos set estado = 'completado' $$,
  '42501', null, 'el administrador no actualiza procesos directamente'
);

select throws_ok(
  $$ delete from public.procesos_masivos $$,
  '42501', null, 'el administrador no borra procesos directamente'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000012');

select is(
  (select count(*)::int from public.procesos_masivos),
  0,
  'un miembro que no es administrador no lee procesos'
);

select pg_temp.como('d2000000-0000-0000-0000-000000000011');

select is(
  (select count(*)::int from public.procesos_masivos),
  0,
  'el administrador de otra organización no lee procesos ajenos'
);

reset role;
set local role anon;

select throws_ok(
  $$ select count(*) from public.procesos_masivos $$,
  '42501', null, 'anon no tiene privilegios sobre procesos_masivos'
);

select throws_ok(
  $$ select count(*) from public.procesos_masivos_errores $$,
  '42501', null, 'anon no tiene privilegios sobre procesos_masivos_errores'
);

reset role;

-- ============================================================================
-- Un estado terminal no vuelve atrás (FR-002)
-- ============================================================================

update public.procesos_masivos set estado = 'completado', finalizado_en = clock_timestamp()
where id = current_setting('t.p1')::uuid;

select throws_ok(
  format($f$ update public.procesos_masivos set estado = 'en_curso', finalizado_en = null where id = '%s' $f$, current_setting('t.p1')),
  'P0001', null, 'un proceso terminado no vuelve a un estado abierto'
);

select throws_ok(
  format($f$ update public.procesos_masivos set estado = 'rarisimo' where id = '%s' $f$, current_setting('t.p2')),
  '23514', null, 'un estado fuera de la lista se rechaza'
);

select * from finish();
rollback;
