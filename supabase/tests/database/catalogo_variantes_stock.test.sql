-- F-CAT-15 (MSF-408, épica MSF-229), bloque B. Cubre FR-004, FR-005, FR-006, FR-007, FR-010, SC-001 y SC-005:
-- tres variantes suman al producto, desactivar resta, todas inactivas → Sin stock, movimiento con variante en el
-- libro, la firma nueva sigue aceptando a los llamadores sin variante, y listado/tienda coinciden con la suma.
begin;

select * from no_plan();

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into auth.users (id, email) values ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Remera', 'REM-1', 20),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Gorra', 'GOR-1', 10);

insert into dominio.producto_variantes (id, organizacion_id, producto_id, nombre, codigo, orden) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'Negro', 'REM-1-N', 1),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'Blanco', 'REM-1-B', 2),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'Rojo', 'REM-1-R', 3);

create temp table ids on commit drop as
select m.organizacion_id, m.nombre, m.id from dominio.motivos_movimiento m;
grant select on ids to authenticated;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- Estructura
select is(has_table_privilege('anon', 'dominio.existencias_variante', 'SELECT'), false, 'anon no lee existencias_variante');
select is(has_table_privilege('authenticated', 'dominio.existencias_variante', 'INSERT'), false, 'nadie escribe existencias_variante directo');
select is((select relrowsecurity from pg_class where oid = 'dominio.existencias_variante'::regclass), true, 'existencias_variante tiene RLS');
select is(has_function_privilege('anon', 'public.registrar_movimiento_stock(uuid, text, integer, uuid, text, date, uuid, uuid, uuid)', 'EXECUTE'),
  false, 'anon no ejecuta registrar_movimiento_stock');
select is(has_function_privilege('authenticated', 'public.registrar_movimiento_stock(uuid, text, integer, uuid, text, date, uuid, uuid, uuid)', 'EXECUTE'),
  true, 'authenticated ejecuta registrar_movimiento_stock de 9 parámetros');
select is((select count(*)::int from pg_proc where proname = 'registrar_movimiento_stock' and pronamespace = 'public'::regnamespace),
  1, 'queda una sola firma de registrar_movimiento_stock');

-- Con variantes, la variante es obligatoria; sin variantes, prohibida
select throws_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'entrada', 5,
      (select id from ids where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = 'Compra a proveedor'), null, current_date)$$,
  '22023', 'Este producto tiene variantes: elegí la variante del movimiento', 'un producto con variantes exige la variante');
select throws_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000002', 'entrada', 5,
      (select id from ids where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = 'Compra a proveedor'), null, current_date, null, null,
      'c1000000-0000-0000-0000-000000000001')$$,
  '22023', 'Este producto no tiene variantes', 'un producto sin variantes rechaza una variante');
select throws_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'entrada', 5,
      (select id from ids where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = 'Compra a proveedor'), null, current_date, null, null,
      'c1000000-0000-0000-0000-0000000000ff')$$,
  '22023', 'La variante no pertenece a este producto', 'la variante tiene que ser del producto');

-- Sin stock hasta que entre mercadería
select is(private.disponibilidad_producto('a1000000-0000-0000-0000-000000000001'), 'sin_stock', 'sin unidades: Sin stock');

-- Entradas a las tres variantes: 4 + 3 + 2
select lives_ok($$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'entrada', 4,
  (select id from ids where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = 'Compra a proveedor'), null, current_date, null, null, 'c1000000-0000-0000-0000-000000000001')$$,
  'entrada de 4 a Negro');
select lives_ok($$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'entrada', 3,
  (select id from ids where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = 'Compra a proveedor'), null, current_date, null, null, 'c1000000-0000-0000-0000-000000000002')$$,
  'entrada de 3 a Blanco');
select lives_ok($$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'entrada', 2,
  (select id from ids where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = 'Compra a proveedor'), null, current_date, null, null, 'c1000000-0000-0000-0000-000000000003')$$,
  'entrada de 2 a Rojo');

select is(
  (select variante_id::text || ':' || saldo::text from dominio.movimientos_stock where saldo = 4 and tipo = 'entrada'),
  'c1000000-0000-0000-0000-000000000001:4', 'el libro guarda la variante y el saldo de la variante');
select is((select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'), 0,
  'la existencia del producto en sí no cambia: el stock es la suma de las variantes');
select is((select count(*)::int from public.v_producto_variantes where producto_id = 'a1000000-0000-0000-0000-000000000001' and stock is not null), 3,
  'la vista expone el stock de cada variante');
select is((select sum(stock)::int from public.v_producto_variantes where producto_id = 'a1000000-0000-0000-0000-000000000001'), 9,
  'las tres variantes suman 9');

select is(private.disponibilidad_producto('a1000000-0000-0000-0000-000000000001'), 'stock', 'con variantes con unidades: Con stock');
select is((select count(*)::int from private.productos_con_stock() as p(id) where p.id = 'a1000000-0000-0000-0000-000000000001'), 1,
  'productos_con_stock incluye al producto con variantes');
select is((select disponibilidad from public.v_productos_listado where id = 'a1000000-0000-0000-0000-000000000001'), 'stock',
  'el listado coincide con la suma de las variantes');
reset role;
select is(private.disponible_publico('a1000000-0000-0000-0000-000000000001'), true, 'la tienda coincide: disponible');

-- No se pueden sacar más unidades de las que tiene la variante
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok($$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'salida', 5,
  (select id from ids where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = 'Venta en local'), null, current_date, null, null, 'c1000000-0000-0000-0000-000000000003')$$,
  '23514', 'No hay stock suficiente', 'la salida no deja la variante bajo cero');

-- Desactivar resta (FR-010)
reset role;
update dominio.producto_variantes set activa = false where id = 'c1000000-0000-0000-0000-000000000001';
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(private.disponibilidad_producto('a1000000-0000-0000-0000-000000000001'), 'stock', 'desactivar Negro: quedan Blanco y Rojo');
reset role;
update dominio.producto_variantes set activa = false where id in ('c1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000003');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(private.disponibilidad_producto('a1000000-0000-0000-0000-000000000001'), 'sin_stock', 'todas inactivas: Sin stock');
select is((select count(*)::int from private.productos_con_stock() as p(id) where p.id = 'a1000000-0000-0000-0000-000000000001'), 0,
  'todas inactivas: fuera de productos_con_stock');
reset role;
select is(private.disponible_publico('a1000000-0000-0000-0000-000000000001'), false, 'todas inactivas: la tienda no lo ofrece');
select is((select cantidad from dominio.existencias_variante where variante_id = 'c1000000-0000-0000-0000-000000000001' limit 1), 4,
  'desactivar conserva el stock de la variante');

-- Producto sin variantes: igual que antes (FR-004, SC-005)
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok($$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000002', 'entrada', 6,
  (select id from ids where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = 'Compra a proveedor'), null, current_date)$$,
  'el llamador sin variante sigue funcionando (firma compatible)');
select is((select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000002'), 6, 'sin variantes: la existencia del producto sube');
select is(private.disponibilidad_producto('a1000000-0000-0000-0000-000000000002'), 'stock', 'sin variantes: disponibilidad por existencias');
select is((select variante_id from dominio.movimientos_stock where producto_id = 'a1000000-0000-0000-0000-000000000002'), null, 'sin variantes: el libro no lleva variante');
reset role;
select is(private.disponible_publico('a1000000-0000-0000-0000-000000000002'), true, 'sin variantes: la tienda usa existencias');
select is((select count(*)::int from public.cola_eventos where tipo = 'stock.actualizado'), 1,
  'solo el movimiento sin variante emite stock.actualizado');

select * from finish();
rollback;
