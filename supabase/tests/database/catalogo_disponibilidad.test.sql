-- F-CAT-17 (MSF-335) · SC-001: disponibilidad del producto.
-- Cubre: derivación Stock/Sin stock con existencias simuladas, la elección manual manda, quitar la
-- elección, aislamiento entre organizaciones, quien no ve Stock ve la etiqueta correcta sin cantidades,
-- compatibilidad de las firmas anteriores, evento sin costo y que `anon` no accede.
begin;

select plan(25);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'consulta@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Con existencias', 'D-1', 10),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Sin existencias', 'D-2', 10),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Pedido con stock', 'D-3', 10),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Entrante sin stock', 'D-4', 10),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Otra organización', 'D-5', 10);

-- Existencias simuladas (como postgres; la app solo escribe por RPC de stock). La fila nace por trigger.
update dominio.existencias set cantidad = 7 where producto_id = 'a1000000-0000-0000-0000-000000000001';
update dominio.existencias set cantidad = 3 where producto_id = 'a1000000-0000-0000-0000-000000000003';
update dominio.existencias set cantidad = 9 where producto_id = 'a2000000-0000-0000-0000-000000000001';
update dominio.productos set disponibilidad_manual = 'a_pedido' where id = 'a1000000-0000-0000-0000-000000000003';
update dominio.productos set disponibilidad_manual = 'stock_entrante' where id = 'a1000000-0000-0000-0000-000000000004';

-- Consulta: lee Productos pero sin acceso a Stock (override por organización).
insert into permisos_rol (organizacion_id, rol_id, seccion, nivel)
values ('11111111-1111-1111-1111-111111111111', 'consulta', 'stock', 'ninguno')
on conflict (organizacion_id, rol_id, seccion) do update set nivel = 'ninguno';

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select is(has_function_privilege('anon', 'private.disponibilidad_producto(uuid)', 'EXECUTE'), false, 'anon no ejecuta la derivación');
select is(has_function_privilege('anon', 'private.productos_con_stock()', 'EXECUTE'), false, 'anon no ejecuta la derivación por lotes');
select is(has_function_privilege('authenticated', 'private.disponibilidad_producto(uuid)', 'EXECUTE'), true, 'authenticated ejecuta la derivación');
select is(
  (select p.prosecdef and p.proconfig = array['search_path=""'] from pg_proc p where p.oid = 'private.disponibilidad_producto(uuid)'::regprocedure),
  true, 'la derivación es security definer con search_path vacío');
select is(
  (select pg_get_function_result('private.disponibilidad_producto(uuid)'::regprocedure)),
  'text', 'la derivación devuelve solo la etiqueta (texto), nunca cantidades');
select is(has_table_privilege('anon', 'public.v_productos_listado', 'SELECT'), false, 'anon no lee la vista');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is(private.disponibilidad_producto('a1000000-0000-0000-0000-000000000001'), 'stock', 'con existencias > 0 es Stock');
select is(private.disponibilidad_producto('a1000000-0000-0000-0000-000000000002'), 'sin_stock', 'con 0 existencias es Sin stock');
select is(private.disponibilidad_producto('a1000000-0000-0000-0000-000000000003'), 'a_pedido', 'A pedido manda sobre las existencias');
select is(private.disponibilidad_producto('a1000000-0000-0000-0000-000000000004'), 'stock_entrante', 'Stock entrante manda sobre Sin stock');
select is(private.disponibilidad_producto('a2000000-0000-0000-0000-000000000001'), null, 'un producto de otra organización no se resuelve');

select is(
  (select jsonb_object_agg(sku, disponibilidad) from public.v_productos_listado),
  '{"D-1": "stock", "D-2": "sin_stock", "D-3": "a_pedido", "D-4": "stock_entrante"}'::jsonb,
  'la vista coincide con la función y solo muestra la organización activa');
select is(
  (select count(*)::int from public.v_productos_listado where disponibilidad = 'sin_stock'), 1,
  'el filtro por disponibilidad acota la lista en la base');

-- Alta y edición con la disponibilidad manual.
select is(
  (select disponibilidad_manual from public.crear_producto('Alta a pedido', null, 'D-6', '{}', 'USD', 10, null, null, null, null, 'a_pedido')),
  'a_pedido', 'el alta guarda la disponibilidad manual');
select throws_ok(
  $$select public.crear_producto('Valor inválido', null, 'D-7', '{}', 'USD', 10, null, null, null, null, 'stock')$$,
  '22023', 'La disponibilidad solo puede ser A pedido o Stock entrante en breve', 'rechaza una disponibilidad que no es elegible');
select is(
  (select disponibilidad_manual from public.crear_producto('Firma anterior', null, 'D-8', '{}', 'USD', 10)),
  null, 'la firma anterior de crear_producto sigue funcionando (sin elección manual)');

create temp table d1 as select id, updated_at from dominio.productos where sku = 'D-1';
grant select on d1 to authenticated;

select is(
  (select disponibilidad_manual from public.actualizar_producto((select id from d1), (select updated_at from d1), 'Con existencias', null, 'D-1', '{}', 'USD', 10)),
  null, 'la firma anterior de actualizar_producto no toca la disponibilidad');
select is(
  (select disponibilidad_manual from public.actualizar_producto(
    (select id from dominio.productos where sku = 'D-1'), (select updated_at from dominio.productos where sku = 'D-1'),
    'Con existencias', null, 'D-1', '{}', 'USD', 10, null, null, null, false, null, false, 'stock_entrante', true)),
  'stock_entrante', 'con p_cambiar_disponibilidad se guarda la elección');
select is(
  (select disponibilidad_manual from public.actualizar_producto(
    (select id from dominio.productos where sku = 'D-1'), (select updated_at from dominio.productos where sku = 'D-1'),
    'Con existencias', null, 'D-1', '{}', 'USD', 10)),
  'stock_entrante', 'actualizar sin p_cambiar_disponibilidad conserva la elección');
select is(
  (select disponibilidad_manual from public.actualizar_producto(
    (select id from dominio.productos where sku = 'D-1'), (select updated_at from dominio.productos where sku = 'D-1'),
    'Con existencias', null, 'D-1', '{}', 'USD', 10, null, null, null, false, null, false, null, true)),
  null, 'con p_cambiar_disponibilidad y nulo se quita la elección');
select is(private.disponibilidad_producto((select id from d1)), 'stock', 'al quitar la elección vuelve a la derivada');

-- Actividad: el cambio deja `producto.editado` sin datos de costo.
select ok(
  exists (select 1 from public.registro_actividad where tipo = 'producto.editado' and detalle like 'Editó el producto Con existencias%')
  and not exists (select 1 from public.registro_actividad where tipo = 'producto.editado' and detalle ~* 'costo'),
  'el cambio de disponibilidad queda en Actividad como producto.editado, sin costo');

-- Quien no tiene acceso a Stock ve la etiqueta correcta sin ver cantidades.
reset role;
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from dominio.existencias), 0, 'consulta sin Stock: no ve cantidades de existencias');
select is(private.disponibilidad_producto('a1000000-0000-0000-0000-000000000001'), 'stock', 'consulta sin Stock: ve la etiqueta derivada correcta (Stock)');
select is(
  (select disponibilidad from public.v_productos_listado where sku = 'D-1'), 'stock',
  'consulta sin Stock: el listado muestra la etiqueta derivada correcta');

select * from finish();
rollback;
