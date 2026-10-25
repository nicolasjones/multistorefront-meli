-- F-CAT-16 (MSF-321) · SC-002, FR-001/FR-002: el costo solo lo lee quien tiene Rentabilidad. El Operador obtiene
-- 0 filas de `dominio.producto_costos`, `public.v_productos_listado` no contiene costo, `anon` no accede y el
-- costo de una organización no se ve desde otra.
begin;

select plan(11);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 49.90),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 10),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Teclado de otra org', 'TEC-1', 30);
insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 20),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 4.5),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 12);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- La vista del listado no expone costo ni margen (el costo se lee aparte, con RLS de Rentabilidad).
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'v_productos_listado' and column_name ~* 'costo|margen'),
  0, 'v_productos_listado no contiene costo ni margen');
select is(has_table_privilege('anon', 'dominio.producto_costos', 'SELECT'), false, 'anon no lee producto_costos');
select is(has_table_privilege('anon', 'public.v_productos_listado', 'SELECT'), false, 'anon no lee la vista');

-- Administrador: lee el costo de los productos de su organización, por los ids de la página.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  (select jsonb_object_agg(producto_id::text, costo) from dominio.producto_costos
    where producto_id in ('a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002')),
  '{"a1000000-0000-0000-0000-000000000001": 20.00, "a1000000-0000-0000-0000-000000000002": 4.50}'::jsonb,
  'administrador: lee el costo de la página');
select is((select count(*)::int from dominio.producto_costos), 2, 'administrador: no ve el costo de otra organización');
select is(
  (select count(*)::int from dominio.producto_costos where producto_id = 'a2000000-0000-0000-0000-000000000001'),
  0, 'administrador: pedir el id de otra organización devuelve 0 filas');
select is((select count(*)::int from public.v_productos_listado), 2, 'administrador: la vista lista sus productos');
reset role;

-- Operador: ve los productos pero ninguna fila de costo, ni pidiendo los ids.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.v_productos_listado), 2, 'operador: ve los productos en el listado');
select is((select count(*)::int from dominio.producto_costos), 0, 'operador: 0 filas de producto_costos');
select is(
  (select count(*)::int from dominio.producto_costos
    where producto_id in ('a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002')),
  0, 'operador: pedir los ids de la página tampoco devuelve costo');
reset role;

-- Otra organización: no ve el costo de la organización Uno.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from dominio.producto_costos where producto_id <> 'a2000000-0000-0000-0000-000000000001'),
  0, 'administrador de otra organización: no ve costos ajenos');

select * from finish();
rollback;
