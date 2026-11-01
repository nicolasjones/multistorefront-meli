-- F-INI-03 (MSF-374, épica MSF-156): búsqueda global de productos (FR-031, FR-034, SC-002).
-- Cubre nombre y SKU, tildes y mayúsculas, error leve de tipeo, mínimo 2 caracteres, tope,
-- aislamiento por organización y por nivel de sección, y `anon` sin ejecución.
begin;

select plan(14);

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

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick inalámbrico', 'JOY-100', 10),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable HDMI', 'CAB-200', 10),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Cable USB', 'CAB-300', 10),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Joystick de otra org', 'JOY-900', 10);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select results_eq($$select nombre from public.buscar_productos_global('joystick')$$,
  $$values ('Joystick inalámbrico'::text)$$, 'busca por nombre y solo en su organización');
select results_eq($$select nombre from public.buscar_productos_global('INALAMBRICO')$$,
  $$values ('Joystick inalámbrico'::text)$$, 'tolera mayúsculas y tildes');
select results_eq($$select producto_id from public.buscar_productos_global('cab-200')$$,
  $$values ('a1000000-0000-0000-0000-000000000002'::uuid)$$, 'busca por SKU');
select results_eq($$select sku from public.buscar_productos_global('joy-100')$$,
  $$values ('JOY-100'::text)$$, 'devuelve producto_id, nombre y sku');
select results_eq($$select nombre from public.buscar_productos_global('joistick')$$,
  $$values ('Joystick inalámbrico'::text)$$, 'tolera un error leve de tipeo');
select is((select count(*)::int from public.buscar_productos_global('cable')), 2, 'varios resultados');
select is((select count(*)::int from public.buscar_productos_global('cable', 1)), 1, 'respeta el tope pedido');
select throws_ok($$select * from public.buscar_productos_global('j')$$, '22023', null, 'menos de 2 caracteres se rechaza');
select throws_ok($$select * from public.buscar_productos_global('   ')$$, '22023', null, 'solo espacios se rechaza');
select is((select count(*)::int from public.buscar_productos_global('zzzzzzzz')), 0, 'sin coincidencias no hay filas');
select is((select count(*)::int from public.buscar_productos_global('%%')), 0, '«%» se busca literal');

-- Otra organización: no ve los de la primera.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select results_eq($$select sku from public.buscar_productos_global('joystick')$$,
  $$values ('JOY-900'::text)$$, 'cada organización busca solo en los suyos');

-- Rol sin productos≥lectura: la base no devuelve nada.
reset role;
update permisos_rol set nivel = 'ninguno'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta' and seccion = 'productos';
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.buscar_productos_global('joystick')), 0,
  'rol sin lectura de productos: 0 resultados');

-- anon sin ejecución
reset role;
select ok(
  not has_function_privilege('anon', 'public.buscar_productos_global(text,integer)', 'execute')
  and has_function_privilege('authenticated', 'public.buscar_productos_global(text,integer)', 'execute'),
  '«anon» no ejecuta buscar_productos_global; «authenticated» sí');

select * from finish();
rollback;
