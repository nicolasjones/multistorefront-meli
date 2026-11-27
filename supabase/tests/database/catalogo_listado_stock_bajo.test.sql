-- MSF-611: `public.v_productos_listado.estado_stock` y el filtro `stock_bajo` de `public.exportar_productos`.
-- Cubre la frontera del estado en una tabla (disponible = mínimo - 1, = mínimo, = mínimo + 1 y cero), la paridad exacta con
-- `public.stock_estados`, el filtro de la exportación (con y sin el filtro,
-- combinado con la búsqueda y ignorado por «todos») y el aislamiento entre organizaciones.
begin;

select plan(15);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('d6110000-0000-0000-0000-000000000001', 'admin-611@example.com'),
  ('d6110000-0000-0000-0000-000000000002', 'sin-stock-611@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d6110000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d6110000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo');
-- La persona de «consulta» ve el catálogo pero NO la sección Stock (permiso explícito de la organización).
insert into public.permisos_rol (organizacion_id, rol_id, seccion, nivel) values
  ('11111111-1111-1111-1111-111111111111', 'consulta', 'productos', 'lectura'),
  ('11111111-1111-1111-1111-111111111111', 'consulta', 'stock', 'ninguno')
on conflict (organizacion_id, rol_id, seccion) do update set nivel = excluded.nivel;

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a6110000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Bajo (mínimo - 1)', 'S-1', 10),
  ('a6110000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Bajo (justo el mínimo)', 'S-2', 10),
  ('a6110000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Disponible (mínimo + 1)', 'S-3', 10),
  ('a6110000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Sin stock', 'S-4', 10),
  ('a6110000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Disponible holgado', 'S-5', 10),
  ('a6110000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Bajo por reservas', 'S-6', 10),
  ('a6110000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Sin stock por reservas', 'S-7', 10),
  ('a6110000-0000-0000-0000-000000000009', '22222222-2222-2222-2222-222222222222', 'Bajo de otra organización', 'S-9', 10);
-- Mínimo 5 en todos: disponible 4, 5, 6, 0 y 50; S-6 tiene 8 en mano y 3 reservadas (disponible 5: bajo) y S-7 10 y 10 reservadas
-- (disponible 0: sin stock), que la cantidad sola daría «disponible». El de la Dos: 1.
update dominio.existencias set minimo = 5 where organizacion_id = '11111111-1111-1111-1111-111111111111';
update dominio.existencias set cantidad = 4 where producto_id = 'a6110000-0000-0000-0000-000000000001';
update dominio.existencias set cantidad = 5 where producto_id = 'a6110000-0000-0000-0000-000000000002';
update dominio.existencias set cantidad = 6 where producto_id = 'a6110000-0000-0000-0000-000000000003';
update dominio.existencias set cantidad = 0 where producto_id = 'a6110000-0000-0000-0000-000000000004';
update dominio.existencias set cantidad = 50 where producto_id = 'a6110000-0000-0000-0000-000000000005';
update dominio.existencias set cantidad = 8, reservado = 3 where producto_id = 'a6110000-0000-0000-0000-000000000006';
update dominio.existencias set cantidad = 10, reservado = 10 where producto_id = 'a6110000-0000-0000-0000-000000000007';
update dominio.existencias set minimo = 5, cantidad = 1 where producto_id = 'a6110000-0000-0000-0000-000000000009';

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('d6110000-0000-0000-0000-000000000001');

-- Frontera del estado: una sola tabla (disponible vs mínimo 5).
select results_eq(
  $$select sku, estado_stock from public.v_productos_listado where organizacion_id = '11111111-1111-1111-1111-111111111111' order by sku$$,
  $$values ('S-1'::text, 'stock_bajo'::text), ('S-2', 'stock_bajo'), ('S-3', 'disponible'), ('S-4', 'sin_stock'), ('S-5', 'disponible'), ('S-6', 'stock_bajo'), ('S-7', 'sin_stock')$$,
  'estado_stock: 4 y 5 (≤ mínimo) son bajos, 6 (mínimo + 1) disponible, 0 sin stock y 50 disponible; las reservas restan (8 − 3 = 5 bajo; 10 − 10 = 0 sin stock)'
);

-- Paridad con la vista de Stock (la misma regla que el resto de la app).
select is(
  (select count(*)::int from public.v_productos_listado v join public.stock_estados s on s.producto_id = v.id
    where v.estado_stock is distinct from s.estado),
  0, 'estado_stock coincide con stock_estados para todos los productos'
);

-- Aislamiento.
select is(
  (select count(*)::int from public.v_productos_listado where estado_stock = 'stock_bajo'), 3,
  'el listado de la Uno no cuenta el bajo de la Dos'
);

-- La exportación.
select is((public.exportar_productos('{}', array['sku']) ->> 'total')::int, 7, 'sin filtro: los 7 productos de la organización');
select is((public.exportar_productos('{"stock_bajo": true}', array['sku']) ->> 'total')::int, 3, 'stock_bajo: solo los tres en estado bajo (no los sin stock)');
select is(
  (select jsonb_agg(f ->> 'sku' order by f ->> 'sku') from jsonb_array_elements(public.exportar_productos('{"stock_bajo": true}', array['sku']) -> 'filas') f),
  '["S-1", "S-2", "S-6"]'::jsonb, 'stock_bajo: trae exactamente S-1, S-2 y S-6'
);
select is((public.exportar_productos('{"stock_bajo": false}', array['sku']) ->> 'total')::int, 7, 'stock_bajo en falso no filtra');
select is((public.exportar_productos('{"stock_bajo": true, "busqueda": "justo"}', array['sku']) ->> 'total')::int, 1, 'se combina con la búsqueda (AND)');
select is((public.exportar_productos('{"stock_bajo": true, "busqueda": "holgado"}', array['sku']) ->> 'total')::int, 0, 'combinado con una búsqueda sin coincidencias en bajos: cero');
select is((public.exportar_productos('{"todos": true, "stock_bajo": true}', array['sku']) ->> 'total')::int, 7, '«Todos» ignora el filtro');
select is((public.exportar_productos('{"stock_bajo": true, "estado": "inactivos"}', array['sku']) ->> 'total')::int, 0, 'se combina con el estado: ningún inactivo está bajo');

-- Sin la sección Stock la base no devuelve el estado: nulo en todas las filas y el filtro no encuentra nada.
select pg_temp.como('d6110000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.v_productos_listado), 7, 'quien no ve Stock sí ve los 7 productos del catálogo');
select is((select count(*)::int from public.v_productos_listado where estado_stock is not null), 0, 'pero su estado_stock es nulo en todos');
select is((select count(*)::int from public.v_productos_listado where estado_stock = 'stock_bajo'), 0, 'y el filtro «Stock bajo» no le devuelve ninguno');
reset role;
select is(has_table_privilege('anon', 'public.v_productos_listado', 'SELECT'), false, 'anon no lee la vista del listado');

select * from finish();
rollback;
