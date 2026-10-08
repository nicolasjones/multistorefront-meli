-- Catálogo real para sistema_externo en conexiones (spec 013). Ver
-- specs/20260930-165358-catalogo-sistemas-externos/.
begin;

select plan(6);

insert into organizaciones (id, nombre) values
  ('fa111111-1111-1111-1111-111111111111', 'Organización catálogo');

insert into auth.users (id, email) values
  ('fa100000-0000-0000-0000-000000000001', 'admin-catalogo@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('fa100000-0000-0000-0000-000000000001', 'fa111111-1111-1111-1111-111111111111', 'administrador');

-- ============================================================================
-- El catálogo se crea vacío (FR-002)
-- ============================================================================

select is(
  (select count(*) from sistemas_externos),
  0::bigint,
  'sistemas_externos se crea vacía: sin valores de negocio cargados por esta migración'
);

-- ============================================================================
-- crear_conexion falla si sistema_externo no existe en el catálogo (FR-003, SC-001)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'fa100000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.crear_conexion('fa111111-1111-1111-1111-111111111111', 'sistema-que-no-existe', 'credencial-de-prueba')$$,
  '23503',
  null,
  'crear_conexion rechaza un sistema_externo que no tiene fila en el catálogo'
);

reset role;

-- ============================================================================
-- Con una fila en el catálogo, crear_conexion vuelve a funcionar igual que
-- antes de esta spec (FR-003, sin cambio de contrato)
-- ============================================================================

insert into sistemas_externos (id, descripcion) values
  ('demo', 'Sistema de demostración (fixture de test, sin valor de negocio)');

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'fa100000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select lives_ok(
  $$select public.crear_conexion('fa111111-1111-1111-1111-111111111111', 'demo', 'credencial-de-prueba')$$,
  'crear_conexion funciona con un sistema_externo que sí existe en el catálogo'
);

select is(
  (select estado from conexiones where organizacion_id = 'fa111111-1111-1111-1111-111111111111' and sistema_externo = 'demo'),
  'activa',
  'la conexión se crea con estado activa, igual que antes de esta spec'
);

-- ============================================================================
-- El catálogo es de solo lectura para cualquier autenticado (FR-004)
-- ============================================================================

select is(
  (select count(*) from sistemas_externos),
  1::bigint,
  'cualquier authenticated puede leer el catálogo'
);

select throws_ok(
  $$insert into sistemas_externos (id, descripcion) values ('otro', 'no debería poder crearse')$$,
  '42501',
  null,
  'authenticated no tiene grant de escritura sobre el catálogo'
);

reset role;

select * from finish();
rollback;
