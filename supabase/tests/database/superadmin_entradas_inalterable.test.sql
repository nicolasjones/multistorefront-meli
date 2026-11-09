-- MSF-170 (revisión independiente, hallazgo 3): la bitácora duradera del acceso de soporte es append-only.
begin;

select plan(15);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('a5000000-0000-0000-0000-000000000001', 'soporte@example.com'),
  ('a5000000-0000-0000-0000-000000000002', 'soporte-dos@example.com');
insert into superadmins (user_id) values ('a5000000-0000-0000-0000-000000000001'), ('a5000000-0000-0000-0000-000000000002');

insert into superadmin_entradas (user_id, organizacion_id, accion, motivo) values
  ('a5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'entrada', 'Revisar'),
  ('a5000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'entrada', 'Revisar dos'),
  ('a5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'entrada', 'Otra persona');

select is(
  (select tgenabled::text from pg_trigger where tgrelid = 'public.superadmin_entradas'::regclass and tgname = 'superadmin_entradas_inalterable_fila'),
  'A', 'el trigger de fila está en ENABLE ALWAYS');
select is(
  (select tgenabled::text from pg_trigger where tgrelid = 'public.superadmin_entradas'::regclass and tgname = 'superadmin_entradas_inalterable_truncate'),
  'A', 'el trigger de truncate está en ENABLE ALWAYS');

select throws_ok($$update superadmin_entradas set motivo = 'x'$$, '42501', null, 'el dueño no actualiza la bitácora');
select throws_ok($$delete from superadmin_entradas where motivo = 'Revisar'$$, '42501', null, 'el dueño no borra de la bitácora');
select throws_ok($$truncate superadmin_entradas$$, '42501', null, 'el dueño no vacía la bitácora');

set local session_replication_role = replica;
select throws_ok($$update superadmin_entradas set motivo = 'x'$$, '42501', null, 'con session_replication_role = replica el UPDATE sigue fallando');
select throws_ok($$delete from superadmin_entradas where motivo = 'Revisar'$$, '42501', null, 'con session_replication_role = replica el DELETE sigue fallando');
reset session_replication_role;

-- Ningún rol de la API escribe la bitácora (service_role incluido).
select is(
  (select bool_or(has_table_privilege(r, 'public.superadmin_entradas', p))
     from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['insert', 'update', 'delete', 'truncate']) p),
  false, 'anon, authenticated y service_role no tienen INSERT, UPDATE, DELETE ni TRUNCATE');
set local role service_role;
select throws_ok($$delete from superadmin_entradas$$, '42501', null, 'service_role no borra');
reset role;
set local role authenticated;
select throws_ok($$insert into superadmin_entradas (user_id, organizacion_id) values ('a5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111')$$,
  '42501', null, 'authenticated no inserta directo');
reset role;

-- Excepciones: borrado en cascada de la cuenta y de la organización.
delete from auth.users where id = 'a5000000-0000-0000-0000-000000000002';
select is((select count(*)::int from superadmin_entradas where motivo = 'Otra persona'), 0, 'eliminar la cuenta de soporte borra sus entradas en cascada');
delete from organizaciones where id = '22222222-2222-2222-2222-222222222222';
select is((select count(*)::int from superadmin_entradas where motivo = 'Revisar dos'), 0, 'eliminar la organización borra sus entradas en cascada');
select is((select count(*)::int from superadmin_entradas), 1, 'y las demás se conservan');

-- Las funciones de soporte siguen escribiendo la bitácora.
select set_config('request.jwt.claims', json_build_object('sub', 'a5000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$select public.entrar_a_organizacion('11111111-1111-1111-1111-111111111111', 'Otra revisión')$$, 'entrar_a_organizacion sigue escribiendo la bitácora');
select public.salir_de_organizacion();
reset role;
select is((select array_agg(accion order by id) from superadmin_entradas where user_id = 'a5000000-0000-0000-0000-000000000001' and (motivo is null or motivo = 'Otra revisión')), array['entrada', 'salida'], 'entrada y salida quedan registradas');

select * from finish();
rollback;
