-- Lote 65 (MSF-654, MSF-655): las RPC de alícuotas de IVA, precios por escala, reglas y precios propios por empresa, y de empresas y contactos de
-- proveedores migradas en la séptima ola contestan `PT404` (HTTP 404) cuando el dato no existe o es de otra organización y `PT412` (HTTP 412)
-- ante un conflicto de edición, con el mismo mensaje de negocio de siempre. Cada afirmación comprueba código y mensaje.
begin;

select plan(26);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

-- Tienda A tiene regla de precio y Tienda B no. La organización 2 tiene su propia tienda y su propio producto.
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', true);
insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct, mostrar_con_iva) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'central', 0, false);

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 1000, 'ARS', true),
  ('a2000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'Teclado', 'TEC-1', 500, 'ARS', true);

insert into dominio.proveedores (id, organizacion_id, razon_social, cuit) values
  ('c1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Proveedor Ejemplo SA', '20123456786');
insert into dominio.proveedores_contactos (id, organizacion_id, proveedor_id, nombre) values
  ('c1000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-00000000000a', 'Contacto Uno');

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Fundas');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function pg_temp.como(uuid) to public;

-- «No existe» y conflicto de edición: PT404 y PT412 con el mismo mensaje
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok($$select public.guardar_regla_precio_empresa('ffffffff-0000-0000-0000-000000000000', 'central')$$, 'PT404', 'La empresa no existe en tu organización', 'guardar_regla_precio_empresa: una empresa inexistente responde 404');
select throws_ok($$select public.guardar_regla_precio_empresa('e1000000-0000-0000-0000-000000000001', 'central_ajuste', 5, '2000-01-01T00:00:00Z')$$, 'PT412', 'La regla de precio fue modificada por otra persona', 'guardar_regla_precio_empresa: una versión vieja es un conflicto (412)');
select throws_ok($$select public.guardar_regla_precio_empresa('e1000000-0000-0000-0000-000000000002', 'central_ajuste', 5, '2000-01-01T00:00:00Z')$$, 'PT412', 'La regla de precio fue modificada por otra persona', 'guardar_regla_precio_empresa: pedir una versión de una regla que no existe es un conflicto (412)');
select throws_ok($$select * from public.previsualizar_precios_empresa('ffffffff-0000-0000-0000-000000000000', 'central')$$, 'PT404', 'La empresa no existe en tu organización', 'previsualizar_precios_empresa: una empresa inexistente responde 404');
select throws_ok($$select public.guardar_precios_escala('ffffffff-0000-0000-0000-000000000000', 10, 9, 8)$$, 'PT404', 'El producto no existe', 'guardar_precios_escala: un producto inexistente responde 404');
select throws_ok($$select public.asignar_alicuota_producto('ffffffff-0000-0000-0000-000000000000', null)$$, 'PT404', 'El producto no existe', 'asignar_alicuota_producto: un producto inexistente responde 404');
select throws_ok($$select public.asignar_alicuota_producto('a1000000-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000000')$$, 'PT404', 'La alícuota de IVA no existe', 'asignar_alicuota_producto: una alícuota inexistente responde 404');
select throws_ok($$select public.guardar_alicuota_categoria('ffffffff-0000-0000-0000-000000000000', 'ffffffff-0000-0000-0000-000000000000')$$, 'PT404', 'La categoría no existe', 'guardar_alicuota_categoria: una categoría inexistente responde 404');
select throws_ok($$select public.guardar_alicuota_categoria('c1000000-0000-0000-0000-00000000000b', 'ffffffff-0000-0000-0000-000000000000')$$, 'PT404', 'La alícuota de IVA no existe', 'guardar_alicuota_categoria: una alícuota inexistente responde 404');
select throws_ok($$select public.fijar_precio_propio('ffffffff-0000-0000-0000-000000000000', 'e1000000-0000-0000-0000-000000000001', 'ARS', 10)$$, 'PT404', 'El producto no existe', 'fijar_precio_propio: un producto inexistente responde 404');
select throws_ok($$select public.fijar_precio_propio('a1000000-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000000', 'ARS', 10)$$, 'PT404', 'La empresa no existe', 'fijar_precio_propio: una empresa inexistente responde 404');
select throws_ok($$select public.quitar_precio_propio('ffffffff-0000-0000-0000-000000000000', 'e1000000-0000-0000-0000-000000000001')$$, 'PT404', 'El producto no existe', 'quitar_precio_propio: un producto inexistente responde 404');
select throws_ok($$select public.quitar_precio_propio('a1000000-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000000')$$, 'PT404', 'La empresa no existe', 'quitar_precio_propio: una empresa inexistente responde 404');
select throws_ok($$select public.guardar_empresas_de_proveedor('ffffffff-0000-0000-0000-000000000000', array[]::uuid[])$$, 'PT404', 'El proveedor no pertenece a tu organización', 'guardar_empresas_de_proveedor: un proveedor inexistente responde 404');
select throws_ok($$select public.agregar_contacto_proveedor('ffffffff-0000-0000-0000-000000000000', 'Ana')$$, 'PT404', 'El proveedor no existe', 'agregar_contacto_proveedor: un proveedor inexistente responde 404');
select throws_ok($$select public.marcar_contacto_principal('ffffffff-0000-0000-0000-000000000000')$$, 'PT404', 'El contacto no existe', 'marcar_contacto_principal: un contacto inexistente responde 404');

-- Un dato de otra organización no existe para quien pregunta.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok($$select public.guardar_regla_precio_empresa('e1000000-0000-0000-0000-000000000001', 'central')$$, 'PT404', 'La empresa no existe en tu organización', 'guardar_regla_precio_empresa: una empresa de otra organización recibe 404');
select throws_ok($$select * from public.previsualizar_precios_empresa('e1000000-0000-0000-0000-000000000001', 'central')$$, 'PT404', 'La empresa no existe en tu organización', 'previsualizar_precios_empresa: una empresa de otra organización recibe 404');
select throws_ok($$select public.guardar_precios_escala('a1000000-0000-0000-0000-000000000001', 10, 9, 8)$$, 'PT404', 'El producto no existe', 'guardar_precios_escala: un producto de otra organización recibe 404');
select throws_ok($$select public.asignar_alicuota_producto('a1000000-0000-0000-0000-000000000001', null)$$, 'PT404', 'El producto no existe', 'asignar_alicuota_producto: un producto de otra organización recibe 404');
select throws_ok($$select public.guardar_alicuota_categoria('c1000000-0000-0000-0000-00000000000b', 'ffffffff-0000-0000-0000-000000000000')$$, 'PT404', 'La categoría no existe', 'guardar_alicuota_categoria: una categoría de otra organización recibe 404');
select throws_ok($$select public.fijar_precio_propio('a2000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', 'ARS', 10)$$, 'PT404', 'La empresa no existe', 'fijar_precio_propio: una empresa de otra organización recibe 404');
select throws_ok($$select public.quitar_precio_propio('a2000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001')$$, 'PT404', 'La empresa no existe', 'quitar_precio_propio: una empresa de otra organización recibe 404');
select throws_ok($$select public.guardar_empresas_de_proveedor('c1000000-0000-0000-0000-00000000000a', array[]::uuid[])$$, 'PT404', 'El proveedor no pertenece a tu organización', 'guardar_empresas_de_proveedor: un proveedor de otra organización recibe 404');
select throws_ok($$select public.agregar_contacto_proveedor('c1000000-0000-0000-0000-00000000000a', 'Ana')$$, 'PT404', 'El proveedor no existe', 'agregar_contacto_proveedor: un proveedor de otra organización recibe 404');
select throws_ok($$select public.marcar_contacto_principal('c1000000-0000-0000-0000-00000000000c')$$, 'PT404', 'El contacto no existe', 'marcar_contacto_principal: un contacto de otra organización recibe 404');

select * from finish();
rollback;
