-- Aislamiento real entre organizaciones (spec 003, US1, FR-006, SC-001).
-- Corre como postgres (dueño de las tablas, RLS no aplica) para armar el
-- fixture, y como el rol "authenticated" — simulando distintos usuarios
-- vía request.jwt.claims, igual que hace PostgREST — para verificar que
-- cada policy realmente filtra.
begin;

select plan(61);

-- ============================================================================
-- Fixture: 2 organizaciones, 1 admin + 1 miembro por organización, 1 usuario
-- sin ninguna fila en usuarios_organizacion, 1 cliente por organización.
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'admin1@example.com'),
  ('a1000000-0000-0000-0000-000000000002', 'miembro1@example.com'),
  ('a1000000-0000-0000-0000-000000000003', 'admin1b@example.com'),
  ('a2000000-0000-0000-0000-000000000001', 'admin2@example.com'),
  ('a9000000-0000-0000-0000-000000000009', 'sin-organizacion@example.com'),
  ('a9000000-0000-0000-0000-000000000010', 'existente-sin-membresia@example.com'),
  ('a5000000-0000-0000-0000-000000000005', 'superadmin@example.com');

insert into superadmins (user_id) values
  ('a5000000-0000-0000-0000-000000000005');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'miembro'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into clientes (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Cliente de la Uno'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Cliente de la Dos');

-- ============================================================================
-- Admin de la organización 1
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*) from clientes)::int, 1,
  'admin de la organización 1 ve exactamente un cliente'
);

select is(
  (select nombre from clientes limit 1), 'Cliente de la Uno',
  'admin de la organización 1 ve el cliente correcto (no el de la organización 2)'
);

select throws_ok(
  $$insert into clientes (organizacion_id, nombre) values ('22222222-2222-2222-2222-222222222222', 'Intento cruzado')$$,
  '42501',
  null,
  'admin de la organización 1 no puede insertar un cliente en la organización 2'
);

update clientes set nombre = 'Hackeado' where organizacion_id = '22222222-2222-2222-2222-222222222222';

reset role;

select is(
  (select nombre from clientes where id = 'c2000000-0000-0000-0000-000000000001'), 'Cliente de la Dos',
  'el intento de actualización cruzada del admin de la organización 1 no afectó ninguna fila'
);

-- ============================================================================
-- Miembro de la organización 1 (aislamiento, no permiso de escritura —
-- eso lo cubre el test de permisos de clientes, US3)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*) from clientes)::int, 1,
  'miembro de la organización 1 ve exactamente un cliente'
);

select is(
  (select nombre from clientes limit 1), 'Cliente de la Uno',
  'miembro de la organización 1 ve el cliente correcto (no el de la organización 2)'
);

reset role;

-- ============================================================================
-- Admin de la organización 2 (simetría — no es un problema de una sola vía)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*) from clientes)::int, 1,
  'admin de la organización 2 ve exactamente un cliente'
);

select is(
  (select nombre from clientes limit 1), 'Cliente de la Dos',
  'admin de la organización 2 ve el cliente correcto (no el de la organización 1)'
);

reset role;

-- ============================================================================
-- Usuario sin ninguna fila en usuarios_organizacion (fail-closed, FR-007)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a9000000-0000-0000-0000-000000000009', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*) from clientes)::int, 0,
  'un usuario sin membresía ni perfil de superadmin no ve ningún cliente'
);

select is(
  (select count(*) from organizaciones)::int, 0,
  'un usuario sin membresía ni perfil de superadmin no ve ninguna organización'
);

reset role;

-- ============================================================================
-- Permisos de escritura en clientes (US3, FR-011): administrador puede
-- crear/editar en su propia organización, miembro no puede (solo lee).
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

insert into clientes (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cliente nuevo del admin');

select is(
  (select count(*) from clientes where organizacion_id = '11111111-1111-1111-1111-111111111111')::int, 2,
  'admin de la organización 1 puede insertar un cliente en su propia organización'
);

update clientes set nombre = 'Cliente nuevo del admin (editado)' where id = 'c1000000-0000-0000-0000-000000000002';

select is(
  (select nombre from clientes where id = 'c1000000-0000-0000-0000-000000000002'),
  'Cliente nuevo del admin (editado)',
  'admin de la organización 1 puede editar un cliente de su propia organización'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$insert into clientes (organizacion_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Intento de miembro')$$,
  '42501',
  null,
  'miembro de la organización 1 no puede insertar clientes (solo lectura, FR-011)'
);

update clientes set nombre = 'Editado por miembro' where id = 'c1000000-0000-0000-0000-000000000001';

reset role;

select is(
  (select nombre from clientes where id = 'c1000000-0000-0000-0000-000000000001'), 'Cliente de la Uno',
  'el intento de edición del miembro de la organización 1 no afectó ninguna fila (solo lectura, FR-011)'
);

-- ============================================================================
-- Superadmin "entra" a una organización a la vez (spec 003, US4, FR-006,
-- FR-013) y contexto de organización activa (spec 004: no-op al salir sin
-- nada activo, salida explícita, auditoría de salida automática al
-- cambiar de organización).
-- En este punto la organización 1 tiene 2 clientes y la 2 tiene 1 (ver
-- secciones anteriores).
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*) from clientes)::int, 0,
  'el superadmin sin ninguna organización activa no ve ningún cliente (fail-closed)'
);

-- Salir sin tener ninguna organización activa es un no-op (spec 004,
-- Clarifications Q1): no falla, no agrega fila de auditoría.
select lives_ok(
  $$select salir_de_organizacion()$$,
  'salir_de_organizacion() sin organización activa no falla (no-op)'
);

reset role;

select is(
  (select count(*) from superadmin_entradas where user_id = 'a5000000-0000-0000-0000-000000000005')::int, 0,
  'el no-op de salir_de_organizacion no agregó ninguna fila de auditoría'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select entrar_a_organizacion('11111111-1111-1111-1111-111111111111');

select is(
  (select count(*) from clientes)::int, 2,
  'tras entrar a la organización 1, el superadmin ve exactamente sus 2 clientes'
);

update clientes set nombre = 'Editado por el superadmin' where id = 'c1000000-0000-0000-0000-000000000001';

select is(
  (select nombre from clientes where id = 'c1000000-0000-0000-0000-000000000001'), 'Editado por el superadmin',
  'con la organización 1 activa, el superadmin puede editar sus clientes (como su administrador)'
);

select entrar_a_organizacion('22222222-2222-2222-2222-222222222222');

select is(
  (select count(*) from clientes)::int, 1,
  'tras entrar a la organización 2, el superadmin ve solo el cliente de esa organización (el contexto cambió, no se mezclan)'
);

reset role;

select is(
  (select count(*) from superadmin_entradas where user_id = 'a5000000-0000-0000-0000-000000000005')::int, 3,
  'quedaron 3 filas de auditoría: entrada a la 1, salida automática de la 1, entrada a la 2 (spec 004, FR-007)'
);

select is(
  (select accion from superadmin_entradas
     where user_id = 'a5000000-0000-0000-0000-000000000005'
     order by id asc limit 1),
  'entrada',
  'la primera fila de auditoría es la entrada a la organización 1'
);

select is(
  (select array_agg(accion order by id asc) from superadmin_entradas
     where user_id = 'a5000000-0000-0000-0000-000000000005'),
  array['entrada', 'salida', 'entrada'],
  'el orden de acciones es entrada (org 1), salida automática (org 1), entrada (org 2) — verificado por id, no por entrado_en (spec 004, research.md)'
);

select is(
  (select organizacion_id from superadmin_entradas
     where user_id = 'a5000000-0000-0000-0000-000000000005' and accion = 'salida'),
  '11111111-1111-1111-1111-111111111111',
  'la fila de salida automática corresponde a la organización que dejó (la 1), no a la nueva activa'
);

-- Salir explícitamente de la organización activa (spec 004, FR-005/FR-006).
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select salir_de_organizacion();

select is(
  (select count(*) from clientes)::int, 0,
  'tras salir, el superadmin vuelve a no ver ningún cliente (fail-closed, igual que antes de haber entrado)'
);

reset role;

select is(
  (select count(*) from superadmin_entradas where user_id = 'a5000000-0000-0000-0000-000000000005')::int, 4,
  'la salida explícita agregó una cuarta fila de auditoría'
);

select is(
  (select accion from superadmin_entradas
     where user_id = 'a5000000-0000-0000-0000-000000000005'
     order by id desc limit 1),
  'salida',
  'la última fila de auditoría es la salida explícita de la organización 2'
);

-- Membresías (spec 005, US1): administrador lista su organización, miembro
-- conserva solo su propia fila y superadmin sin contexto no recibe el listado.
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*) from usuarios_organizacion)::int, 3, 'administrador lista las tres membresías de su organización');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*) from usuarios_organizacion)::int, 1, 'miembro solo conserva lectura de su propia membresía');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'a5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*) from usuarios_organizacion)::int, 0, 'superadmin sin organización activa no lista membresías');
reset role;

-- Incorporación y auditoría (spec 005, US1).
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$select agregar_miembro('a9000000-0000-0000-0000-000000000010', 'miembro', 'miembro_agregado')$$, 'administrador puede incorporar una cuenta existente sin membresía');
select is((select rol_id from usuarios_organizacion where user_id = 'a9000000-0000-0000-0000-000000000010'), 'miembro', 'la cuenta existente queda vinculada con el rol solicitado');
reset role;
select is((select accion from eventos_membresia order by id desc limit 1), 'miembro_agregado', 'la incorporación existente queda auditada');
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$select agregar_miembro('a9000000-0000-0000-0000-000000000010', 'miembro', 'miembro_agregado')$$, '23505', null, 'una incorporación duplicada se rechaza');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'a5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text, true);
set local role authenticated;
select entrar_a_organizacion('22222222-2222-2222-2222-222222222222');
select lives_ok($$select agregar_miembro('a9000000-0000-0000-0000-000000000009', 'miembro', 'miembro_agregado')$$, 'superadmin incorpora dentro de su organización activa');
reset role;

select is(
  (select count(*) from eventos_membresia
   where organizacion_id in (
     '11111111-1111-1111-1111-111111111111',
     '22222222-2222-2222-2222-222222222222'
   ))::int,
  2,
  'solo las incorporaciones efectivas del fixture generan auditoría'
);

-- Cambio de rol (spec 005, US2): promoción, degradación, autorización,
-- último administrador y auditoría de las operaciones efectivas.
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$select cambiar_rol_miembro('a1000000-0000-0000-0000-000000000002', 'administrador')$$, 'administrador puede promover un miembro de su organización');
select is((select rol_id from usuarios_organizacion where user_id = 'a1000000-0000-0000-0000-000000000002'), 'administrador', 'el miembro promovido adquiere rol administrador');
reset role;
select is((select accion from eventos_membresia where target_user_id = 'a1000000-0000-0000-0000-000000000002' order by id desc limit 1), 'rol_cambiado', 'la promoción queda auditada como cambio de rol');
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$select cambiar_rol_miembro('a1000000-0000-0000-0000-000000000003', 'miembro')$$, 'administrador puede degradar a otro administrador mientras queda otro');
select is((select rol_id from usuarios_organizacion where user_id = 'a1000000-0000-0000-0000-000000000003'), 'miembro', 'el administrador degradado conserva la membresía con rol miembro');
select throws_ok($$select cambiar_rol_miembro('a1000000-0000-0000-0000-000000000001', 'miembro')$$, '22023', null, 'un administrador no puede cambiar su propio rol');
select throws_ok($$select cambiar_rol_miembro('a1000000-0000-0000-0000-000000000002', 'propietario')$$, '22023', null, 'un rol no permitido se rechaza');
select throws_ok($$select cambiar_rol_miembro('a2000000-0000-0000-0000-000000000001', 'miembro')$$, '42501', null, 'un administrador no puede cambiar el rol de otra organización');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$select cambiar_rol_miembro('a1000000-0000-0000-0000-000000000002', 'miembro')$$, '42501', null, 'un miembro no puede cambiar roles');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$select cambiar_rol_miembro('a1000000-0000-0000-0000-000000000002', 'miembro')$$, 'administrador puede degradar a otro administrador cuando conserva su propio rol');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'a5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text, true);
set local role authenticated;
select entrar_a_organizacion('11111111-1111-1111-1111-111111111111');
select throws_ok($$select cambiar_rol_miembro('a1000000-0000-0000-0000-000000000001', 'miembro')$$, null, null, 'el superadmin no puede degradar al último administrador');
reset role;

select is((select rol_id from usuarios_organizacion where user_id = 'a1000000-0000-0000-0000-000000000001'), 'administrador', 'el último administrador conserva su rol tras el rechazo');
select is((select count(*) from eventos_membresia where organizacion_id = '11111111-1111-1111-1111-111111111111' and accion = 'rol_cambiado')::int, 3, 'solo los tres cambios de rol efectivos generan auditoría');

-- Remoción (spec 005, US3): autorización, pérdida de acceso, último
-- administrador y auditoría de las operaciones efectivas.
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$select remover_miembro('a1000000-0000-0000-0000-000000000002')$$, 'administrador puede remover un miembro de su organización');
reset role;
select is((select accion from eventos_membresia where target_user_id = 'a1000000-0000-0000-0000-000000000002' order by id desc limit 1), 'miembro_removido', 'la remoción queda auditada');

select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*) from usuarios_organizacion)::int, 0, 'la persona removida pierde acceso a su membresía');
select is((select count(*) from clientes)::int, 0, 'la persona removida pierde acceso a los datos de la organización');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$select remover_miembro('a2000000-0000-0000-0000-000000000001')$$, '42501', null, 'un administrador no puede remover un miembro de otra organización');
select throws_ok($$select remover_miembro('a1000000-0000-0000-0000-000000000001')$$, '22023', null, 'un administrador no puede removerse a sí mismo');
select lives_ok($$select cambiar_rol_miembro('a1000000-0000-0000-0000-000000000003', 'administrador')$$, 'se puede promover otro administrador antes de removerlo');
select lives_ok($$select remover_miembro('a1000000-0000-0000-0000-000000000003')$$, 'administrador puede remover a otro administrador cuando queda uno');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$select remover_miembro('a1000000-0000-0000-0000-000000000001')$$, '42501', null, 'un miembro no puede remover personas');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'a5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text, true);
set local role authenticated;
select entrar_a_organizacion('11111111-1111-1111-1111-111111111111');
select throws_ok($$select remover_miembro('a1000000-0000-0000-0000-000000000001')$$, null, null, 'el superadmin no puede remover al último administrador');
reset role;

select is((select rol_id from usuarios_organizacion where user_id = 'a1000000-0000-0000-0000-000000000001'), 'administrador', 'el último administrador conserva su membresía tras el rechazo');
select is((select count(*) from eventos_membresia where organizacion_id = '11111111-1111-1111-1111-111111111111' and accion = 'miembro_removido')::int, 2, 'solo las dos remociones efectivas generan auditoría');

select * from finish();

rollback;
