-- F-REN-01 (MSF-204, épica MSF-120): aislamiento entre organizaciones y token por sección.
-- Cubre FR-007 / SC-003: la vista expone `organizacion_id` en cada fila (el guest token filtra por
-- ahí), y `resolver_organizacion_reporte` —que decide la organización del token— devuelve solo la de
-- quien llama y null (→ 403 en la Edge Function, ver handler.test.ts) cuando el rol no tiene la
-- sección del reporte. Sin sección el comportamiento de la spec 007 no cambia.
begin;

select plan(18);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización A'),
  ('22222222-2222-2222-2222-222222222222', 'Organización B');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-a@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'administracion-a@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'operador-a@example.com'),
  ('d1000000-0000-0000-0000-000000000004', 'consulta-a@example.com'),
  ('d1000000-0000-0000-0000-000000000005', 'mostrador-a@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-b@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'mostrador'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda B');

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Producto de A', 'A-1', 'ARS', 10000),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto de B', 'B-1', 'ARS', 20000);

insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 6000),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 8000);

-- R1: reporte de Rentabilidad (exige la sección) asignado a A y a B, con visibilidad por rol para
-- Administración, Operador y Consulta. R2: reporte sin sección (spec 007) solo para Operador en A.
-- R3: reporte de Rentabilidad asignado únicamente a B.
insert into reportes (id, superset_dashboard_uuid, nombre, creado_por, seccion) values
  ('f1000000-0000-0000-0000-000000000001', 'dash-rentabilidad', 'Rentabilidad', 'd1000000-0000-0000-0000-000000000001', 'rentabilidad'),
  ('f1000000-0000-0000-0000-000000000002', 'dash-general', 'General', 'd1000000-0000-0000-0000-000000000001', null),
  ('f1000000-0000-0000-0000-000000000003', 'dash-rentabilidad-b', 'Rentabilidad B', 'd1000000-0000-0000-0000-000000000001', 'rentabilidad');

insert into reportes_roles_default (reporte_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000001', 'administracion'),
  ('f1000000-0000-0000-0000-000000000001', 'operador'),
  ('f1000000-0000-0000-0000-000000000001', 'consulta'),
  ('f1000000-0000-0000-0000-000000000002', 'operador'),
  ('f1000000-0000-0000-0000-000000000003', 'administracion');

insert into reportes_organizaciones (reporte_id, organizacion_id, asignado_por) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'd1000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'd1000000-0000-0000-0000-000000000001');

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

-- ============================================================================
-- La vista expone organizacion_id y no mezcla organizaciones
-- ============================================================================

select is(
  (select count(*)::int from analitica.margen_producto_canal where organizacion_id is null),
  0, 'toda fila de la vista lleva organizacion_id (lo usa la cláusula rls del token)'
);
select is(
  (select array_agg(distinct organizacion_id) from analitica.margen_producto_canal where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  array['11111111-1111-1111-1111-111111111111']::uuid[], 'el producto de A solo aparece con la organización A'
);
select is(
  (select array_agg(distinct organizacion_id) from analitica.margen_producto_canal where producto_id = 'a2000000-0000-0000-0000-000000000001'),
  array['22222222-2222-2222-2222-222222222222']::uuid[], 'el producto de B solo aparece con la organización B'
);
select is(
  (select count(*)::int from analitica.margen_producto_canal
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and producto_id = 'a2000000-0000-0000-0000-000000000001'),
  0, 'filtrando como el token de A, ninguna fila de B aparece'
);
select is(
  (select count(*)::int from analitica.margen_producto_canal
    where organizacion_id = '22222222-2222-2222-2222-222222222222' and producto_id = 'a1000000-0000-0000-0000-000000000001'),
  0, 'filtrando como el token de B, ninguna fila de A aparece'
);

-- ============================================================================
-- Token por sección (FR-007): la organización que usa el token
-- ============================================================================

select has_column('public', 'reportes', 'seccion', 'reportes tiene la columna seccion');

select is(
  pg_temp.resolver('d1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'Administrador de A: el token lleva A'
);
select is(
  pg_temp.resolver('d2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001'),
  '22222222-2222-2222-2222-222222222222'::uuid, 'Administrador de B con el mismo reporte: el token lleva B, nunca A'
);
select is(
  pg_temp.resolver('d1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'Administración (lectura en rentabilidad) recibe token de su organización'
);
select is(
  pg_temp.resolver('d1000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000001'),
  null::uuid, 'Operador: aunque el reporte le esté asignado por rol, sin la sección no hay token (403)'
);
select is(
  pg_temp.resolver('d1000000-0000-0000-0000-000000000004', 'f1000000-0000-0000-0000-000000000001'),
  null::uuid, 'Consulta: sin la sección no hay token (403)'
);
select is(
  pg_temp.resolver('d1000000-0000-0000-0000-000000000005', 'f1000000-0000-0000-0000-000000000001'),
  null::uuid, 'Mostrador: sin la sección ni el reporte asignado, no hay token (403)'
);
select is(
  pg_temp.resolver('d1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000003'),
  null::uuid, 'un reporte asignado solo a B no emite token a un usuario de A'
);
select is(
  pg_temp.resolver('d1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-0000000000ff'),
  null::uuid, 'un reporte inexistente no emite token (y no revela que no existe)'
);

-- Sin sección declarada, la regla de la spec 007 sigue igual.
select is(
  pg_temp.resolver('d1000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000002'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'reporte sin seccion: el Operador asignado por rol sigue recibiendo token (spec 007)'
);
select is(
  pg_temp.resolver('d1000000-0000-0000-0000-000000000004', 'f1000000-0000-0000-0000-000000000002'),
  null::uuid, 'reporte sin seccion: quien no está asignado por rol sigue sin token (spec 007)'
);

select ok(
  not has_function_privilege('anon', 'public.resolver_organizacion_reporte(uuid)', 'EXECUTE'),
  'anon no ejecuta resolver_organizacion_reporte'
);
select ok(
  has_function_privilege('authenticated', 'public.resolver_organizacion_reporte(uuid)', 'EXECUTE'),
  'authenticated conserva la ejecución de resolver_organizacion_reporte (misma firma)'
);

select * from finish();
rollback;
