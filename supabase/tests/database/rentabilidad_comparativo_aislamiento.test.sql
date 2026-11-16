-- F-REN-06 (MSF-261, épica MSF-127): aislamiento del tablero «Comparativo» entre organizaciones.
-- Cubre SC-002: la vista `analitica.margen_comparativo_producto` expone `organizacion_id` en cada fila (el
-- guest token filtra por ahí) y no mezcla organizaciones; `resolver_organizacion_reporte` —que decide la
-- organización del token— devuelve solo la de quien llama y null (→ 403 en la Edge Function) cuando el rol no
-- tiene la sección `rentabilidad`, aunque el reporte le esté asignado por rol. El rol de Superset solo lee.
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
  ('d1000000-0000-0000-0000-000000000005', 'mostrador-a@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-b@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'mostrador'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

-- Cada organización tiene dos tiendas (la segunda con −10 %), así su producto es comparable.
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A1'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda A2'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda B1'),
  ('e2000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Tienda B2');

insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct) values
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'central_ajuste', -10),
  ('e2000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'central_ajuste', -10);

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Producto de A', 'A-1', 'ARS', 10000),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto de B', 'B-1', 'ARS', 20000);

insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 6000),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 8000);

-- C1: «Comparativo» (exige la sección) asignado a A y a B, visible por rol para Administración, Operador y
-- Consulta. C2: otro tablero de Rentabilidad asignado únicamente a B.
insert into reportes (id, superset_dashboard_uuid, nombre, creado_por, seccion) values
  ('f1000000-0000-0000-0000-0000000000c1', 'dash-comparativo', 'Rentabilidad · Comparativo', 'd1000000-0000-0000-0000-000000000001', 'rentabilidad'),
  ('f1000000-0000-0000-0000-0000000000c2', 'dash-comparativo-b', 'Comparativo B', 'd1000000-0000-0000-0000-000000000001', 'rentabilidad');

insert into reportes_roles_default (reporte_id, rol_id) values
  ('f1000000-0000-0000-0000-0000000000c1', 'administracion'),
  ('f1000000-0000-0000-0000-0000000000c1', 'operador'),
  ('f1000000-0000-0000-0000-0000000000c1', 'consulta'),
  ('f1000000-0000-0000-0000-0000000000c2', 'administracion');

insert into reportes_organizaciones (reporte_id, organizacion_id, asignado_por) values
  ('f1000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-0000-0000-0000000000c1', '22222222-2222-2222-2222-222222222222', 'd1000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-0000-0000-0000000000c2', '22222222-2222-2222-2222-222222222222', 'd1000000-0000-0000-0000-000000000001');

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
  (select count(*)::int from analitica.margen_comparativo_producto
    where organizacion_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')),
  4, 'cada organización aporta su producto comparable en dos empresas (4 filas en total)'
);
select is(
  (select count(*)::int from analitica.margen_comparativo_producto where organizacion_id is null),
  0, 'toda fila de la vista lleva organizacion_id (lo usa la cláusula rls del token)'
);
select is(
  (select array_agg(distinct organizacion_id) from analitica.margen_comparativo_producto where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  array['11111111-1111-1111-1111-111111111111']::uuid[], 'el producto de A solo aparece con la organización A'
);
select is(
  (select array_agg(distinct organizacion_id) from analitica.margen_comparativo_producto where producto_id = 'a2000000-0000-0000-0000-000000000001'),
  array['22222222-2222-2222-2222-222222222222']::uuid[], 'el producto de B solo aparece con la organización B'
);
select is(
  (select count(*)::int from analitica.margen_comparativo_producto
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and producto_id = 'a2000000-0000-0000-0000-000000000001'),
  0, 'filtrando como el token de A, ninguna fila de B aparece'
);
select is(
  (select count(*)::int from analitica.margen_comparativo_producto
    where organizacion_id = '22222222-2222-2222-2222-222222222222' and producto_id = 'a1000000-0000-0000-0000-000000000001'),
  0, 'filtrando como el token de B, ninguna fila de A aparece'
);
select is(
  (select array_agg(distinct empresa_nombre order by empresa_nombre) from analitica.margen_comparativo_producto
    where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  array['Tienda A1', 'Tienda A2'], 'las empresas del comparativo de A son solo las de A (mejor/peor incluidas)'
);
select ok(
  not exists (
    select 1 from analitica.margen_comparativo_producto
    where organizacion_id = '11111111-1111-1111-1111-111111111111'
      and (empresa_mejor like '%B%' or empresa_peor like '%B%')
  ), 'mejor y peor empresa de A nunca nombran una empresa de B'
);

-- ============================================================================
-- Token por sección (FR-007 de MSF-120, reutilizado): la organización que usa el token
-- ============================================================================

select is(
  pg_temp.resolver('d1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-0000000000c1'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'Administrador de A: el token del Comparativo lleva A'
);
select is(
  pg_temp.resolver('d2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-0000000000c1'),
  '22222222-2222-2222-2222-222222222222'::uuid, 'Administrador de B con el mismo tablero: el token lleva B, nunca A'
);
select is(
  pg_temp.resolver('d1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-0000000000c1'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'Administración (lectura en rentabilidad) recibe token de su organización'
);
select is(
  pg_temp.resolver('d1000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-0000000000c1'),
  null::uuid, 'Operador: aunque el tablero le esté asignado por rol, sin la sección no hay token (403)'
);
select is(
  pg_temp.resolver('d1000000-0000-0000-0000-000000000004', 'f1000000-0000-0000-0000-0000000000c1'),
  null::uuid, 'Consulta: sin la sección no hay token (403)'
);
select is(
  pg_temp.resolver('d1000000-0000-0000-0000-000000000005', 'f1000000-0000-0000-0000-0000000000c1'),
  null::uuid, 'Mostrador: sin la sección ni el tablero asignado, no hay token (403)'
);
select is(
  pg_temp.resolver('d1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-0000000000c2'),
  null::uuid, 'un Comparativo asignado solo a B no emite token a un usuario de A'
);

-- ============================================================================
-- Acceso a la vista: solo el rol de Superset
-- ============================================================================

select ok(
  not has_table_privilege('anon', 'analitica.margen_comparativo_producto', 'SELECT')
    and not has_table_privilege('authenticated', 'analitica.margen_comparativo_producto', 'SELECT')
    and has_table_privilege('superset_analitica', 'analitica.margen_comparativo_producto', 'SELECT'),
  'anon y authenticated no leen la vista; el rol de Superset sí'
);

select * from finish();
rollback;
