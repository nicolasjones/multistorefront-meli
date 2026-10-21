-- F-CAT-01 (MSF-252) · SC-002: `public.v_productos_listado` aísla por organización, `anon` no accede,
-- no expone costo, y los comodines de la búsqueda se tratan como texto (el escape vive en la app,
-- acá se comprueba que `ilike ... escape` los respeta sobre la vista).
begin;

select plan(12);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 10),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '100% algodón', 'ALG_1', 10),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 10),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Teclado de otra org', 'TEC-1', 10);

insert into dominio.producto_imagenes (producto_id, organizacion_id, posicion, ruta) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 2,
   '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/segunda.png'),
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 1,
   '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/frente.png');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select is(has_table_privilege('anon', 'public.v_productos_listado', 'SELECT'), false, 'anon no lee la vista');
select is(has_table_privilege('authenticated', 'public.v_productos_listado', 'SELECT'), true, 'authenticated lee la vista');
select is(
  (select reloptions::text from pg_class where oid = 'public.v_productos_listado'::regclass),
  '{security_invoker=true}', 'la vista es security_invoker'
);
select is(
  (select array_agg(attname::text order by attnum) from pg_attribute
    where attrelid = 'public.v_productos_listado'::regclass and attnum > 0 and not attisdropped),
  array['id', 'organizacion_id', 'nombre', 'sku', 'activo', 'imagen_ruta', 'updated_at'],
  'la vista no expone costo ni precio y sus columnas son el contrato'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.v_productos_listado), 3, 'la organización Uno ve solo sus 3 productos');
select is(
  (select count(*)::int from public.v_productos_listado where nombre = 'Teclado de otra org'),
  0, 'no ve productos de otra organización'
);
select is(
  (select imagen_ruta from public.v_productos_listado where sku = 'JOY-1'),
  '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/frente.png',
  'la imagen principal es la de menor posición'
);
select is(
  (select imagen_ruta from public.v_productos_listado where sku = 'CAB-1'), null, 'sin imágenes la ruta es nula'
);
select is(
  (select count(*)::int from public.v_productos_listado where lower(nombre) like '%\%%' escape '\'),
  1, 'el comodín % escapado busca el símbolo, no todo'
);
select is(
  (select count(*)::int from public.v_productos_listado where lower(sku) like '%alg\_1%' escape '\'),
  1, 'el comodín _ escapado busca el símbolo'
);
reset role;

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.v_productos_listado), 1, 'la organización Dos ve solo su producto');
reset role;

select set_config('request.jwt.claims', null, true);
set local role anon;
select throws_ok(
  $$select count(*) from public.v_productos_listado$$, '42501', null, 'anon recibe permiso denegado'
);
reset role;

select * from finish();
rollback;
