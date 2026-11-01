-- F-VTA-31 (MSF-329, épica MSF-193): buscar_producto_por_codigo_barras (FR-001, SC-001).
-- Cubre: resolución solo en la organización, producto inactivo, código inexistente (sin filas),
-- formato no EAN-13, rol sin `ventas` en edición y `anon` sin ejecución.
begin;

select plan(9);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, codigo_barras, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick inalámbrico', 'JOY-100', 10, '7790001000011', true),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable HDMI', 'CAB-200', 10, '7790001000028', false),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Joystick de otra org', 'JOY-900', 10, '7790009000019', true);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select results_eq($$select producto_id, nombre from public.buscar_producto_por_codigo_barras('7790001000011')$$,
  $$values ('a1000000-0000-0000-0000-000000000001'::uuid, 'Joystick inalámbrico'::text)$$,
  'resuelve el producto por su EAN-13');
select is((select count(*)::int from public.buscar_producto_por_codigo_barras('7790009000019')), 0,
  'el código de otra organización no se resuelve');
select is((select count(*)::int from public.buscar_producto_por_codigo_barras('7790001000028')), 0,
  'un producto inactivo no se resuelve');
select is((select count(*)::int from public.buscar_producto_por_codigo_barras('7790000000000')), 0,
  'un código inexistente devuelve sin filas');
select throws_ok($$select * from public.buscar_producto_por_codigo_barras('12345')$$, '22023', null,
  'un código que no es EAN-13 se rechaza');
select throws_ok($$select * from public.buscar_producto_por_codigo_barras(null)$$, '22023', null,
  'un código nulo se rechaza');

-- Otra organización: solo ve los suyos.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select results_eq($$select sku from public.buscar_producto_por_codigo_barras('7790009000019')$$,
  $$values ('JOY-900'::text)$$, 'cada organización resuelve solo sus productos');

-- Rol sin ventas en edición: la base lo rechaza.
reset role;
update permisos_rol set nivel = 'lectura'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta' and seccion = 'ventas';
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok($$select * from public.buscar_producto_por_codigo_barras('7790001000011')$$, '42501', null,
  'sin ventas en edición no accede');

-- anon sin ejecución
reset role;
select ok(
  not has_function_privilege('anon', 'public.buscar_producto_por_codigo_barras(text)', 'execute')
  and has_function_privilege('authenticated', 'public.buscar_producto_por_codigo_barras(text)', 'execute'),
  '«anon» no ejecuta buscar_producto_por_codigo_barras; «authenticated» sí');

select * from finish();
rollback;
