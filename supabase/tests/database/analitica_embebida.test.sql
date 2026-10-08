-- Analítica embebida por organización (spec 007). Ver
-- specs/007-analitica-embebida/data-model.md y contracts/gestion-reportes.md.
--
-- Mismo patrón que aislamiento_organizaciones.test.sql: fixture como
-- postgres (dueño, RLS no aplica), después "authenticated" simulando cada
-- usuario vía request.jwt.claims — igual que PostgREST.
begin;

select plan(41);

-- ============================================================================
-- Fixture
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('b1111111-1111-1111-1111-111111111111', 'Organización X'),
  ('b2222222-2222-2222-2222-222222222222', 'Organización Y'),
  -- Sin ningún reporte asignado nunca — usada para probar
  -- reportes_visibles_para_mi() cuando el superadmin entra a una
  -- organización que no tiene nada (bug real, ver más abajo).
  ('b3333333-3333-3333-3333-333333333333', 'Organización Z');

insert into auth.users (id, email) values
  ('b5000000-0000-0000-0000-000000000005', 'superadmin-analitica@example.com'),
  ('b1000000-0000-0000-0000-000000000001', 'admin-x@example.com'),
  ('b1000000-0000-0000-0000-000000000002', 'miembro-x@example.com'),
  ('b1000000-0000-0000-0000-000000000003', 'invitado-x@example.com'),
  ('b2000000-0000-0000-0000-000000000001', 'admin-y@example.com'),
  ('b2000000-0000-0000-0000-000000000002', 'miembro-y@example.com');

insert into superadmins (user_id) values ('b5000000-0000-0000-0000-000000000005');

-- Rol nuevo, agregado después de que ya existirán reportes con visibilidad
-- definida (FR-014) — se prueba más abajo que no hereda acceso retroactivo.
insert into roles_organizacion (id, descripcion) values
  ('invitado', 'Rol de prueba para FR-014: sin acceso retroactivo a reportes existentes.');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('b1000000-0000-0000-0000-000000000001', 'b1111111-1111-1111-1111-111111111111', 'administrador'),
  ('b1000000-0000-0000-0000-000000000002', 'b1111111-1111-1111-1111-111111111111', 'miembro'),
  ('b1000000-0000-0000-0000-000000000003', 'b1111111-1111-1111-1111-111111111111', 'invitado'),
  ('b2000000-0000-0000-0000-000000000001', 'b2222222-2222-2222-2222-222222222222', 'administrador'),
  ('b2000000-0000-0000-0000-000000000002', 'b2222222-2222-2222-2222-222222222222', 'miembro');

create temporary table t_ids (key text primary key, val uuid);
grant all on t_ids to authenticated;

-- ============================================================================
-- registrar_reporte (FR-001/FR-002) — permisos y validación
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.registrar_reporte('dash-1', 'Reporte de prueba', array['miembro'])$$,
  '42501',
  null,
  'un administrador de organización no puede registrar reportes (solo superadmin)'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.registrar_reporte('dash-1', 'Reporte de prueba', array['administrador'])$$,
  '22023',
  null,
  'registrar_reporte rechaza administrador en el default (FR-006)'
);

insert into t_ids (key, val)
select 'reporte1', (public.registrar_reporte('dash-1', 'Reporte de prueba', array['miembro'])).id;

select ok(
  (select val from t_ids where key = 'reporte1') is not null,
  'registrar_reporte devuelve el reporte creado'
);

select is(
  (select count(*)::int from reportes_roles_default where reporte_id = (select val from t_ids where key = 'reporte1')),
  1,
  'el default del reporte tiene exactamente 1 rol (miembro)'
);

reset role;

-- ============================================================================
-- asignar_reporte (FR-003/FR-004) — herencia congelada e idempotencia
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select lives_ok(
  $$select public.asignar_reporte(
      (select val from t_ids where key = 'reporte1'),
      'b1111111-1111-1111-1111-111111111111'
    )$$,
  'asignar_reporte a la organización X no lanza error'
);

select is(
  (select count(*)::int from reportes_organizaciones_roles
     where reporte_id = (select val from t_ids where key = 'reporte1')
       and organizacion_id = 'b1111111-1111-1111-1111-111111111111'),
  1,
  'X hereda exactamente el default vigente al momento de asignarse (1 rol: miembro)'
);

select is(
  (select count(*)::int from eventos_reportes
     where reporte_id = (select val from t_ids where key = 'reporte1')
       and organizacion_id = 'b1111111-1111-1111-1111-111111111111'
       and accion = 'asignado'),
  1,
  'la asignación quedó auditada (FR-012/SC-004)'
);

select public.asignar_reporte(
  (select val from t_ids where key = 'reporte1'),
  'b1111111-1111-1111-1111-111111111111'
);

select is(
  (select count(*)::int from eventos_reportes
     where reporte_id = (select val from t_ids where key = 'reporte1')
       and organizacion_id = 'b1111111-1111-1111-1111-111111111111'
       and accion = 'asignado'),
  1,
  'asignar_reporte es idempotente: repetir la asignación no duplica el evento (Principio III)'
);

reset role;

-- ============================================================================
-- Visibilidad de "reportes" (FR-006/FR-007/FR-014)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from reportes where id = (select val from t_ids where key = 'reporte1')),
  1,
  'administrador de X ve el reporte (acceso incondicional, FR-006) aunque el default sea solo miembro'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from reportes where id = (select val from t_ids where key = 'reporte1')),
  1,
  'miembro de X ve el reporte (su rol está en la visibilidad heredada, FR-007)'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b1000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from reportes where id = (select val from t_ids where key = 'reporte1')),
  0,
  'un rol nuevo (invitado) agregado después no hereda acceso retroactivo a un reporte existente (FR-014)'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from reportes where id = (select val from t_ids where key = 'reporte1')),
  0,
  'administrador de Y no ve un reporte no asignado a su organización (FR-007)'
);

reset role;

-- ============================================================================
-- establecer_roles_default_reporte (FR-004, no retroactivo)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.establecer_roles_default_reporte(
      (select val from t_ids where key = 'reporte1'), array['administrador']
    )$$,
  '22023',
  null,
  'establecer_roles_default_reporte rechaza administrador (FR-006)'
);

select public.establecer_roles_default_reporte(
  (select val from t_ids where key = 'reporte1'), array[]::text[]
);

select is(
  (select count(*)::int from reportes_organizaciones_roles
     where reporte_id = (select val from t_ids where key = 'reporte1')
       and organizacion_id = 'b1111111-1111-1111-1111-111111111111'),
  1,
  'cambiar el default a vacío NO afecta la visibilidad ya heredada por X (FR-004, Acceptance Scenario 4)'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from reportes where id = (select val from t_ids where key = 'reporte1')),
  1,
  'miembro de X sigue viendo el reporte pese al cambio de default (confirma el punto anterior desde su propia sesión)'
);

reset role;

-- ============================================================================
-- desasignar_reporte + reasignar arranca del default vigente (FR-016)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select public.desasignar_reporte(
  (select val from t_ids where key = 'reporte1'),
  'b1111111-1111-1111-1111-111111111111'
);

select is(
  (select count(*)::int from reportes_organizaciones
     where reporte_id = (select val from t_ids where key = 'reporte1')
       and organizacion_id = 'b1111111-1111-1111-1111-111111111111'),
  0,
  'desasignar_reporte quita la asignación'
);

select is(
  (select count(*)::int from reportes_organizaciones_roles
     where reporte_id = (select val from t_ids where key = 'reporte1')
       and organizacion_id = 'b1111111-1111-1111-1111-111111111111'),
  0,
  'la cascada limpia la visibilidad por rol de X al desasignar'
);

select is(
  (select count(*)::int from eventos_reportes
     where reporte_id = (select val from t_ids where key = 'reporte1')
       and organizacion_id = 'b1111111-1111-1111-1111-111111111111'
       and accion = 'desasignado'),
  1,
  'la desasignación quedó auditada'
);

select public.desasignar_reporte(
  (select val from t_ids where key = 'reporte1'),
  'b1111111-1111-1111-1111-111111111111'
);

select is(
  (select count(*)::int from eventos_reportes
     where reporte_id = (select val from t_ids where key = 'reporte1')
       and organizacion_id = 'b1111111-1111-1111-1111-111111111111'
       and accion = 'desasignado'),
  1,
  'desasignar_reporte ya desasignado es un no-op: no duplica el evento'
);

select public.asignar_reporte(
  (select val from t_ids where key = 'reporte1'),
  'b1111111-1111-1111-1111-111111111111'
);

select is(
  (select count(*)::int from reportes_organizaciones_roles
     where reporte_id = (select val from t_ids where key = 'reporte1')
       and organizacion_id = 'b1111111-1111-1111-1111-111111111111'),
  0,
  'al reasignar, X arranca del default vigente (vacío) — no conserva el "miembro" que tenía antes de ser desasignada (FR-016)'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from reportes where id = (select val from t_ids where key = 'reporte1')),
  0,
  'tras la reasignación, miembro de X ya no ve el reporte (confirma FR-016 desde su propia sesión)'
);

reset role;

-- ============================================================================
-- establecer_roles_reporte_organizacion (FR-005/FR-006) — admin de organización
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.establecer_roles_reporte_organizacion(
      (select val from t_ids where key = 'reporte1'), 'b1111111-1111-1111-1111-111111111111', array['miembro']
    )$$,
  '42501',
  null,
  'administrador de Y no puede cambiar la visibilidad de X (permiso por organización)'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.establecer_roles_reporte_organizacion(
      (select val from t_ids where key = 'reporte1'), 'b2222222-2222-2222-2222-222222222222', array['miembro']
    )$$,
  '42501',
  null,
  'establecer_roles_reporte_organizacion rechaza un reporte no asignado a esa organización'
);

select throws_ok(
  $$select public.establecer_roles_reporte_organizacion(
      (select val from t_ids where key = 'reporte1'), 'b1111111-1111-1111-1111-111111111111', array['administrador']
    )$$,
  '22023',
  null,
  'establecer_roles_reporte_organizacion rechaza administrador (FR-006, Acceptance Scenario 3 de US3)'
);

select public.establecer_roles_reporte_organizacion(
  (select val from t_ids where key = 'reporte1'), 'b1111111-1111-1111-1111-111111111111', array['miembro']
);

select is(
  (select count(*)::int from reportes_organizaciones_roles
     where reporte_id = (select val from t_ids where key = 'reporte1')
       and organizacion_id = 'b1111111-1111-1111-1111-111111111111'
       and rol_id = 'miembro'),
  1,
  'el administrador de X vuelve a habilitar miembro solo para su organización'
);

select is(
  (select count(*)::int from eventos_reportes
     where reporte_id = (select val from t_ids where key = 'reporte1')
       and organizacion_id = 'b1111111-1111-1111-1111-111111111111'
       and accion = 'roles_organizacion_actualizados'),
  1,
  'el cambio de visibilidad por organización quedó auditado'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from reportes where id = (select val from t_ids where key = 'reporte1')),
  1,
  'miembro de X vuelve a ver el reporte tras el ajuste de su propio administrador'
);

reset role;

-- ============================================================================
-- FR-006 con CERO roles habilitados: acceso incondicional del administrador
-- ============================================================================
-- Encontrado en quickstart.md sección 3: la primera implementación de
-- private.puede_ver_reporte() (y de las policies que la usan) chequeaba
-- reportes_organizaciones_roles directo — con esa tabla vacía para X (sin
-- ningún rol no-administrador habilitado), ni siquiera el administrador
-- encontraba una fila, porque 'administrador' nunca tiene fila propia ahí
-- (el check que la excluye). El fix se apoya en reportes_organizaciones
-- (la asignación en sí, que existe sin importar cuántos roles tenga
-- habilitados) — ver data-model.md.

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select public.establecer_roles_reporte_organizacion(
  (select val from t_ids where key = 'reporte1'), 'b1111111-1111-1111-1111-111111111111', array[]::text[]
);

select is(
  (select count(*)::int from reportes_organizaciones_roles
     where reporte_id = (select val from t_ids where key = 'reporte1')
       and organizacion_id = 'b1111111-1111-1111-1111-111111111111'),
  0,
  'establecer_roles_reporte_organizacion con array vacío deja la tabla sin ninguna fila para X'
);

select is(
  (select count(*)::int from reportes where id = (select val from t_ids where key = 'reporte1')),
  1,
  'administrador de X sigue viendo el reporte con CERO roles habilitados (FR-006, acceso incondicional real)'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from reportes where id = (select val from t_ids where key = 'reporte1')),
  0,
  'miembro de X, en cambio, no ve nada con cero roles habilitados'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select public.establecer_roles_reporte_organizacion(
  (select val from t_ids where key = 'reporte1'), 'b1111111-1111-1111-1111-111111111111', array['miembro']
);

reset role;

-- ============================================================================
-- Aislamiento de reportes_organizaciones cuando el MISMO reporte está
-- asignado a dos organizaciones (FR-007/FR-010)
-- ============================================================================
-- Bug real encontrado corriendo el quickstart (T023, fuera del guion
-- original): la policy de reportes_organizaciones usaba
-- private.puede_ver_reporte(reporte_id) — pensada para "reportes" (una
-- fila por reporte) — que solo responde "¿mi organización tiene ALGUNA
-- fila para este reporte?", sin comparar el organizacion_id de la FILA
-- evaluada contra el de quien consulta. Con el mismo reporte asignado a
-- dos organizaciones, esa función daba true para las dos filas: cualquiera
-- de las dos organizaciones veía la fila de la otra, no solo la suya — y
-- emitir-acceso-reporte (que confía en que RLS ya filtró y hace
-- `select ... limit 1` sin filtrar por organización) a veces devolvía la
-- cláusula `rls` de la organización ajena, filtrando datos de la
-- organización equivocada. El test de más arriba (con reporte1 asignado
-- solo a X) no lo detectaba porque nunca había dos filas entre las que
-- confundirse.

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select public.asignar_reporte(
  (select val from t_ids where key = 'reporte1'),
  'b2222222-2222-2222-2222-222222222222'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from reportes_organizaciones where reporte_id = (select val from t_ids where key = 'reporte1')),
  1,
  'administrador de X ve exactamente 1 fila en reportes_organizaciones (la suya) aunque el reporte esté asignado también a Y'
);

select is(
  (select organizacion_id from reportes_organizaciones where reporte_id = (select val from t_ids where key = 'reporte1')),
  'b1111111-1111-1111-1111-111111111111',
  'y esa fila es la de X, no la de Y'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from reportes_organizaciones where reporte_id = (select val from t_ids where key = 'reporte1')),
  1,
  'administrador de Y ve exactamente 1 fila en reportes_organizaciones (la suya), no la de X'
);

select is(
  (select organizacion_id from reportes_organizaciones where reporte_id = (select val from t_ids where key = 'reporte1')),
  'b2222222-2222-2222-2222-222222222222',
  'y esa fila es la de Y, no la de X'
);

reset role;

-- ============================================================================
-- resolver_organizacion_reporte respeta la organización activa del
-- superadmin (no el bug de "siempre la primera fila")
-- ============================================================================
-- Segundo bug real, distinto del anterior, encontrado por el usuario
-- probando la app: el superadmin bypassa la RLS de reportes_organizaciones
-- por completo (su policy es "is_superadmin() or ..."), así que un
-- `select ... limit 1` sobre esa tabla no respeta ninguna organización en
-- particular — devuelve la primera fila que encuentre, sin importar a
-- cuál entró el superadmin. resolver_organizacion_reporte() en cambio usa
-- private.organizacion_id(), que sí resuelve bien el caso superadmin.

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select entrar_a_organizacion('b1111111-1111-1111-1111-111111111111');

select is(
  (select public.resolver_organizacion_reporte((select val from t_ids where key = 'reporte1'))),
  'b1111111-1111-1111-1111-111111111111'::uuid,
  'con X activa, resolver_organizacion_reporte devuelve X (no una fila cualquiera)'
);

select entrar_a_organizacion('b2222222-2222-2222-2222-222222222222');

select is(
  (select public.resolver_organizacion_reporte((select val from t_ids where key = 'reporte1'))),
  'b2222222-2222-2222-2222-222222222222'::uuid,
  'tras entrar a Y, resolver_organizacion_reporte cambia a Y — el contexto activo, no la primera fila insertada'
);

-- ============================================================================
-- reportes_visibles_para_mi() no ofrece lo que después se rechaza
-- ============================================================================
-- Tercer bug real, reportado por el usuario: el dropdown de "Analítica"
-- (useReportesAsignados) hacía `select * from reportes`, que al
-- superadmin le da TODO el catálogo (is_superadmin() bypass, pensado para
-- administrar.tsx) — confuso, porque el reporte aparecía seleccionable
-- aunque no estuviera asignado a la organización activa. Esta función no
-- tiene ese bypass: mismo criterio que un administrador normal.

select entrar_a_organizacion('b3333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.reportes_visibles_para_mi()),
  0,
  'con Z activa (sin nada asignado), reportes_visibles_para_mi() no ofrece el reporte — antes el superadmin lo veía igual (bug real)'
);

select entrar_a_organizacion('b1111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.reportes_visibles_para_mi()),
  1,
  'con X activa (sí asignado), reportes_visibles_para_mi() lo vuelve a ofrecer'
);

reset role;

-- ============================================================================
-- reportes_roles_default: solo superadmin (aislamiento del default global)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from reportes_roles_default where reporte_id = (select val from t_ids where key = 'reporte1')),
  0,
  'un administrador de organización no puede leer el default global de un reporte'
);

reset role;

-- ============================================================================
-- eventos_reportes: aislamiento de la auditoría por organización
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from eventos_reportes where organizacion_id = 'b1111111-1111-1111-1111-111111111111'),
  0,
  'administrador de Y no ve eventos de auditoría de X'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select cmp_ok(
  (select count(*)::int from eventos_reportes),
  '>',
  0,
  'el superadmin ve toda la auditoría, de cualquier organización'
);

reset role;

select * from finish();

rollback;
