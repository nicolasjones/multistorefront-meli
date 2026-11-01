-- F-REN-08 (MSF-209, épica MSF-192): aislamiento de los costos adicionales entre organizaciones.
-- Cubre FR-002 / SC-002: dos organizaciones con costos propios; cada una lista, edita y da de baja solo
-- lo suyo; el margen de B nunca incluye los costos de A; Administración solo lee; los roles sin la
-- sección `rentabilidad` (Operador, Consulta) no ven nada.
begin;

select plan(13);

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
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda B');

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Producto de A', 'A-1', 'ARS', 10000),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto de B', 'B-1', 'ARS', 10000);
insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 6000),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 6000);

create temporary table t_ids (clave text primary key, id uuid);
grant all on t_ids to authenticated;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- A carga un costo del 10 %.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.guardar_costo_adicional(null, 'e1000000-0000-0000-0000-000000000001', 'Impuestos A', 'porcentaje', 10)$$,
  'el administrador de A carga un costo'
);
reset role;
insert into t_ids select 'costo_a', id from dominio.costos_adicionales_canal where nombre = 'Impuestos A';

-- B carga otro, de $ 50 por unidad.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.guardar_costo_adicional(null, 'e2000000-0000-0000-0000-000000000001', 'Envío B', 'monto', 50)$$,
  'el administrador de B carga su costo'
);
select is((select count(*)::int from public.listar_costos_adicionales(null)), 1, 'B lista solo lo suyo');
select is((select nombre from public.listar_costos_adicionales(null)), 'Envío B', 'y es el costo de B');
select is((select count(*)::int from dominio.costos_adicionales_canal), 1, 'RLS: B solo lee sus filas');
select throws_ok(
  $$select public.guardar_costo_adicional(null, 'e1000000-0000-0000-0000-000000000001', 'Colado', 'monto', 1)$$,
  '42501', null, 'B no puede cargar costos en una empresa de A'
);
select throws_ok(
  $$select public.dar_baja_costo_adicional((select id from t_ids where clave = 'costo_a'))$$,
  'P0002', null, 'B no puede dar de baja un costo de A'
);
reset role;

select is(
  (select margen from analitica.margen_producto_canal where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  3000.00, 'margen de A: 10.000 − 6.000 − 10 % (solo sus costos)'
);
select is(
  (select margen from analitica.margen_producto_canal where producto_id = 'a2000000-0000-0000-0000-000000000001'),
  3950.00, 'margen de B: 10.000 − 6.000 − $ 50 (sin los costos de A)'
);

-- A: Administración solo lee; Operador y Consulta sin acceso.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.listar_costos_adicionales(null)), 1, 'Administración de A lista solo lo de A');
select throws_ok(
  $$select public.dar_baja_costo_adicional((select id from dominio.costos_adicionales_canal limit 1))$$,
  '42501', null, 'Administración no da de baja'
);
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok($$select public.listar_costos_adicionales(null)$$, '42501', null, 'Operador sin acceso');
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000004');
select throws_ok($$select public.listar_costos_adicionales(null)$$, '42501', null, 'Consulta sin acceso');
reset role;

select * from finish();
rollback;
