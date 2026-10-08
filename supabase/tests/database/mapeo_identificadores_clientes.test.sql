-- Mapeo de identificadores externos de clientes. Ver
-- specs/20260930-135541-mapeo-identificadores-clientes/data-model.md y
-- contracts/mapeo-identificadores-externos.md.
begin;

select plan(27);

-- ============================================================================
-- Fixture
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('f1111111-1111-1111-1111-111111111111', 'Organización X'),
  ('f2222222-2222-2222-2222-222222222222', 'Organización Y');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'admin-x-mapeo@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'miembro-x-mapeo@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-y-mapeo@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000001', 'f1111111-1111-1111-1111-111111111111', 'administrador'),
  ('f1000000-0000-0000-0000-000000000002', 'f1111111-1111-1111-1111-111111111111', 'miembro'),
  ('f2000000-0000-0000-0000-000000000001', 'f2222222-2222-2222-2222-222222222222', 'administrador');

insert into clientes (id, organizacion_id, nombre) values
  ('f3000000-0000-0000-0000-000000000001', 'f1111111-1111-1111-1111-111111111111', 'Cliente X1'),
  ('f3000000-0000-0000-0000-000000000002', 'f1111111-1111-1111-1111-111111111111', 'Cliente X2'),
  ('f3000000-0000-0000-0000-000000000003', 'f2222222-2222-2222-2222-222222222222', 'Cliente Y1');

insert into auth.users (id, email) values
  ('f5000000-0000-0000-0000-000000000005', 'superadmin-mapeo@example.com');

insert into superadmins (user_id) values ('f5000000-0000-0000-0000-000000000005');

insert into superadmin_organizacion_activa (user_id, organizacion_id) values
  ('f5000000-0000-0000-0000-000000000005', 'f1111111-1111-1111-1111-111111111111');

create temporary table t_ids (key text primary key, val uuid);
grant all on t_ids to authenticated;

-- ============================================================================
-- Fundamentos: sin grant de insert/update/delete a authenticated (Decisión 1
-- de research.md) — toda escritura pasa por las funciones SECURITY DEFINER
-- de abajo, nunca por un insert/update/delete directo del cliente.
-- ============================================================================

select is(
  has_table_privilege('authenticated', 'clientes_identificadores_externos', 'INSERT'),
  false,
  'authenticated no tiene INSERT directo sobre clientes_identificadores_externos'
);

select is(
  has_table_privilege('authenticated', 'clientes_identificadores_externos', 'UPDATE'),
  false,
  'authenticated no tiene UPDATE directo sobre clientes_identificadores_externos'
);

select is(
  has_table_privilege('authenticated', 'clientes_identificadores_externos', 'DELETE'),
  false,
  'authenticated no tiene DELETE directo sobre clientes_identificadores_externos'
);

-- ============================================================================
-- Historia 1: vincular_identificador_externo (FR-001, FR-002, FR-003,
-- FR-004, FR-009, FR-010, FR-011)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.vincular_identificador_externo('f3000000-0000-0000-0000-000000000001', 'sistema-prueba', 'ext-001')$$,
  '42501',
  null,
  'un miembro sin rol administrador no puede vincular (FR-009)'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.vincular_identificador_externo('00000000-0000-0000-0000-000000000000', 'sistema-prueba', 'ext-001')$$,
  'P0002',
  null,
  'vincular_identificador_externo rechaza un cliente que no existe'
);

select throws_ok(
  $$select public.vincular_identificador_externo('f3000000-0000-0000-0000-000000000003', 'sistema-prueba', 'ext-001')$$,
  '42501',
  null,
  'el administrador de X no puede vincular un identificador a un cliente de Y'
);

select throws_ok(
  $$select public.vincular_identificador_externo('f3000000-0000-0000-0000-000000000001', '   ', 'ext-001')$$,
  '23514',
  null,
  'vincular_identificador_externo rechaza un sistema vacío/solo espacios (FR-011)'
);

select throws_ok(
  $$select public.vincular_identificador_externo('f3000000-0000-0000-0000-000000000001', 'sistema-prueba', '')$$,
  '23514',
  null,
  'vincular_identificador_externo rechaza un identificador externo vacío (FR-011)'
);

insert into t_ids (key, val)
select 'vinculo_x1', (public.vincular_identificador_externo('f3000000-0000-0000-0000-000000000001', 'sistema-prueba', 'ext-001')).id;

select is(
  (select cliente_id from clientes_identificadores_externos where id = (select val from t_ids where key = 'vinculo_x1')),
  'f3000000-0000-0000-0000-000000000001'::uuid,
  'vincular_identificador_externo crea el vínculo para el cliente indicado (FR-001)'
);

select lives_ok(
  $$select public.vincular_identificador_externo('f3000000-0000-0000-0000-000000000001', 'sistema-prueba', 'ext-001')$$,
  're-vincular el mismo par al mismo cliente no falla (FR-004)'
);

select is(
  (select count(*)::int from clientes_identificadores_externos where sistema = 'sistema-prueba' and identificador_externo = 'ext-001'),
  1,
  're-vincular el mismo par al mismo cliente no crea una segunda fila (FR-004)'
);

select throws_ok(
  $$select public.vincular_identificador_externo('f3000000-0000-0000-0000-000000000002', 'sistema-prueba', 'ext-001')$$,
  '23505',
  null,
  'vincular un identificador ya usado por otro cliente falla (FR-002, FR-010)'
);

select is(
  (select cliente_id from clientes_identificadores_externos where sistema = 'sistema-prueba' and identificador_externo = 'ext-001'),
  'f3000000-0000-0000-0000-000000000001'::uuid,
  'el intento fallido no modificó el vínculo original (FR-010)'
);

select lives_ok(
  $$select public.vincular_identificador_externo('f3000000-0000-0000-0000-000000000001', 'otro-sistema', 'ext-999')$$,
  'un cliente puede tener vinculado más de un identificador, de sistemas distintos (FR-003)'
);

select is(
  (select count(*)::int from clientes_identificadores_externos where cliente_id = 'f3000000-0000-0000-0000-000000000001'),
  2,
  'el cliente queda con sus dos identificadores simultáneos, de sistemas distintos (FR-003)'
);

reset role;

-- ============================================================================
-- Historia 2: lectura por RLS (FR-005, FR-006, FR-008, SC-003)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from clientes_identificadores_externos where cliente_id = 'f3000000-0000-0000-0000-000000000001'),
  2,
  'un miembro (sin rol administrador) puede listar los identificadores de un cliente de su organización, incluidos los de distintos sistemas (FR-005, FR-003)'
);

select is(
  (select cliente_id from clientes_identificadores_externos where sistema = 'sistema-prueba' and identificador_externo = 'ext-001'),
  'f3000000-0000-0000-0000-000000000001'::uuid,
  'un miembro puede resolver el cliente a partir de sistema + identificador (FR-006)'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from clientes_identificadores_externos where cliente_id = 'f3000000-0000-0000-0000-000000000001'),
  2,
  'un superadmin con la organización de X activa ve los identificadores de sus clientes (FR-008)'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from clientes_identificadores_externos where cliente_id = 'f3000000-0000-0000-0000-000000000001'),
  0,
  'un usuario de otra organización no ve los identificadores de un cliente ajeno (FR-008, SC-003)'
);

select is(
  (select count(*)::int from clientes_identificadores_externos where sistema = 'sistema-prueba' and identificador_externo = 'ext-001'),
  0,
  'un usuario de otra organización no resuelve un identificador ajeno aunque conozca el par exacto (SC-003)'
);

reset role;

-- ============================================================================
-- Historia 3: desvincular_identificador_externo (FR-007, FR-009)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  format($$select public.desvincular_identificador_externo('%s')$$, (select val from t_ids where key = 'vinculo_x1')),
  '42501',
  null,
  'un miembro sin rol administrador no puede desvincular (FR-009)'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  format($$select public.desvincular_identificador_externo('%s')$$, (select val from t_ids where key = 'vinculo_x1')),
  '42501',
  null,
  'el administrador de Y no puede desvincular un vínculo de X'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select lives_ok(
  $$select public.desvincular_identificador_externo('00000000-0000-0000-0000-000000000000')$$,
  'desvincular un id inexistente es un no-op, no un error (FR-007)'
);

select lives_ok(
  format($$select public.desvincular_identificador_externo('%s')$$, (select val from t_ids where key = 'vinculo_x1')),
  'el administrador de X puede desvincular su propio vínculo'
);

select is(
  (select count(*)::int from clientes_identificadores_externos where id = (select val from t_ids where key = 'vinculo_x1')),
  0,
  'el vínculo desaparece tras desvincularlo (FR-007)'
);

select lives_ok(
  $$select public.vincular_identificador_externo('f3000000-0000-0000-0000-000000000002', 'sistema-prueba', 'ext-001')$$,
  'el identificador liberado puede vincularse a otro cliente (FR-007)'
);

reset role;

-- ============================================================================
-- Cierre: eliminación en cascada (FR-010, SC-004)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select public.vincular_identificador_externo('f3000000-0000-0000-0000-000000000001', 'sistema-cascada', 'ext-cascada');

reset role;

delete from clientes where id = 'f3000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from clientes_identificadores_externos where cliente_id = 'f3000000-0000-0000-0000-000000000001'),
  0,
  'eliminar un cliente elimina en cascada TODOS sus identificadores externos vinculados, incluido el de otro sistema que quedaba de la Historia 1 (FR-010, SC-004)'
);

select * from finish();

rollback;
