-- F-REP-01 (MSF-297, épica MSF-140): acceso a los reportes de inventario (FR-004, SC-002).
-- `resolver_organizacion_reporte` con `reportes.seccion = 'stock'` devuelve la organización solo con
-- `lectura`/`edicion` en `stock` (sin ella: null → 403 en `emitir-acceso-reporte`); `anon` y
-- `authenticated` no leen la vista de analitica; el rol de Superset solo la lee.
begin;

select plan(10);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'sin-stock@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'administracion');

insert into reportes (id, superset_dashboard_uuid, nombre, creado_por, seccion) values
  ('f0000000-0000-0000-0000-000000000001', 'dash-inventario-stock', 'Inventario · Productos y stock', 'd1000000-0000-0000-0000-000000000001', 'stock');
insert into reportes_roles_default (reporte_id, rol_id) values
  ('f0000000-0000-0000-0000-000000000001', 'administracion');
insert into reportes_organizaciones (reporte_id, organizacion_id, asignado_por) values
  ('f0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000001');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Resolución de acceso por la sección `stock`
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  public.resolver_organizacion_reporte('f0000000-0000-0000-0000-000000000001'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'el administrador accede al reporte de stock'
);
reset role;

-- Lectura → acceso; edición → acceso; ninguno → null.
insert into public.permisos_rol (organizacion_id, rol_id, seccion, nivel)
  values ('11111111-1111-1111-1111-111111111111', 'administracion', 'stock', 'lectura')
  on conflict (organizacion_id, rol_id, seccion) do update set nivel = excluded.nivel;

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(
  public.resolver_organizacion_reporte('f0000000-0000-0000-0000-000000000001'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'con lectura en stock accede'
);
reset role;

update public.permisos_rol set nivel = 'edicion'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'administracion' and seccion = 'stock';
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(
  public.resolver_organizacion_reporte('f0000000-0000-0000-0000-000000000001'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'con edición en stock accede'
);
reset role;

update public.permisos_rol set nivel = 'ninguno'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'administracion' and seccion = 'stock';
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(
  public.resolver_organizacion_reporte('f0000000-0000-0000-0000-000000000001'),
  null::uuid, 'sin acceso a stock: null (emitir-acceso-reporte responde 403)'
);
reset role;


-- ============================================================================
-- Superficie: la vista no es legible por anon ni authenticated
-- ============================================================================

select ok(not has_table_privilege('anon', 'analitica.inventario_productos_stock', 'SELECT'), 'anon no lee la vista');
select ok(not has_table_privilege('authenticated', 'analitica.inventario_productos_stock', 'SELECT'), 'authenticated no lee la vista');
select ok(has_table_privilege('superset_analitica', 'analitica.inventario_productos_stock', 'SELECT'), 'el rol de Superset lee la vista');
select ok(
  not has_table_privilege('superset_analitica', 'analitica.inventario_productos_stock', 'INSERT,UPDATE,DELETE,TRUNCATE'),
  'el rol de Superset no escribe'
);
select ok(not has_schema_privilege('authenticated', 'analitica', 'USAGE'), 'authenticated sin USAGE sobre analitica');

select * from finish();
rollback;
