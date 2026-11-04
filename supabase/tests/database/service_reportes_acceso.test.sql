-- F-SVC-23 (MSF-168, épica MSF-124): acceso al reporte «Service técnico» (FR-065, SC-010).
-- `resolver_organizacion_reporte` (sin cambios) devuelve la organización del token solo si la persona tiene
-- `lectura` o `edicion` en `service_tecnico` (la sección que declara el reporte) y el reporte está asignado a
-- su organización; si no devuelve null (→ 403 sin emitir token en `emitir-acceso-reporte`). La cláusula `rls`
-- por `organizacion_id` la arma esa Edge Function y la prueba `emitir-acceso-reporte/handler.test.ts`.
-- Matriz vigente de `service_tecnico`: administrador `edicion`; operador `edicion`; consulta y administración
-- `lectura`; depósito `ninguno`.
begin;

select plan(13);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización A'),
  ('22222222-2222-2222-2222-222222222222', 'Organización B');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-a@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'consulta-a@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'deposito-a@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-b@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

-- Reporte de Service asignado a A y a B, visible por defecto para consulta y depósito.
insert into reportes (id, superset_dashboard_uuid, nombre, creado_por, seccion) values
  ('f1000000-0000-0000-0000-000000000001', 'dash-service', 'Service técnico', 'd1000000-0000-0000-0000-000000000001', 'service_tecnico');
insert into reportes_roles_default (reporte_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000001', 'consulta'),
  ('f1000000-0000-0000-0000-000000000001', 'deposito');
insert into reportes_organizaciones (reporte_id, organizacion_id, asignado_por) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'd1000000-0000-0000-0000-000000000001');

create function pg_temp.resolver(p_user uuid, p_reporte uuid) returns uuid language plpgsql as $$
declare
  v uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v := public.resolver_organizacion_reporte(p_reporte);
  reset role;
  return v;
end $$;

select is(
  pg_temp.resolver('d1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'Administrador (edición en service_tecnico): recibe la organización A');
select is(
  pg_temp.resolver('d1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'Consulta (lectura en service_tecnico): recibe la organización A');
select is(
  pg_temp.resolver('d1000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000001'),
  null::uuid, 'Depósito (sin la sección): null aunque el reporte esté asignado a su rol (403, sin token)');
select is(
  pg_temp.resolver('d2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001'),
  '22222222-2222-2222-2222-222222222222'::uuid, 'el administrador de B recibe B, nunca A (aislamiento entre organizaciones)');

-- Reporte asignado solo a B: un usuario de A no emite token.
insert into reportes (id, superset_dashboard_uuid, nombre, creado_por, seccion) values
  ('f1000000-0000-0000-0000-000000000002', 'dash-service-b', 'Service técnico B', 'd1000000-0000-0000-0000-000000000001', 'service_tecnico');
insert into reportes_organizaciones (reporte_id, organizacion_id, asignado_por) values
  ('f1000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'd1000000-0000-0000-0000-000000000001');
select is(
  pg_temp.resolver('d1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002'),
  null::uuid, 'un reporte de Service asignado solo a B no emite token a un usuario de A');
select is(
  pg_temp.resolver('d1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-0000000000ff'),
  null::uuid, 'un reporte inexistente no emite token');

-- La sección del reporte es la de Service y la firma no cambió.
select is(
  (select seccion from public.reportes where id = 'f1000000-0000-0000-0000-000000000001'),
  'service_tecnico', 'el reporte declara la sección service_tecnico');
select ok(
  not has_function_privilege('anon', 'public.resolver_organizacion_reporte(uuid)', 'EXECUTE'),
  'anon no ejecuta resolver_organizacion_reporte');
select ok(
  has_function_privilege('authenticated', 'public.resolver_organizacion_reporte(uuid)', 'EXECUTE'),
  'authenticated conserva la ejecución de resolver_organizacion_reporte (misma firma)');

-- ============================================================================
-- Asignación del reporte de Service (F-SVC-23, T044)
--
-- El reporte de Service se asigna a las organizaciones que tienen el módulo
-- `service-tecnico` habilitado (las mismas donde el menú del módulo existe) y
-- hereda los roles por defecto. Un reporte de otra sección no se asigna solo.
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('33333333-3333-3333-3333-333333333333', 'Organización C'),
  ('44444444-4444-4444-4444-444444444444', 'Organización D');

insert into features (id, nombre) values ('service-tecnico', 'Service técnico') on conflict (id) do nothing;

-- C habilita el módulo; D no.
insert into organizaciones_features (feature_id, organizacion_id, habilitado_por)
values ('service-tecnico', '33333333-3333-3333-3333-333333333333', 'd1000000-0000-0000-0000-000000000001');

-- Reporte de Service registrado DESPUÉS de que C habilitara el módulo.
insert into reportes (id, superset_dashboard_uuid, nombre, creado_por, seccion) values
  ('f1000000-0000-0000-0000-000000000003', 'dash-service-c', 'Service técnico C', 'd1000000-0000-0000-0000-000000000001', 'service_tecnico');
-- Reporte de otra sección (no es de Service): no se asigna solo.
insert into reportes (id, superset_dashboard_uuid, nombre, creado_por, seccion) values
  ('f1000000-0000-0000-0000-000000000004', 'dash-otra-seccion', 'Otro reporte', 'd1000000-0000-0000-0000-000000000001', 'ventas');

select is(
  (select count(*)::int from public.reportes_organizaciones
    where reporte_id = 'f1000000-0000-0000-0000-000000000003'
      and organizacion_id = '33333333-3333-3333-3333-333333333333'),
  1, 'la organización que habilitó el módulo recibe el reporte de Service');
select is(
  (select count(*)::int from public.reportes_organizaciones
    where reporte_id = 'f1000000-0000-0000-0000-000000000003'
      and organizacion_id = '44444444-4444-4444-4444-444444444444'),
  0, 'una organización sin el módulo no recibe el reporte de Service');
select is(
  (select count(*)::int from public.reportes_organizaciones where reporte_id = 'f1000000-0000-0000-0000-000000000004'),
  0, 'un reporte de otra sección no se asigna solo');

-- Los roles por defecto llegan a la organización asignada (la herencia congelada corre una sola vez).
insert into reportes_roles_default (reporte_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000003', 'consulta'),
  ('f1000000-0000-0000-0000-000000000003', 'administracion');
select is(
  (select count(*)::int from public.reportes_organizaciones_roles
    where reporte_id = 'f1000000-0000-0000-0000-000000000003'
      and organizacion_id = '33333333-3333-3333-3333-333333333333'),
  2, 'los roles por defecto del reporte llegan a la organización asignada');

select * from finish();
rollback;
