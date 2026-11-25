-- actualizar_credencial_conexion y confirmar_conexion_oauth: una conexión ajena responde IGUAL que una inexistente
-- (PT404 «La conexión <id> no existe»), así que un UUID ajeno no revela que existe (migración 20270507700000).
begin;

select plan(13);

insert into organizaciones (id, nombre) values
  ('a1111111-1111-1111-1111-111111111179', 'Organización X79'),
  ('a2222222-2222-2222-2222-222222222279', 'Organización Y79');

insert into auth.users (id, email) values
  ('a5000000-0000-0000-0000-000000000079', 'superadmin-79@example.com'),
  ('a1000000-0000-0000-0000-000000000079', 'admin-x-79@example.com'),
  ('a2000000-0000-0000-0000-000000000079', 'admin-y-79@example.com'),
  ('a3000000-0000-0000-0000-000000000079', 'miembro-x-79@example.com');

insert into sistemas_externos (id, descripcion) values ('sistema-lote79', 'Sistema de prueba (fixture, sin valor de negocio)');

insert into superadmins (user_id) values ('a5000000-0000-0000-0000-000000000079');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('a1000000-0000-0000-0000-000000000079', 'a1111111-1111-1111-1111-111111111179', 'administrador'),
  ('a2000000-0000-0000-0000-000000000079', 'a2222222-2222-2222-2222-222222222279', 'administrador'),
  ('a3000000-0000-0000-0000-000000000079', 'a1111111-1111-1111-1111-111111111179', 'miembro');

create temporary table t_ids (key text primary key, val uuid);
grant all on t_ids to authenticated, service_role;

create or replace function pg_temp.como(p_user uuid) returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $f$;

-- Fixture: una conexión de credencial y una de OAuth, ambas de X79.
select pg_temp.como('a5000000-0000-0000-0000-000000000079');
insert into t_ids (key, val) select 'integracion', (public.registrar_integracion_oauth('google-lote79', 'Google')).id;

select pg_temp.como('a1000000-0000-0000-0000-000000000079');
insert into t_ids (key, val)
select 'conexion', ((public.crear_conexion('a1111111-1111-1111-1111-111111111179', 'sistema-lote79', 'credencial-x79'))->>'id')::uuid;
insert into t_ids (key, val)
select 'oauth', (public.iniciar_conexion_oauth('a1111111-1111-1111-1111-111111111179', (select val from t_ids where key = 'integracion'))).id;

-- Admin de Y: la conexión de X (ajena) y una inexistente dan exactamente lo mismo, código y mensaje.
select pg_temp.como('a2000000-0000-0000-0000-000000000079');

select throws_ok(
  format($$select public.actualizar_credencial_conexion('%s', 'robada')$$, (select val from t_ids where key = 'conexion')),
  'PT404', format('La conexión %s no existe', (select val from t_ids where key = 'conexion')),
  'actualizar_credencial_conexion: ajena responde PT404 «no existe»');
select throws_ok(
  $$select public.actualizar_credencial_conexion('99999999-9999-9999-9999-999999999979', 'x')$$,
  'PT404', 'La conexión 99999999-9999-9999-9999-999999999979 no existe',
  'actualizar_credencial_conexion: inexistente responde PT404 «no existe»');
select throws_ok(
  format($$select public.confirmar_conexion_oauth('%s', 'nango-robada')$$, (select val from t_ids where key = 'oauth')),
  'PT404', format('La conexión %s no existe', (select val from t_ids where key = 'oauth')),
  'confirmar_conexion_oauth: ajena responde PT404 «no existe»');
select throws_ok(
  $$select public.confirmar_conexion_oauth('99999999-9999-9999-9999-999999999979', 'x')$$,
  'PT404', 'La conexión 99999999-9999-9999-9999-999999999979 no existe',
  'confirmar_conexion_oauth: inexistente responde PT404 «no existe»');

reset role;
select is((select nango_connection_id from conexiones_oauth where id = (select val from t_ids where key = 'oauth')), null,
  'la conexión ajena no se modificó');

-- Miembro sin rol de administrador de su propia organización: sigue 42501 (la conoce, no puede gestionarla).
select pg_temp.como('a3000000-0000-0000-0000-000000000079');
select throws_ok(
  format($$select public.actualizar_credencial_conexion('%s', 'x')$$, (select val from t_ids where key = 'conexion')),
  '42501', 'No puede gestionar conexiones de esta organización',
  'actualizar_credencial_conexion: un miembro no administrador de su organización sigue recibiendo 42501');
select throws_ok(
  format($$select public.confirmar_conexion_oauth('%s', 'x')$$, (select val from t_ids where key = 'oauth')),
  '42501', 'No puede gestionar conexiones de esta organización',
  'confirmar_conexion_oauth: un miembro no administrador de su organización sigue recibiendo 42501');

-- La propia sigue funcionando.
select pg_temp.como('a1000000-0000-0000-0000-000000000079');
select lives_ok(
  format($$select public.actualizar_credencial_conexion('%s', 'rotada-x79')$$, (select val from t_ids where key = 'conexion')),
  'el administrador rota la credencial de su propia conexión');
select lives_ok(
  format($$select public.confirmar_conexion_oauth('%s', 'nango-x79')$$, (select val from t_ids where key = 'oauth')),
  'el administrador confirma su propia conexión OAuth');
reset role;
select is((select nango_connection_id from conexiones_oauth where id = (select val from t_ids where key = 'oauth')), 'nango-x79',
  'la confirmación propia guardó el connection_id');
select is((select decrypted_secret from vault.decrypted_secrets s join conexiones c on c.credencial_vault_id = s.id
           where c.id = (select val from t_ids where key = 'conexion')), 'rotada-x79', 'la rotación propia guardó la credencial');

-- Superadmin: ve todas las conexiones, así que opera sobre la de X sin fuga ni bloqueo.
select pg_temp.como('a5000000-0000-0000-0000-000000000079');
select lives_ok(
  format($$select public.actualizar_credencial_conexion('%s', 'rotada-super')$$, (select val from t_ids where key = 'conexion')),
  'un superadmin sigue pudiendo rotar la credencial de cualquier conexión');

-- Contrato intacto: security definer, search_path vacío, sin acceso de anon.
reset role;
select ok(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'] and not has_function_privilege('anon', p.oid, 'EXECUTE')
                   and has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('actualizar_credencial_conexion', 'confirmar_conexion_oauth')),
  'ambas funciones siguen security definer, con search_path vacío, ejecutables por authenticated y no por anon');

select * from finish();
rollback;
