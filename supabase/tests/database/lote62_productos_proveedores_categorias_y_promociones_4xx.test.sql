-- Lote 62 (MSF-654, MSF-655): las RPC de Productos, Categorías, Proveedores y Promociones de precio migradas en la sexta ola contestan
-- `PT404` (HTTP 404) cuando el dato no existe o es de otra organización y `PT412` (HTTP 412) ante un conflicto de edición, con el mismo
-- mensaje de negocio de siempre. Cada afirmación comprueba código y mensaje.
begin;

select plan(25);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'lote62-a.ejemplo.com');
insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct, mostrar_con_iva) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'central', 0, false);

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 1000, 'ARS', true);
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
  ('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');

insert into dominio.proveedores (id, organizacion_id, razon_social, cuit) values
  ('c1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Proveedor Ejemplo SA', '20123456786');

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Fundas');

update public.banderas_plataforma set activa = true where clave = 'promociones_precio';

insert into dominio.promociones_precio (id, organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta) values
  ('d1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 800, now() + interval '1 day', now() + interval '3 days');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function pg_temp.como(uuid) to public;

-- «No existe»: PT404 con el mismo mensaje
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok($$select public.actualizar_producto('ffffffff-0000-0000-0000-000000000000', now(), 'Joystick', null, 'JOY-1', '{}', 'ARS', 49.9, null)$$, 'PT404', 'El producto no existe', 'actualizar_producto: un producto inexistente responde 404');
select throws_ok($$select public.cambiar_estado_producto('ffffffff-0000-0000-0000-000000000000', false)$$, 'PT404', 'El producto no existe', 'cambiar_estado_producto: un producto inexistente responde 404');
select throws_ok($$select public.definir_empresas_producto('ffffffff-0000-0000-0000-000000000000', array[]::uuid[])$$, 'PT404', 'El producto no existe', 'definir_empresas_producto: un producto inexistente responde 404');
select throws_ok($$select public.asignar_categoria_producto('ffffffff-0000-0000-0000-000000000000', null)$$, 'PT404', 'El producto no existe', 'asignar_categoria_producto: un producto inexistente responde 404');
select throws_ok($$select public.asignar_categoria_producto('a1000000-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000000')$$, 'PT404', 'La categoría no existe', 'asignar_categoria_producto: una categoría inexistente responde 404');
select throws_ok($$select public.guardar_relacionados('ffffffff-0000-0000-0000-000000000000', array[]::uuid[])$$, 'PT404', 'El producto no existe', 'guardar_relacionados: un producto inexistente responde 404');
select throws_ok($$select public.guardar_relacionados('a1000000-0000-0000-0000-000000000001', array['ffffffff-0000-0000-0000-000000000000']::uuid[])$$, 'PT404', 'Alguno de los productos relacionados no existe', 'guardar_relacionados: un relacionado inexistente responde 404');
select throws_ok($$select public.guardar_categoria(null, 'Hija', 'ffffffff-0000-0000-0000-000000000000', array[]::uuid[])$$, 'PT404', 'La categoría padre no existe', 'guardar_categoria: un padre inexistente responde 404');
select throws_ok($$select public.guardar_categoria('ffffffff-0000-0000-0000-000000000000', 'Otra', null, array[]::uuid[])$$, 'PT404', 'La categoría no existe', 'guardar_categoria: una categoría inexistente responde 404');
select throws_ok($$select public.eliminar_categoria('ffffffff-0000-0000-0000-000000000000')$$, 'PT404', 'La categoría no existe', 'eliminar_categoria: una categoría inexistente responde 404');
select throws_ok($$select public.reordenar_categorias(jsonb_build_array(jsonb_build_object('id', 'ffffffff-0000-0000-0000-000000000000', 'padre_id', null, 'posicion', 0)))$$, 'PT404', 'Alguna categoría no existe', 'reordenar_categorias: una categoría inexistente responde 404');
select throws_ok($$select public.actualizar_proveedor('ffffffff-0000-0000-0000-000000000000', now(), 'Proveedor Ejemplo SA', '20123456786')$$, 'PT404', 'El proveedor no existe', 'actualizar_proveedor: un proveedor inexistente responde 404');
select throws_ok($$select public.cambiar_estado_proveedor('ffffffff-0000-0000-0000-000000000000', false)$$, 'PT404', 'El proveedor no existe', 'cambiar_estado_proveedor: un proveedor inexistente responde 404');
select throws_ok($$select public.guardar_promocion_precio(null, 'ffffffff-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000001', 850, now() + interval '1 day', now() + interval '3 days')$$, 'PT404', 'La empresa no existe en tu organización', 'guardar_promocion_precio: una empresa inexistente responde 404');
select throws_ok($$select public.guardar_promocion_precio(null, 'e1000000-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000000', 850, now() + interval '1 day', now() + interval '3 days')$$, 'PT404', 'El producto no existe en tu organización', 'guardar_promocion_precio: un producto inexistente responde 404');
select throws_ok($$select public.guardar_promocion_precio('ffffffff-0000-0000-0000-000000000000', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 850, now() + interval '1 day', now() + interval '3 days')$$, 'PT404', 'La promoción no existe', 'guardar_promocion_precio: una promoción inexistente responde 404');
select throws_ok($$select public.anular_promocion_precio('ffffffff-0000-0000-0000-000000000000')$$, 'PT404', 'La promoción no existe', 'anular_promocion_precio: una promoción inexistente responde 404');

-- Conflicto de edición: PT412
select throws_ok($$select public.actualizar_producto('a1000000-0000-0000-0000-000000000001', '2000-01-01T00:00:00Z', 'Joystick', null, 'JOY-1', '{}', 'ARS', 49.9, null)$$, 'PT412', 'El producto fue modificado por otra persona', 'actualizar_producto: una versión vieja es un conflicto (412)');
select throws_ok($$select public.actualizar_proveedor('c1000000-0000-0000-0000-00000000000a', '2000-01-01T00:00:00Z', 'Proveedor Ejemplo SA', '20123456786')$$, 'PT412', 'El proveedor fue modificado por otra persona', 'actualizar_proveedor: una versión vieja es un conflicto (412)');
select throws_ok($$select public.guardar_promocion_precio('d1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 850, now() + interval '1 day', now() + interval '3 days', '2000-01-01T00:00:00Z')$$, 'PT412', 'La promoción fue modificada por otra persona', 'guardar_promocion_precio: una versión vieja es un conflicto (412)');
select throws_ok($$select public.anular_promocion_precio('d1000000-0000-0000-0000-00000000000a', '2000-01-01T00:00:00Z')$$, 'PT412', 'La promoción fue modificada por otra persona', 'anular_promocion_precio: una versión vieja es un conflicto (412)');

-- Un dato de otra organización no existe para quien pregunta.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok($$select public.cambiar_estado_producto('a1000000-0000-0000-0000-000000000001', false)$$, 'PT404', 'El producto no existe', 'cambiar_estado_producto: otra organización recibe 404');
select throws_ok($$select public.cambiar_estado_proveedor('c1000000-0000-0000-0000-00000000000a', false)$$, 'PT404', 'El proveedor no existe', 'cambiar_estado_proveedor: otra organización recibe 404');
select throws_ok($$select public.anular_promocion_precio('d1000000-0000-0000-0000-00000000000a')$$, 'PT404', 'La promoción no existe', 'anular_promocion_precio: otra organización recibe 404');
select throws_ok($$select public.eliminar_categoria('c1000000-0000-0000-0000-00000000000b')$$, 'PT404', 'La categoría no existe', 'eliminar_categoria: otra organización recibe 404');

select * from finish();
rollback;
