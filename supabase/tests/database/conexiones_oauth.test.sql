-- Conexiones OAuth de plataforma vía Nango (spec
-- 20260930-153545-conexiones-oauth-nango). Ver data-model.md y contracts/.
begin;

select plan(45);

-- ============================================================================
-- Fixture
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('e1111111-1111-1111-1111-111111111111', 'Organización X'),
  ('e2222222-2222-2222-2222-222222222222', 'Organización Y');

insert into auth.users (id, email) values
  ('e5000000-0000-0000-0000-000000000005', 'superadmin-oauth@example.com'),
  ('e1000000-0000-0000-0000-000000000001', 'admin-x-oauth@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'admin-y-oauth@example.com'),
  ('e3000000-0000-0000-0000-000000000001', 'miembro-x-oauth@example.com');

insert into superadmins (user_id) values ('e5000000-0000-0000-0000-000000000005');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('e1000000-0000-0000-0000-000000000001', 'e1111111-1111-1111-1111-111111111111', 'administrador'),
  ('e2000000-0000-0000-0000-000000000001', 'e2222222-2222-2222-2222-222222222222', 'administrador'),
  ('e3000000-0000-0000-0000-000000000001', 'e1111111-1111-1111-1111-111111111111', 'miembro');

create temporary table t_ids (key text primary key, val uuid);
grant all on t_ids to authenticated, service_role;

-- ============================================================================
-- Esquema: tablas y RLS habilitada
-- ============================================================================

select has_table('public', 'integraciones_oauth', 'existe integraciones_oauth');
select has_table('public', 'conexiones_oauth', 'existe conexiones_oauth');
select has_table('public', 'eventos_conexion_oauth', 'existe eventos_conexion_oauth');

select is(
  (select relrowsecurity from pg_class where oid = 'public.integraciones_oauth'::regclass),
  true,
  'RLS habilitada en integraciones_oauth'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.conexiones_oauth'::regclass),
  true,
  'RLS habilitada en conexiones_oauth'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.eventos_conexion_oauth'::regclass),
  true,
  'RLS habilitada en eventos_conexion_oauth'
);

-- ============================================================================
-- public.registrar_integracion_oauth / actualizar_integracion_oauth (Historia 4)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.registrar_integracion_oauth('google-pgtap-fixture', 'Google')$$,
  '42501',
  null,
  'un administrador de organización no puede registrar una integración (superadmin únicamente)'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

insert into t_ids (key, val)
select 'integracion_google', (public.registrar_integracion_oauth('google-pgtap-fixture', 'Google')).id;

insert into t_ids (key, val)
select 'integracion_deshabilitada', (public.registrar_integracion_oauth('ms-deshabilitada', 'Microsoft (prueba)')).id;

select lives_ok(
  format($$select public.actualizar_integracion_oauth('%s', false)$$, (select val from t_ids where key = 'integracion_deshabilitada')),
  'superadmin puede deshabilitar una integración'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  format($$select public.actualizar_integracion_oauth('%s', true)$$, (select val from t_ids where key = 'integracion_deshabilitada')),
  '42501',
  null,
  'un administrador de organización no puede habilitar/deshabilitar una integración'
);

reset role;

-- ============================================================================
-- public.iniciar_conexion_oauth (Historia 1)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

insert into t_ids (key, val)
select 'conexion_x_google',
  (public.iniciar_conexion_oauth('e1111111-1111-1111-1111-111111111111', (select val from t_ids where key = 'integracion_google'))).id;

select is(
  (select estado from conexiones_oauth where id = (select val from t_ids where key = 'conexion_x_google')),
  'pendiente',
  'iniciar_conexion_oauth crea la fila en estado pendiente'
);

select is(
  (public.iniciar_conexion_oauth('e1111111-1111-1111-1111-111111111111', (select val from t_ids where key = 'integracion_google'))).id,
  (select val from t_ids where key = 'conexion_x_google'),
  'iniciar_conexion_oauth es idempotente: devuelve el mismo id (connection_id) para el mismo org+integración'
);

select is(
  (select count(*)::int from conexiones_oauth
    where organizacion_id = 'e1111111-1111-1111-1111-111111111111'
      and integracion_id = (select val from t_ids where key = 'integracion_google')),
  1,
  'no se duplica la fila al reintentar iniciar_conexion_oauth'
);

select throws_ok(
  $$select public.iniciar_conexion_oauth('e2222222-2222-2222-2222-222222222222', (select val from t_ids where key = 'integracion_google'))$$,
  '42501',
  null,
  'el administrador de X no puede iniciar una conexión para Y'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e3000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.iniciar_conexion_oauth('e1111111-1111-1111-1111-111111111111', (select val from t_ids where key = 'integracion_google'))$$,
  '42501',
  null,
  'un miembro sin rol administrador no puede iniciar una conexión'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.iniciar_conexion_oauth('e1111111-1111-1111-1111-111111111111', (select val from t_ids where key = 'integracion_deshabilitada'))$$,
  '42501',
  null,
  'no se puede iniciar una conexión para una integración deshabilitada'
);

select throws_ok(
  $$select public.iniciar_conexion_oauth('e1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000')$$,
  'P0002',
  null,
  'iniciar_conexion_oauth rechaza una integración que no existe'
);

-- ============================================================================
-- public.confirmar_conexion_oauth (Historia 1)
-- ============================================================================

select throws_ok(
  $$select public.confirmar_conexion_oauth('00000000-0000-0000-0000-000000000000', 'nango-conn-1')$$,
  'P0002',
  null,
  'confirmar_conexion_oauth rechaza una conexión que no existe'
);

select public.confirmar_conexion_oauth((select val from t_ids where key = 'conexion_x_google'), 'nango-conn-1');

select is(
  (select estado from conexiones_oauth where id = (select val from t_ids where key = 'conexion_x_google')),
  'activa',
  'confirmar_conexion_oauth deja la conexión activa'
);

select is(
  (select nango_connection_id from conexiones_oauth where id = (select val from t_ids where key = 'conexion_x_google')),
  'nango-conn-1',
  'confirmar_conexion_oauth guarda el connection_id real que devolvió Nango (research.md R8)'
);

select is(
  (select tipo from eventos_conexion_oauth where conexion_id = (select val from t_ids where key = 'conexion_x_google') order by id asc limit 1),
  'creada',
  'la primera confirmación registra el evento creada'
);

select is(
  (select actor from eventos_conexion_oauth where conexion_id = (select val from t_ids where key = 'conexion_x_google') order by id asc limit 1),
  'e1000000-0000-0000-0000-000000000001'::uuid,
  'el evento creada registra el actor que confirmó'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  format($$select public.confirmar_conexion_oauth('%s', 'nango-conn-y')$$, (select val from t_ids where key = 'conexion_x_google')),
  '42501',
  null,
  'el administrador de Y no puede confirmar una conexión de X'
);

reset role;

-- ============================================================================
-- public.marcar_conexion_oauth_invalida (Historia 2) — solo service_role
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  format($$select public.marcar_conexion_oauth_invalida('%s', 'refresh_token_invalido')$$, (select val from t_ids where key = 'conexion_x_google')),
  '42501',
  null,
  'un administrador de organización no puede llamar marcar_conexion_oauth_invalida (solo service_role)'
);

reset role;

set local role service_role;

select lives_ok(
  format($$select public.marcar_conexion_oauth_invalida('%s', 'refresh_token_invalido')$$, (select val from t_ids where key = 'conexion_x_google')),
  'service_role puede reportar una conexión inválida'
);

reset role;

select is(
  (select estado from conexiones_oauth where id = (select val from t_ids where key = 'conexion_x_google')),
  'con_error',
  'marcar_conexion_oauth_invalida deja la conexión en con_error'
);

select is(
  (select tipo from eventos_conexion_oauth where conexion_id = (select val from t_ids where key = 'conexion_x_google') order by id desc limit 1),
  'invalidada',
  'marcar_conexion_oauth_invalida registra el evento invalidada'
);

select is(
  (select actor from eventos_conexion_oauth where conexion_id = (select val from t_ids where key = 'conexion_x_google') order by id desc limit 1),
  null,
  'el evento invalidada no tiene actor de usuario (lo reporta un backend/worker)'
);

select is(
  (select motivo from eventos_conexion_oauth where conexion_id = (select val from t_ids where key = 'conexion_x_google') order by id desc limit 1),
  'refresh_token_invalido',
  'el evento invalidada conserva el motivo sanitizado'
);

select is(
  has_function_privilege('authenticated', 'public.marcar_conexion_oauth_invalida(uuid, text)', 'EXECUTE'),
  false,
  'authenticated no tiene EXECUTE sobre marcar_conexion_oauth_invalida'
);

select is(
  has_function_privilege('service_role', 'public.marcar_conexion_oauth_invalida(uuid, text)', 'EXECUTE'),
  true,
  'service_role tiene EXECUTE sobre marcar_conexion_oauth_invalida'
);

-- ============================================================================
-- Reautorizar sin duplicar (Historia 3)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (public.iniciar_conexion_oauth('e1111111-1111-1111-1111-111111111111', (select val from t_ids where key = 'integracion_google'))).id,
  (select val from t_ids where key = 'conexion_x_google'),
  'reautorizar reutiliza el mismo id de una conexión con_error (bookkeeping de Supabase, distinto del connection_id de Nango desde research.md R8)'
);

select is(
  (select count(*)::int from conexiones_oauth
    where organizacion_id = 'e1111111-1111-1111-1111-111111111111'
      and integracion_id = (select val from t_ids where key = 'integracion_google')),
  1,
  'reautorizar no crea una segunda fila'
);

-- /connect/sessions/reconnect apunta al mismo nango_connection_id existente
-- (contracts/conectar-oauth.md, iniciar-sesion-oauth) — se simula pasando el
-- mismo valor otra vez, no uno nuevo.
select public.confirmar_conexion_oauth((select val from t_ids where key = 'conexion_x_google'), 'nango-conn-1');

select is(
  (select nango_connection_id from conexiones_oauth where id = (select val from t_ids where key = 'conexion_x_google')),
  'nango-conn-1',
  'reautorizar conserva el mismo nango_connection_id (no cambia de identidad en Nango)'
);

select is(
  (select tipo from eventos_conexion_oauth where conexion_id = (select val from t_ids where key = 'conexion_x_google') order by id desc limit 1),
  'reautorizada',
  'confirmar una conexión que ya existía (no pendiente) registra el evento reautorizada'
);

reset role;

-- ============================================================================
-- nango_connection_id: único cuando no es null, y legible por authenticated
-- ============================================================================

select throws_ok(
  format(
    $$insert into conexiones_oauth (organizacion_id, integracion_id, nango_connection_id) values ('%s', '%s', 'nango-conn-1')$$,
    'e2222222-2222-2222-2222-222222222222',
    (select val from t_ids where key = 'integracion_deshabilitada')
  ),
  '23505',
  null,
  'no puede haber dos filas con el mismo nango_connection_id (unique parcial)'
);

select is(
  has_column_privilege('authenticated', 'conexiones_oauth', 'nango_connection_id', 'SELECT'),
  true,
  'authenticated puede leer nango_connection_id (RLS de la tabla sigue aplicando)'
);

-- ============================================================================
-- Aislamiento por organización (Principio I)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from conexiones_oauth where id = (select val from t_ids where key = 'conexion_x_google')),
  0,
  'el administrador de Y no ve la conexión de X'
);

select is(
  (select count(*)::int from eventos_conexion_oauth where conexion_id = (select val from t_ids where key = 'conexion_x_google')),
  0,
  'el administrador de Y no ve los eventos de una conexión de X'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from conexiones_oauth where id = (select val from t_ids where key = 'conexion_x_google')),
  1,
  'el administrador de X ve su propia conexión'
);

select throws_ok(
  $$update integraciones_oauth set habilitada = false where clave = 'google-pgtap-fixture'$$,
  '42501',
  null,
  'authenticated no puede escribir integraciones_oauth directo (sin GRANT de insert/update)'
);

reset role;

-- ============================================================================
-- private.datos_despacho_conexion_oauth (resolución para flows de Kestra,
-- mismo criterio que private.datos_despacho_conexion de spec 013 — se llama
-- como postgres, dueño de la función, para probar la lógica de negocio; el
-- GRANT real se confirma aparte con has_function_privilege, igual que ese
-- archivo documenta para kestra_orquestacion)
-- ============================================================================

select is(
  has_function_privilege('kestra_orquestacion', 'private.datos_despacho_conexion_oauth(uuid, text)', 'EXECUTE'),
  true,
  'kestra_orquestacion tiene EXECUTE de datos_despacho_conexion_oauth'
);

select is(
  has_function_privilege('authenticated', 'private.datos_despacho_conexion_oauth(uuid, text)', 'EXECUTE'),
  false,
  'authenticated no tiene EXECUTE de datos_despacho_conexion_oauth — solo kestra_orquestacion la necesita'
);

select is(
  private.datos_despacho_conexion_oauth('e1111111-1111-1111-1111-111111111111', 'google-pgtap-fixture'),
  'nango-conn-1',
  'datos_despacho_conexion_oauth resuelve el connection_id real de Nango (nango_connection_id), no el id de conexiones_oauth (research.md R8)'
);

select throws_ok(
  $$select private.datos_despacho_conexion_oauth('e2222222-2222-2222-2222-222222222222', 'google-pgtap-fixture')$$,
  'P0002',
  null,
  'datos_despacho_conexion_oauth falla si la organización no tiene conexión activa a esa integración'
);

select throws_ok(
  $$select private.datos_despacho_conexion_oauth('e1111111-1111-1111-1111-111111111111', 'no-existe')$$,
  'P0002',
  null,
  'datos_despacho_conexion_oauth falla si la integración no existe'
);

select * from finish();
rollback;
