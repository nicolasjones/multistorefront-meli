-- Panel de funcionalidades por organización (spec 009). Ver
-- specs/009-panel-de-funcionalidades/data-model.md y
-- contracts/gestion-funcionalidades.md.
--
-- Mismo patrón que analitica_embebida.test.sql: fixture como postgres
-- (dueño, RLS no aplica), después "authenticated" simulando cada usuario
-- vía request.jwt.claims — igual que PostgREST.
begin;

select plan(31);

-- ============================================================================
-- Fixture
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('c1111111-1111-1111-1111-111111111111', 'Organización X'),
  ('c2222222-2222-2222-2222-222222222222', 'Organización Y'),
  -- Sin ninguna habilitación nunca — usada para probar fail-closed
  -- (una organización sin nada habilitado no ve nada por defecto) y que
  -- el catálogo completo no se expone a quien no tiene acceso.
  ('c3333333-3333-3333-3333-333333333333', 'Organización Z'),
  -- Solo para el test de cascada al borrar (T007, FR-011) — se borra a
  -- mitad del archivo, nunca se usa en ningún otro bloque.
  ('c4444444-4444-4444-4444-444444444444', 'Organización a borrar');

insert into auth.users (id, email) values
  ('c5000000-0000-0000-0000-000000000005', 'superadmin-features@example.com'),
  ('c1000000-0000-0000-0000-000000000001', 'admin-x@example.com'),
  ('c2000000-0000-0000-0000-000000000001', 'admin-y@example.com'),
  ('c3000000-0000-0000-0000-000000000001', 'admin-z@example.com');

insert into superadmins (user_id) values ('c5000000-0000-0000-0000-000000000005');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('c1000000-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111111', 'administrador'),
  ('c2000000-0000-0000-0000-000000000001', 'c2222222-2222-2222-2222-222222222222', 'administrador'),
  ('c3000000-0000-0000-0000-000000000001', 'c3333333-3333-3333-3333-333333333333', 'administrador');

create temporary table t_ids (key text primary key, val uuid);
grant all on t_ids to authenticated;

-- ============================================================================
-- registrar_feature (FR-001) — permisos y validación de formato
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.registrar_feature('feature-uno', 'Feature Uno')$$,
  '42501',
  null,
  'un administrador de organización no puede registrar funcionalidades (solo superadmin)'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.registrar_feature('Feature Uno', 'Feature Uno')$$,
  '22023',
  null,
  'registrar_feature rechaza un id con formato inválido (mayúsculas/espacios)'
);

select is(
  (select (public.registrar_feature('feature-uno', 'Feature Uno', 'Primera funcionalidad de prueba')).id),
  'feature-uno',
  'registrar_feature crea la funcionalidad y devuelve la fila'
);

select is(
  (select count(*)::int from eventos_features where feature_id = 'feature-uno' and accion = 'feature_registrada'),
  1,
  'el alta de catálogo quedó auditada (FR-005)'
);

reset role;

-- ============================================================================
-- habilitar_feature (FR-002) — permisos, validación e idempotencia
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.habilitar_feature('feature-uno', 'c1111111-1111-1111-1111-111111111111')$$,
  '42501',
  null,
  'un administrador de organización no puede habilitar funcionalidades (solo superadmin, FR-010)'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.habilitar_feature('feature-que-no-existe', 'c1111111-1111-1111-1111-111111111111')$$,
  'P0002',
  null,
  'habilitar_feature rechaza una funcionalidad que no existe en el catálogo'
);

select throws_ok(
  $$select public.habilitar_feature('feature-uno', '00000000-0000-0000-0000-000000000000')$$,
  'P0002',
  null,
  'habilitar_feature rechaza una organización que no existe'
);

select lives_ok(
  $$select public.habilitar_feature('feature-uno', 'c1111111-1111-1111-1111-111111111111')$$,
  'habilitar_feature para X no lanza error'
);

select is(
  (select count(*)::int from organizaciones_features
     where feature_id = 'feature-uno' and organizacion_id = 'c1111111-1111-1111-1111-111111111111'),
  1,
  'X queda habilitada para feature-uno'
);

select is(
  (select count(*)::int from eventos_features
     where feature_id = 'feature-uno' and organizacion_id = 'c1111111-1111-1111-1111-111111111111' and accion = 'habilitada'),
  1,
  'la habilitación quedó auditada (FR-005/SC-003)'
);

select public.habilitar_feature('feature-uno', 'c1111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from eventos_features
     where feature_id = 'feature-uno' and organizacion_id = 'c1111111-1111-1111-1111-111111111111' and accion = 'habilitada'),
  1,
  'habilitar_feature es idempotente: repetir la habilitación no duplica el evento (Principio III, FR-012)'
);

reset role;

-- ============================================================================
-- deshabilitar_feature (FR-002) — permisos, no-op e idempotencia
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.deshabilitar_feature('feature-uno', 'c1111111-1111-1111-1111-111111111111')$$,
  '42501',
  null,
  'un administrador de organización no puede deshabilitar funcionalidades (solo superadmin)'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select public.deshabilitar_feature('feature-uno', 'c1111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from organizaciones_features
     where feature_id = 'feature-uno' and organizacion_id = 'c1111111-1111-1111-1111-111111111111'),
  0,
  'deshabilitar_feature quita la habilitación de X — vuelve al estado fail-closed'
);

select is(
  (select count(*)::int from eventos_features
     where feature_id = 'feature-uno' and organizacion_id = 'c1111111-1111-1111-1111-111111111111' and accion = 'deshabilitada'),
  1,
  'la deshabilitación quedó auditada'
);

select public.deshabilitar_feature('feature-uno', 'c1111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from eventos_features
     where feature_id = 'feature-uno' and organizacion_id = 'c1111111-1111-1111-1111-111111111111' and accion = 'deshabilitada'),
  1,
  'deshabilitar algo ya deshabilitado es un no-op: no duplica el evento'
);

-- Vuelve a habilitarla para X, y también para Y, para los bloques
-- siguientes de aislamiento entre organizaciones.
select public.habilitar_feature('feature-uno', 'c1111111-1111-1111-1111-111111111111');
select public.habilitar_feature('feature-uno', 'c2222222-2222-2222-2222-222222222222');

reset role;

-- ============================================================================
-- Aislamiento entre organizaciones con la MISMA funcionalidad habilitada
-- (FR-007) — réplica deliberada del bug real de 007
-- (puede_ver_reporte vs puede_ver_asignacion): una función pensada para
-- "tengo acceso en general" no debe usarse para autorizar una fila
-- puntual, o una organización termina viendo la fila de otra.
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from organizaciones_features where feature_id = 'feature-uno'),
  1,
  'administrador de X ve exactamente 1 fila de organizaciones_features (la suya), aunque feature-uno esté habilitada también para Y'
);

select is(
  (select organizacion_id from organizaciones_features where feature_id = 'feature-uno'),
  'c1111111-1111-1111-1111-111111111111',
  'y esa fila es la de X, no la de Y'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from organizaciones_features where feature_id = 'feature-uno'),
  1,
  'administrador de Y ve exactamente 1 fila (la suya), no la de X'
);

select is(
  (select organizacion_id from organizaciones_features where feature_id = 'feature-uno'),
  'c2222222-2222-2222-2222-222222222222',
  'y esa fila es la de Y, no la de X'
);

reset role;

-- ============================================================================
-- tiene_feature_publica: aislado por organización y fail-closed (FR-003,
-- FR-006, FR-007)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select public.tiene_feature_publica('feature-uno')),
  true,
  'administrador de X: tiene_feature_publica da true (X tiene feature-uno habilitada)'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select public.tiene_feature_publica('feature-uno')),
  true,
  'administrador de Y: también true (habilitada para Y también, de forma independiente)'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c3000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select public.tiene_feature_publica('feature-uno')),
  false,
  'administrador de Z: false — Z nunca tuvo feature-uno habilitada (fail-closed, FR-003)'
);

reset role;

-- ============================================================================
-- El superadmin resuelve según su organización activa (FR-009) — no una
-- fila cualquiera, mismo criterio que resolver_organizacion_reporte en 007.
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select entrar_a_organizacion('c1111111-1111-1111-1111-111111111111');

select is(
  (select public.tiene_feature_publica('feature-uno')),
  true,
  'superadmin con X activa: true'
);

select entrar_a_organizacion('c3333333-3333-3333-3333-333333333333');

select is(
  (select public.tiene_feature_publica('feature-uno')),
  false,
  'tras entrar a Z (sin habilitar), el resultado cambia a false — sigue la organización activa, no una fila fija'
);

-- ============================================================================
-- El catálogo completo no se expone a quien no tiene acceso (FR-008)
-- ============================================================================

select public.registrar_feature('feature-dos', 'Feature Dos');

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c3000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from features),
  0,
  'administrador de Z no ve ninguna fila del catálogo — no tiene ninguna funcionalidad habilitada'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from features),
  1,
  'administrador de X ve solo feature-uno (la que tiene habilitada) — feature-dos, sin habilitar, no aparece'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select cmp_ok(
  (select count(*)::int from features),
  '>=',
  2,
  'el superadmin ve el catálogo completo, sin la restricción de las organizaciones'
);

reset role;

-- ============================================================================
-- eventos_features: aislamiento de la auditoría por organización
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from eventos_features where organizacion_id = 'c1111111-1111-1111-1111-111111111111'),
  0,
  'administrador de Y no ve eventos de auditoría de X'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select cmp_ok(
  (select count(*)::int from eventos_features),
  '>',
  0,
  'el superadmin ve toda la auditoría, de cualquier organización'
);

-- ============================================================================
-- Borrar una organización cascadea sus habilitaciones sin tocar el
-- catálogo (FR-011)
-- ============================================================================

select public.habilitar_feature('feature-uno', 'c4444444-4444-4444-4444-444444444444');

reset role;

delete from organizaciones where id = 'c4444444-4444-4444-4444-444444444444';

select is(
  (select count(*)::int from organizaciones_features where organizacion_id = 'c4444444-4444-4444-4444-444444444444'),
  0,
  'borrar la organización se lleva su habilitación con ella'
);

select is(
  (select count(*)::int from features where id = 'feature-uno'),
  1,
  'el catálogo (feature-uno) sigue existiendo, sin verse afectado por el borrado de esa organización'
);

select * from finish();

rollback;
