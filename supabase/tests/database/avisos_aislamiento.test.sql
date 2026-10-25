-- MSF-319 · F-NOT-01 (FR-001, FR-002, FR-011, SC-001): catálogo, preferencias y aislamiento.
-- El fixture corre como postgres (RLS no aplica); las verificaciones, como authenticated vía
-- request.jwt.claims. Dos organizaciones y dos roles (administrador y depósito).
begin;

select plan(24);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'admin1@example.com'),
  ('a1000000-0000-0000-0000-000000000002', 'deposito1@example.com'),
  ('a2000000-0000-0000-0000-000000000001', 'admin2@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

-- Preferencias ajenas ya guardadas: nadie más debe verlas ni tocarlas.
insert into preferencias_aviso (user_id, tipo_aviso, activo) values
  ('a2000000-0000-0000-0000-000000000001', 'consulta_nueva', false),
  ('a1000000-0000-0000-0000-000000000002', 'consulta_nueva', false);

-- FR-001: catálogo sembrado y sin avisos de seguridad.
select is(
  (select nombre from public.tipos_aviso where clave = 'consulta_nueva'), 'Consulta nueva',
  'consulta_nueva está sembrado en el catálogo'
);
select is(
  (select seccion from public.tipos_aviso where clave = 'consulta_nueva'), 'consultas',
  'consulta_nueva depende de la sección consultas'
);
select is(
  (select count(*)::int from public.tipos_aviso where clave ~ '(invitacion|recuperacion|seguridad|contrasena)'),
  0, 'el catálogo no tiene avisos de seguridad'
);

-- Administrador de la organización 1.
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select count(*)::int from public.tipos_aviso), 1,
  'authenticated lee el catálogo'
);
select throws_ok(
  $$insert into public.tipos_aviso (clave, nombre, seccion) values ('otro', 'Otro', 'consultas')$$,
  '42501', null, 'authenticated no escribe el catálogo'
);
select is(
  (select count(*)::int from public.listar_preferencias_aviso()), 1,
  'el administrador ve el tipo de la sección consultas'
);
select is(
  (select activo from public.listar_preferencias_aviso() where tipo = 'consulta_nueva'), true,
  'sin fila de preferencia el tipo aparece encendido'
);
select lives_ok(
  $$select * from public.guardar_preferencia_aviso('consulta_nueva', false)$$,
  'el usuario apaga su propio aviso'
);
select is(
  (select activo from public.listar_preferencias_aviso() where tipo = 'consulta_nueva'), false,
  'la preferencia guardada se lista apagada'
);
select is(
  (select count(*)::int from public.preferencias_aviso), 1,
  'solo ve su propia fila de preferencias'
);
select is(
  (select count(*)::int from public.preferencias_aviso where user_id = 'a2000000-0000-0000-0000-000000000001'),
  0, 'no ve las preferencias de otra organización'
);
-- Intento de modificar preferencias ajenas: RLS filtra las filas, no falla ni afecta a nadie.
select lives_ok(
  $$update public.preferencias_aviso set activo = true
    where user_id in ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002')$$,
  'intentar modificar preferencias ajenas no afecta ninguna fila'
);
select throws_ok(
  $$select * from public.guardar_preferencia_aviso('inexistente', true)$$,
  '22023', null, 'guardar rechaza un tipo desconocido'
);
select throws_ok(
  $$select count(*) from public.avisos_pendientes$$,
  '42501', null, 'authenticated no lee la cola de avisos'
);

-- Depósito: sin acceso a Consultas, no ve ni cambia el tipo.
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.listar_preferencias_aviso()), 0,
  'un rol sin acceso a Consultas no ve el tipo consulta_nueva'
);
select throws_ok(
  $$select * from public.guardar_preferencia_aviso('consulta_nueva', true)$$,
  '42501', null, 'un rol sin acceso no puede guardar la preferencia del tipo'
);

-- Administrador de la organización 2: solo lo suyo.
select set_config('request.jwt.claims', json_build_object('sub', 'a2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

select is(
  (select activo from public.listar_preferencias_aviso() where tipo = 'consulta_nueva'), false,
  'cada usuario ve su propia preferencia, no la de la otra organización'
);

reset role;

select is(
  (select count(*)::int from public.preferencias_aviso
    where user_id in ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002') and activo),
  0, 'las preferencias de otros usuarios siguen apagadas'
);

-- anon: sin ejecución ni acceso (FR-017).
select ok(
  not has_function_privilege('anon', 'public.listar_preferencias_aviso()', 'execute'),
  'anon no ejecuta listar_preferencias_aviso'
);
select ok(
  not has_function_privilege('anon', 'public.guardar_preferencia_aviso(text, boolean)', 'execute'),
  'anon no ejecuta guardar_preferencia_aviso'
);
select ok(
  not has_table_privilege('anon', 'public.tipos_aviso', 'select')
  and not has_table_privilege('anon', 'public.preferencias_aviso', 'select'),
  'anon no lee el catálogo ni las preferencias'
);
select ok(
  not has_table_privilege('anon', 'public.avisos_pendientes', 'select')
  and not has_table_privilege('authenticated', 'public.avisos_pendientes', 'select'),
  'ni anon ni authenticated acceden a la cola de avisos'
);
select ok(
  not has_function_privilege('authenticated', 'private.emitir_aviso(text, uuid, jsonb, uuid)', 'execute')
  and not has_function_privilege('anon', 'private.emitir_aviso(text, uuid, jsonb, uuid)', 'execute'),
  'emitir_aviso no es ejecutable desde la app'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.avisos_pendientes'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.preferencias_aviso'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.tipos_aviso'::regclass),
  'las tres tablas nuevas tienen RLS activada'
);

select * from finish();
rollback;
