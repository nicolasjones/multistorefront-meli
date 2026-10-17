-- F-CAT-03 (MSF-459, épica MSF-456): SKU único por organización y autogenerado.
-- Cubre SC-003 / FR-007 / FR-019: recorte y mayúsculas, otra organización, SKU
-- vacío → `PRD-XXXXXXXX` distinto entre productos, edición a SKU ocupado, edición
-- a vacío → regenerado, y la garantía ante concurrencia: la unicidad la impone un
-- índice único (el árbitro de dos altas simultáneas), que acá se ejercita con
-- `on conflict` y con el autogenerado en lote.
begin;

select plan(17);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select lives_ok(
  $$select public.crear_producto('Uno', null, '  ABC-1  ', '{}', 'USD', 10, null)$$,
  'alta con SKU a mano'
);
select is(
  (select sku from dominio.productos where nombre = 'Uno'), 'ABC-1',
  'el SKU se recorta y se respeta tal como se cargó (sin pasar a mayúsculas)'
);
select throws_ok(
  $$select public.crear_producto('Dos', null, 'abc-1 ', '{}', 'USD', 10, null)$$,
  '23505', null, 'mismo SKU en otra capitalización y con espacios: se rechaza'
);
select is((select count(*)::int from dominio.productos), 1, 'el rechazo no deja un producto a medias');

-- SKU vacío → autogenerado, distinto entre productos y con el formato pedido.
select lives_ok(
  $$select public.crear_producto('Sin SKU A', null, null, '{}', 'USD', 10, null),
           public.crear_producto('Sin SKU B', null, '   ', '{}', 'USD', 10, null)$$,
  'dos altas con SKU vacío'
);
select is(
  (select count(*)::int from dominio.productos where sku ~ '^PRD-[0-9A-F]{8}$'), 2,
  'los SKU vacíos se autogeneran con el formato PRD-XXXXXXXX'
);
select is(
  (select count(distinct sku)::int from dominio.productos where nombre like 'Sin SKU%'), 2,
  'los SKU autogenerados son distintos'
);

-- Lote: muchos SKU vacíos a la vez nunca chocan entre sí.
select lives_ok(
  $$insert into dominio.productos (organizacion_id, nombre, precio_lista)
    select '11111111-1111-1111-1111-111111111111', 'Lote ' || n, 1 from generate_series(1, 200) n$$,
  '200 productos con SKU vacío en una sola sentencia'
);
select is(
  (select count(distinct sku)::int from dominio.productos where nombre like 'Lote %'), 200,
  'los 200 SKU autogenerados son distintos'
);

-- Edición.
select lives_ok(
  $$select public.crear_producto('Otro', null, 'XYZ-9', '{}', 'USD', 10, null)$$,
  'alta de un segundo producto con SKU propio'
);
select throws_ok(
  $$update dominio.productos set sku = ' abc-1' where nombre = 'Otro'$$,
  '23505', null, 'editar a un SKU ocupado se rechaza'
);
select lives_ok(
  $$update dominio.productos set sku = '  ' where nombre = 'Otro'$$,
  'editar a SKU vacío'
);
select ok(
  (select sku ~ '^PRD-[0-9A-F]{8}$' from dominio.productos where nombre = 'Otro'),
  'el SKU vaciado en la edición se regenera'
);

-- Concurrencia: el árbitro es el índice único, no una consulta previa.
select is(
  (select indisunique from pg_index where indexrelid = 'dominio.productos_org_sku_uidx'::regclass), true,
  'la unicidad la impone un índice único'
);
select lives_ok(
  $$insert into dominio.productos (organizacion_id, nombre, sku, precio_lista)
    values ('11111111-1111-1111-1111-111111111111', 'Carrera', 'ABC-1', 1)
    on conflict (organizacion_id, lower(btrim(sku))) do nothing$$,
  'la alta que pierde la carrera cae en el conflicto del índice (la otra ya ganó)'
);
select is((select count(*)::int from dominio.productos where nombre = 'Carrera'), 0, 'la perdedora no crea nada');
reset role;

-- Otra organización: el mismo SKU sí se permite.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.crear_producto('De otra org', null, 'ABC-1', '{}', 'USD', 10, null)$$,
  'otra organización puede usar el mismo SKU'
);
reset role;

select * from finish();
rollback;
