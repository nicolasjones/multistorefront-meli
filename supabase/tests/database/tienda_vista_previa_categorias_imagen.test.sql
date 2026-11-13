-- MSF-846 (parte A): public.vista_previa_tienda devuelve `imagen` en cada categoría con la misma lógica que
-- publico.categorias_por_dominio: ruta de la imagen principal de un producto efectivo de la categoría o de sus
-- subcategorías (primero por nombre e id), null si ninguno la tiene; un producto inactivo no aporta su foto.
begin;

select plan(7);

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into auth.users (id, email) values ('d1000000-0000-0000-0000-000000000001', 'admin-vp@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'vp-img.ejemplo.com');

insert into dominio.categorias (id, organizacion_id, nombre, posicion, padre_id) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Consolas', 1, null),
  ('ca000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Portátiles', 2, 'ca000000-0000-0000-0000-000000000001'),
  ('ca000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Sin fotos', 3, null),
  ('ca000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Solo inactivo', 4, null);

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo, categoria_id) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Portátil Uno', 'VP-1', 10, 'ARS', true, 'ca000000-0000-0000-0000-000000000002'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Sin foto', 'VP-2', 10, 'ARS', true, 'ca000000-0000-0000-0000-000000000003'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Inactivo con foto', 'VP-3', 10, 'ARS', false, 'ca000000-0000-0000-0000-000000000004');
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, 'e1000000-0000-0000-0000-000000000001', p.organizacion_id from dominio.productos p
 where p.organizacion_id = '11111111-1111-1111-1111-111111111111';
insert into dominio.producto_imagenes (producto_id, organizacion_id, posicion, ruta) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 2, '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/segunda.png'),
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 1, '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/primera.png'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 1, '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000003/inactivo.png');

create function pg_temp.imagen_cat(p_id uuid) returns text language sql as $$
  select c ->> 'imagen' from jsonb_array_elements(public.vista_previa_tienda('e1000000-0000-0000-0000-000000000001') -> 'categorias') c
   where c ->> 'id' = p_id::text;
$$;

select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(pg_temp.imagen_cat('ca000000-0000-0000-0000-000000000002'), '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/primera.png', 'la subcategoría usa la imagen principal (menor posición) de su producto');
select is(pg_temp.imagen_cat('ca000000-0000-0000-0000-000000000001'), '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/primera.png', 'la categoría madre hereda la foto de sus subcategorías');
select is(pg_temp.imagen_cat('ca000000-0000-0000-0000-000000000003'), null, 'sin fotos: imagen null');
select is(pg_temp.imagen_cat('ca000000-0000-0000-0000-000000000004'), null, 'un producto inactivo no aporta su foto');
select is(
  (select array_agg(k order by k) from (select distinct jsonb_object_keys(c) k from jsonb_array_elements(public.vista_previa_tienda('e1000000-0000-0000-0000-000000000001') -> 'categorias') c) s),
  array['id', 'imagen', 'nombre', 'padre_id', 'productos'], 'cada categoría expone solo la lista blanca más imagen'
);
select is(
  (select c ->> 'productos' from jsonb_array_elements(public.vista_previa_tienda('e1000000-0000-0000-0000-000000000001') -> 'categorias') c where c ->> 'id' = 'ca000000-0000-0000-0000-000000000002'),
  '1', 'el conteo de la vista previa no cambia'
);

reset role;
select is(has_function_privilege('anon', 'public.vista_previa_tienda(uuid)', 'execute'), false, 'anon sigue sin ejecutar vista_previa_tienda');

select * from finish();
rollback;
