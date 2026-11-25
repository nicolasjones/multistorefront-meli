-- Lote 75 (MSF-599, MSF-654 y MSF-655, duodécima ola): las RPC de listas de precios, variantes de producto, mover productos de
-- categoría y vista previa de la cotización contestan `PT404` (HTTP 404) cuando el dato no existe y `PT412` (HTTP 412) ante un
-- conflicto de edición (antes `P0002` y `40001`, HTTP 500), con el mismo mensaje de negocio de siempre. Cada afirmación comprueba
-- código y mensaje; hay al menos una por función migrada (`aplicar_actualizacion_precios` se cubre en precios_masivos.test.sql,
-- que arma la vista previa vigente). Se comprueba también lo que NO cambia: la bandera apagada (`55000`), el producto inexistente
-- de una operación masiva (`P0002`, lo lanza un auxiliar de `private`) y el `40001` con detail de stock de las variantes.
-- Fixture como postgres; verificaciones como «authenticated» con request.jwt.claims, igual que PostgREST.
begin;

select plan(24);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');
insert into dominio.clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 10, 'Cliente Dos', 'minorista');
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Remera', '5134a', 20),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto Dos', 'DOS-1', 5);
insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1100000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function pg_temp.como(uuid) to public;
create temp table listas (clave text primary key, id uuid);
grant select, insert on listas to public;

-- Bandera apagada: sigue con 55000 (falla de configuración del entorno, no una regla de negocio de la persona).
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok($$select public.guardar_lista_precios(null, 'Mayoristas', null, -10, null)$$,
  '55000', 'Las listas de precios están desactivadas en este entorno', 'guardar_lista_precios: con la bandera apagada sigue con 55000');
select throws_ok($$select public.asignar_lista_precios_cliente('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001')$$,
  '55000', 'Las listas de precios están desactivadas en este entorno', 'asignar_lista_precios_cliente: con la bandera apagada sigue con 55000');
reset role;
update public.banderas_plataforma set activa = true where clave = 'listas_precios';
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok($$select public.guardar_lista_precios(null, 'Mayoristas', null, -10, null)$$, 'fixture: se crea una lista');
reset role;
insert into listas select 'uno', id from dominio.listas_precios where organizacion_id = '11111111-1111-1111-1111-111111111111';
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- ============================================================================
-- Listas de precios
-- ============================================================================
select throws_ok($$select public.guardar_lista_precios('99999999-9999-9999-9999-999999999999', 'X', null, 1, now())$$,
  'PT404', 'La lista de precios no existe', 'guardar_lista_precios: una lista inexistente responde 404');
select throws_ok(format($$select public.guardar_lista_precios(%L, 'Mayoristas', null, -15, %L)$$, (select id from listas where clave = 'uno'), '2000-01-01 00:00:00+00'),
  'PT412', 'La lista fue modificada por otra persona', 'guardar_lista_precios: una edición con updated_at viejo responde 412');
select throws_ok($$select public.archivar_lista_precios('99999999-9999-9999-9999-999999999999', null)$$,
  'PT404', 'La lista de precios no existe', 'archivar_lista_precios: una lista inexistente responde 404');
select throws_ok(format($$select public.archivar_lista_precios(%L, %L)$$, (select id from listas where clave = 'uno'), '2000-01-01 00:00:00+00'),
  'PT412', 'La lista fue modificada por otra persona', 'archivar_lista_precios: un updated_at viejo responde 412');
select throws_ok($$select public.restaurar_lista_precios('99999999-9999-9999-9999-999999999999', null)$$,
  'PT404', 'La lista de precios no existe', 'restaurar_lista_precios: una lista inexistente responde 404');
-- Para restaurar con un updated_at viejo la lista tiene que estar archivada.
select lives_ok(format($$select public.archivar_lista_precios(%L, (select updated_at from dominio.listas_precios where id = %L))$$,
  (select id from listas where clave = 'uno'), (select id from listas where clave = 'uno')), 'fixture: se archiva la lista');
select throws_ok(format($$select public.restaurar_lista_precios(%L, %L)$$, (select id from listas where clave = 'uno'), '2000-01-01 00:00:00+00'),
  'PT412', 'La lista fue modificada por otra persona', 'restaurar_lista_precios: un updated_at viejo responde 412');
select throws_ok($$select public.asignar_lista_precios_cliente('99999999-9999-9999-9999-999999999999', null)$$,
  'PT404', 'El cliente no existe', 'asignar_lista_precios_cliente: un cliente inexistente responde 404');
select throws_ok($$select public.asignar_lista_precios_cliente('c1000000-0000-0000-0000-000000000001', '99999999-9999-9999-9999-999999999999')$$,
  'PT404', 'La lista de precios no existe', 'asignar_lista_precios_cliente: una lista inexistente responde 404');
select throws_ok($$select public.asignar_lista_precios_cliente('c2000000-0000-0000-0000-000000000001', null)$$,
  'PT404', 'El cliente no existe', 'asignar_lista_precios_cliente: un cliente de otra organización responde 404 (sin oráculo)');

-- ============================================================================
-- Variantes de producto
-- ============================================================================
select throws_ok($$select public.guardar_variantes_producto('99999999-9999-9999-9999-999999999999', now(), '[]'::jsonb)$$,
  'PT404', 'El producto no existe', 'guardar_variantes_producto: un producto inexistente responde 404');
select throws_ok($$select public.guardar_variantes_producto('b2000000-0000-0000-0000-000000000001', now(), '[]'::jsonb)$$,
  'PT404', 'El producto no existe', 'guardar_variantes_producto: un producto de otra organización responde 404');
select throws_ok($$select public.guardar_variantes_producto('a1000000-0000-0000-0000-000000000001', now() - interval '1 day', '[]'::jsonb)$$,
  'PT412', 'El producto fue modificado por otra persona', 'guardar_variantes_producto: un producto cambiado responde 412');
-- El stock de una variante que cambió mientras editabas conserva su contrato propio (40001 con detail = stock).
select lives_ok($$select public.guardar_variantes_producto('a1000000-0000-0000-0000-000000000001', (select updated_at from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'),
  '[{"nombre":"Negro","codigo":"5134a-N","activa":true,"stock":0}]'::jsonb)$$, 'fixture: una variante sin stock');
select throws_ok($$select public.guardar_variantes_producto('a1000000-0000-0000-0000-000000000001', (select updated_at from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'),
  jsonb_build_array(jsonb_build_object('id', (select id from dominio.producto_variantes where producto_id = 'a1000000-0000-0000-0000-000000000001' limit 1),
    'nombre', 'Negro', 'codigo', '5134a-N', 'activa', true, 'stock', 5, 'stock_leido', 3)))$$,
  '40001', null, 'guardar_variantes_producto: el stock cambiado de una variante sigue con 40001');

-- ============================================================================
-- Mover productos de categoría, vista previa de la cotización
-- ============================================================================
select throws_ok($$select public.mover_productos_categoria(array['a1000000-0000-0000-0000-000000000001']::uuid[], gen_random_uuid())$$,
  'PT404', 'La categoría no existe', 'mover_productos_categoria: una categoría inexistente responde 404');
select throws_ok($$select public.mover_productos_categoria(array[gen_random_uuid()]::uuid[], 'c1100000-0000-0000-0000-000000000001')$$,
  'P0002', 'Alguno de los productos no existe o no pertenece a tu organización', 'mover_productos_categoria: un producto inexistente sigue con P0002 (auxiliar de private)');
select throws_ok($$select public.previsualizar_cotizacion()$$,
  'PT404', 'sin_cotizacion_pendiente', 'previsualizar_cotizacion: sin cotización pendiente responde 404');

-- Permisos intactos: sin sesión de administrador no se ve nada.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok(format($$select public.archivar_lista_precios(%L, null)$$, (select id from listas where clave = 'uno')),
  'PT404', 'La lista de precios no existe', 'archivar_lista_precios: la lista de otra organización responde 404 (sin oráculo)');
select is(has_function_privilege('anon', 'public.guardar_variantes_producto(uuid, timestamptz, jsonb)', 'execute'), false, 'anon sigue sin ejecutar guardar_variantes_producto');
select is(has_function_privilege('anon', 'public.archivar_lista_precios(uuid, timestamptz)', 'execute'), false, 'anon sigue sin ejecutar archivar_lista_precios');

select * from finish();
rollback;
