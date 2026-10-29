-- F-REN-07 (MSF-280, épica MSF-127): aislamiento y secreto de costos de la historia.
-- Cubre FR-007, FR-008 / SC-005: la vista `analitica.margen_historico_producto_canal` expone
-- `organizacion_id` y no mezcla organizaciones; `dominio.producto_costos_historial` solo la lee quien tiene
-- `rentabilidad` en su propia organización (Operador, Consulta, Mostrador y `anon` no); el token del tablero
-- «Historia» (`resolver_organizacion_reporte`) devuelve solo la organización de quien llama y null (→ 403)
-- sin la sección; Actividad no lleva importes del costo; nadie de la API escribe la historia.
begin;

select plan(16);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización A'),
  ('22222222-2222-2222-2222-222222222222', 'Organización B');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-a@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'administracion-a@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'operador-a@example.com'),
  ('d1000000-0000-0000-0000-000000000004', 'consulta-a@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-b@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A1'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda B1');

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, updated_at) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Producto de A', 'A-1', 'ARS', 10000, '2026-01-01 10:00:00+00'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto de B', 'B-1', 'ARS', 20000, '2026-01-01 10:00:00+00');

insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 6000),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 8000);

insert into dominio.cotizaciones (organizacion_id, valor, cargada_por_nombre, cargada_en) values
  ('11111111-1111-1111-1111-111111111111', 1000, 'Test', now() + interval '1 day'),
  ('22222222-2222-2222-2222-222222222222', 2000, 'Test', now() + interval '1 day');

insert into reportes (id, superset_dashboard_uuid, nombre, creado_por, seccion) values
  ('f1000000-0000-0000-0000-0000000000c1', 'dash-historia', 'Rentabilidad · Historia', 'd1000000-0000-0000-0000-000000000001', 'rentabilidad');
insert into reportes_roles_default (reporte_id, rol_id) values
  ('f1000000-0000-0000-0000-0000000000c1', 'administracion'),
  ('f1000000-0000-0000-0000-0000000000c1', 'operador'),
  ('f1000000-0000-0000-0000-0000000000c1', 'consulta');
insert into reportes_organizaciones (reporte_id, organizacion_id, asignado_por) values
  ('f1000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-0000-0000-0000000000c1', '22222222-2222-2222-2222-222222222222', 'd1000000-0000-0000-0000-000000000001');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

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
-- La vista expone organizacion_id y no mezcla organizaciones (SC-005)
-- ============================================================================

select is(
  (select count(*)::int from analitica.margen_historico_producto_canal where organizacion_id is null),
  0, 'toda fila de la historia lleva organizacion_id (lo usa la cláusula rls del token)'
);
select is(
  (select array_agg(distinct organizacion_id) from analitica.margen_historico_producto_canal where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  array['11111111-1111-1111-1111-111111111111']::uuid[], 'el producto de A solo aparece con la organización A'
);
select is(
  (select count(*)::int from analitica.margen_historico_producto_canal
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and (producto_id = 'a2000000-0000-0000-0000-000000000001' or empresa_nombre = 'Tienda B1')),
  0, 'filtrando como el token de A, ningún producto, empresa ni cotización de B aparece'
);
select is(
  (select array_agg(distinct cotizacion) from analitica.margen_historico_producto_canal where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  array[2000]::numeric[], 'B convierte solo con sus cotizaciones'
);

-- ============================================================================
-- Secreto de costos (FR-008): la tabla solo la lee quien tiene rentabilidad en su organización
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  (select array_agg(distinct organizacion_id) from dominio.producto_costos_historial),
  array['11111111-1111-1111-1111-111111111111']::uuid[], 'Administrador de A: ve la historia de su organización y nunca la de B'
);
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select cmp_ok((select count(*)::int from dominio.producto_costos_historial), '>', 0, 'Administración (lectura en rentabilidad): ve la historia de su organización');
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from dominio.producto_costos_historial), 0, 'Operador: sin la sección, la historia de costos no devuelve ninguna fila');
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000004');
select is((select count(*)::int from dominio.producto_costos_historial), 0, 'Consulta: sin la sección, la historia de costos no devuelve ninguna fila');
reset role;

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(
  (select array_agg(distinct organizacion_id) from dominio.producto_costos_historial),
  array['22222222-2222-2222-2222-222222222222']::uuid[], 'Administrador de B: solo ve la historia de B'
);
reset role;

set local role anon;
select throws_ok($$select 1 from dominio.producto_costos_historial$$, '42501', null, 'anon: permiso denegado sobre la historia');
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$insert into dominio.producto_costos_historial (organizacion_id, producto_id, costo)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 1)$$,
  '42501', null, 'ni el Administrador escribe la historia desde la API (solo el disparador)'
);
select throws_ok(
  $$select 1 from analitica.margen_historico_producto_canal$$,
  '42501', null, 'authenticated no lee el margen histórico (solo el rol de Superset)'
);
reset role;

-- Actividad no lleva importes del costo (FR-008): el cambio de costo se registra sin números.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.actualizar_producto(id, updated_at, nombre, descripcion, sku, compatible_con, moneda, precio_lista, 7777)
      from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'$$,
  'el Administrador cambia el costo'
);
reset role;
select is(
  (select count(*)::int from public.registro_actividad
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and (detalle like '%7777%' or detalle like '%6000%')),
  0, 'FR-008: Actividad no expone importes de costo'
);

-- ============================================================================
-- Token por sección: la organización que usa el token del tablero «Historia»
-- ============================================================================

select is(
  pg_temp.resolver('d1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-0000000000c1'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'Administrador de A: el token de Historia lleva A'
);
select is(
  pg_temp.resolver('d1000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-0000000000c1'),
  null::uuid, 'Operador: aunque el tablero le esté asignado por rol, sin la sección no hay token (403)'
);

select * from finish();
rollback;
