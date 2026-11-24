-- MSF-652: public.activar_version_documento valida organización, funcionalidad y rol.
-- Positivos: quien subió la versión y un administrador de la misma organización pueden activarla.
-- Negativos: otra organización (mismo error genérico que una versión inexistente), miembro que no la subió,
-- funcionalidad apagada, y anon sin EXECUTE.
begin;

select plan(19);

insert into organizaciones (id, nombre) values
  ('c1111111-1111-1111-1111-111111111111', 'Org A'),
  ('c2222222-2222-2222-2222-222222222222', 'Org B');

insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'admin-a-av@example.com'),
  ('c1000000-0000-0000-0000-000000000002', 'subidor-a-av@example.com'),
  ('c1000000-0000-0000-0000-000000000003', 'otro-a-av@example.com'),
  ('c1000000-0000-0000-0000-000000000004', 'consulta-a-av@example.com'),
  ('c2000000-0000-0000-0000-000000000001', 'admin-b-av@example.com'),
  ('c5000000-0000-0000-0000-000000000005', 'superadmin-av@example.com');

insert into superadmins (user_id) values ('c5000000-0000-0000-0000-000000000005');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('c1000000-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111111', 'administrador'),
  ('c1000000-0000-0000-0000-000000000002', 'c1111111-1111-1111-1111-111111111111', 'operador'),
  ('c1000000-0000-0000-0000-000000000003', 'c1111111-1111-1111-1111-111111111111', 'operador'),
  ('c1000000-0000-0000-0000-000000000004', 'c1111111-1111-1111-1111-111111111111', 'consulta'),
  ('c2000000-0000-0000-0000-000000000001', 'c2222222-2222-2222-2222-222222222222', 'administrador');

select set_config('request.jwt.claims', json_build_object('sub', 'c5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.habilitar_feature('busqueda-documental', 'c1111111-1111-1111-1111-111111111111');
select public.habilitar_feature('busqueda-documental', 'c2222222-2222-2222-2222-222222222222');
reset role;

insert into documentos (id, organizacion_id, nombre, subido_por) values
  ('c3000000-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111111', 'doc-a.pdf', 'c1000000-0000-0000-0000-000000000002');

insert into versiones_documento (id, documento_id, storage_path, estado, subida_por) values
  ('c4000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', 'ruta-activa', 'activa', 'c1000000-0000-0000-0000-000000000002'),
  ('c4000000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-000000000001', 'ruta-nueva-1', 'procesando', 'c1000000-0000-0000-0000-000000000002'),
  ('c4000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000001', 'ruta-nueva-2', 'procesando', 'c1000000-0000-0000-0000-000000000002');

-- Privilegios
select is(has_function_privilege('anon', 'public.activar_version_documento(uuid)', 'execute'), false, 'anon no ejecuta activar_version_documento');
select is(has_function_privilege('authenticated', 'public.activar_version_documento(uuid)', 'execute'), true, 'authenticated ejecuta activar_version_documento');

-- Otra organización (admin de B intenta activar una versión de A): mismo error genérico que inexistente
select set_config('request.jwt.claims', json_build_object('sub', 'c2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  $$select public.activar_version_documento('c4000000-0000-0000-0000-000000000002')$$,
  '22023', 'Versión no encontrada o ya procesada', 'otra organización: no puede activar una versión ajena');
select throws_ok(
  $$select public.activar_version_documento('00000000-0000-0000-0000-00000000dead')$$,
  '22023', 'Versión no encontrada o ya procesada', 'versión inexistente: mismo error (no se sondean ids)');
reset role;

select is((select estado from versiones_documento where id = 'c4000000-0000-0000-0000-000000000002'), 'procesando',
  'la versión de A sigue procesando tras el intento de B');
select is((select estado from versiones_documento where id = 'c4000000-0000-0000-0000-000000000001'), 'activa',
  'la versión activa de A no fue reemplazada por B');

-- Miembro de A que no la subió y no es administrador
select set_config('request.jwt.claims', json_build_object('sub', 'c1000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  $$select public.activar_version_documento('c4000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'miembro que no subió la versión ni es administrador: rechazado');
reset role;

-- Lote 41: el rol Consulta no gestiona documentos (`puede_gestionar_documentos`): aunque haya subido la versión, no la activa.
-- (La función no lo exigía: el handler de `indexar-documento` lo bloqueaba, pero la RPC es invocable directamente.)
insert into versiones_documento (id, documento_id, storage_path, estado, subida_por) values
  ('c4000000-0000-0000-0000-000000000006', 'c3000000-0000-0000-0000-000000000001', 'ruta-consulta', 'procesando', 'c1000000-0000-0000-0000-000000000004');
select set_config('request.jwt.claims', json_build_object('sub', 'c1000000-0000-0000-0000-000000000004', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  $$select public.activar_version_documento('c4000000-0000-0000-0000-000000000006')$$,
  '42501', 'Tu rol no puede gestionar documentos', 'Consulta, aunque haya subido la versión, recibe 42501');
reset role;
select is((select estado from versiones_documento where id = 'c4000000-0000-0000-0000-000000000006'), 'procesando', 'la versión subida por Consulta sigue procesando');

-- Quien subió la versión (operador) puede
select set_config('request.jwt.claims', json_build_object('sub', 'c1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(
  $$select public.activar_version_documento('c4000000-0000-0000-0000-000000000002')$$,
  'quien subió la versión puede activarla');
reset role;
select is((select estado from versiones_documento where id = 'c4000000-0000-0000-0000-000000000001'), 'reemplazada',
  'la activa anterior queda reemplazada');

-- Administrador de la misma organización puede (aunque no la subió)
select set_config('request.jwt.claims', json_build_object('sub', 'c1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(
  $$select public.activar_version_documento('c4000000-0000-0000-0000-000000000003')$$,
  'un administrador de la organización puede activar la versión');
reset role;

-- Versión ya procesada (la activó el administrador): reactivarla da el mismo error genérico
select set_config('request.jwt.claims', json_build_object('sub', 'c1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  $$select public.activar_version_documento('c4000000-0000-0000-0000-000000000003')$$,
  '22023', 'Versión no encontrada o ya procesada', 'una versión ya procesada no se puede volver a activar');
reset role;

-- Superadmin: sin organización activa no encuentra la versión; con la organización activa pero sin
-- membresía ni haberla subido, no es administrador propio: 42501
insert into versiones_documento (id, documento_id, storage_path, estado, subida_por) values
  ('c4000000-0000-0000-0000-000000000005', 'c3000000-0000-0000-0000-000000000001', 'ruta-nueva-4', 'procesando', 'c1000000-0000-0000-0000-000000000002');
select set_config('request.jwt.claims', json_build_object('sub', 'c5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  $$select public.activar_version_documento('c4000000-0000-0000-0000-000000000005')$$,
  '22023', 'Versión no encontrada o ya procesada', 'superadmin sin organización activa: no encuentra la versión');
reset role;
insert into superadmin_organizacion_activa (user_id, organizacion_id) values
  ('c5000000-0000-0000-0000-000000000005', 'c1111111-1111-1111-1111-111111111111');
set local role authenticated;
select throws_ok(
  $$select public.activar_version_documento('c4000000-0000-0000-0000-000000000005')$$,
  '42501', null, 'superadmin con la organización activa pero sin membresía ni haberla subido: rechazado');
reset role;
select is((select estado from versiones_documento where id = 'c4000000-0000-0000-0000-000000000005'), 'procesando',
  'la versión sigue procesando tras los intentos del superadmin');
delete from superadmin_organizacion_activa where user_id = 'c5000000-0000-0000-0000-000000000005';

-- Funcionalidad apagada
insert into versiones_documento (id, documento_id, storage_path, estado, subida_por) values
  ('c4000000-0000-0000-0000-000000000004', 'c3000000-0000-0000-0000-000000000001', 'ruta-nueva-3', 'procesando', 'c1000000-0000-0000-0000-000000000002');
select set_config('request.jwt.claims', json_build_object('sub', 'c5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.deshabilitar_feature('busqueda-documental', 'c1111111-1111-1111-1111-111111111111');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  $$select public.activar_version_documento('c4000000-0000-0000-0000-000000000004')$$,
  '42501', null, 'funcionalidad apagada: no se activa ni siquiera un administrador');
reset role;
select is((select estado from versiones_documento where id = 'c4000000-0000-0000-0000-000000000004'), 'procesando',
  'con la funcionalidad apagada la versión queda procesando');

-- anon
set local role anon;
select throws_ok(
  $$select public.activar_version_documento('c4000000-0000-0000-0000-000000000004')$$,
  '42501', null, 'anon no puede llamar la RPC');
reset role;

select * from finish();
rollback;
