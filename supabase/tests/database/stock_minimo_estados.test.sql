-- F-STK-05 (MSF-194, épica MSF-136): stock mínimo y estados.
-- Cubre SC-004 (estados en los bordes: 0, igual al mínimo, mínimo 0, por encima),
-- permisos por rol (edición vs. lectura vs. sin organización), evento stock.minimo,
-- aislamiento entre dos organizaciones y `anon` sin acceso.
begin;

select plan(25);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('d1000000-0000-0000-0000-000000000009', 'sinorg@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Sin stock', 'P-0', 10),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'En el mínimo', 'P-IGUAL', 10),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Sobre el mínimo', 'P-SOBRE', 10),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Mínimo cero', 'P-MIN0', 10),
  ('a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Bajo el mínimo', 'P-BAJO', 10),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto Dos', 'P-DOS', 10);

-- Fixture de cantidades y mínimos (como postgres; la app solo escribe por RPC).
update dominio.existencias set cantidad = 0, minimo = 5 where producto_id = 'a1000000-0000-0000-0000-000000000001';
update dominio.existencias set cantidad = 5, minimo = 5 where producto_id = 'a1000000-0000-0000-0000-000000000002';
update dominio.existencias set cantidad = 6, minimo = 5 where producto_id = 'a1000000-0000-0000-0000-000000000003';
update dominio.existencias set cantidad = 1, minimo = 0 where producto_id = 'a1000000-0000-0000-0000-000000000004';
update dominio.existencias set cantidad = 2, minimo = 5 where producto_id = 'a1000000-0000-0000-0000-000000000005';

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select is(
  (select minimo from dominio.existencias where producto_id = 'a2000000-0000-0000-0000-000000000001'),
  0, 'el mínimo nace en 0'
);
select throws_ok(
  $$update dominio.existencias set minimo = -1 where producto_id = 'a2000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'la tabla rechaza un mínimo negativo'
);

-- ============================================================================
-- Estados en los bordes (SC-004)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000003');

select is((select estado from public.stock_estados where sku = 'P-0'), 'sin_stock', 'cantidad 0 → sin_stock (aunque haya mínimo)');
select is((select estado from public.stock_estados where sku = 'P-IGUAL'), 'stock_bajo', 'cantidad igual al mínimo → stock_bajo');
select is((select estado from public.stock_estados where sku = 'P-SOBRE'), 'disponible', 'cantidad sobre el mínimo → disponible');
select is((select estado from public.stock_estados where sku = 'P-MIN0'), 'disponible', 'mínimo 0 con stock → disponible');
select is((select estado from public.stock_estados where sku = 'P-BAJO'), 'stock_bajo', 'cantidad bajo el mínimo → stock_bajo');
select is(
  (select cantidad || '|' || minimo || '|' || nombre from public.stock_estados where sku = 'P-BAJO'),
  '2|5|Bajo el mínimo', 'la vista expone cantidad, mínimo y nombre'
);
select is((select count(*)::int from public.stock_estados), 5, 'consulta ve solo los productos de su organización');

-- Consulta no define el mínimo.
select throws_ok(
  $$select public.definir_minimo_stock('a1000000-0000-0000-0000-000000000004', 3)$$,
  '42501', null, 'consulta no puede definir el mínimo'
);
reset role;
select is(
  (select minimo from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000004'),
  0, 'el rechazo no cambió el mínimo'
);

-- ============================================================================
-- Operador define el mínimo
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select lives_ok(
  $$select public.definir_minimo_stock('a1000000-0000-0000-0000-000000000004', 3)$$,
  'operador define el mínimo de un producto'
);
select is((select estado from public.stock_estados where sku = 'P-MIN0'), 'stock_bajo', 'con mínimo 3 y stock 1 pasa a stock_bajo');
select throws_ok(
  $$select public.definir_minimo_stock('a1000000-0000-0000-0000-000000000004', -2)$$,
  '22023', null, 'un mínimo negativo se rechaza'
);
select throws_ok(
  $$select public.definir_minimo_stock('a1000000-0000-0000-0000-000000000004', null)$$,
  '22023', null, 'un mínimo nulo se rechaza'
);
select throws_ok(
  $$select public.definir_minimo_stock('a1000000-0000-0000-0000-0000000000ff', 1)$$,
  '22023', null, 'un producto inexistente se rechaza'
);
select throws_ok(
  $$select public.definir_minimo_stock('a2000000-0000-0000-0000-000000000001', 1)$$,
  '22023', null, 'no se puede definir el mínimo de un producto de otra organización'
);
select throws_ok(
  $$update dominio.existencias set minimo = 99 where producto_id = 'a1000000-0000-0000-0000-000000000004'$$,
  '42501', null, 'la escritura directa del mínimo se rechaza'
);
-- Mismo valor: no genera evento.
select lives_ok(
  $$select public.definir_minimo_stock('a1000000-0000-0000-0000-000000000004', 3)$$,
  'repetir el mismo mínimo no falla'
);
reset role;

select is(
  (select count(*)::int from registro_actividad where tipo = 'stock.minimo'),
  1, 'solo el cambio real registró un evento stock.minimo'
);
select ok(
  exists (select 1 from registro_actividad
           where tipo = 'stock.minimo' and detalle like '%Mínimo cero (SKU P-MIN0)%de 0 a 3%'),
  'el evento nombra el producto y el cambio'
);

-- ============================================================================
-- Aislamiento y sin organización
-- ============================================================================

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.stock_estados), 1, 'organización dos ve solo su producto');
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000009');
select is((select count(*)::int from public.stock_estados), 0, 'sin organización no ve filas');
reset role;

-- ============================================================================
-- anon
-- ============================================================================

select is(has_table_privilege('anon', 'public.stock_estados', 'SELECT'), false, 'anon no lee stock_estados');
select is(
  has_function_privilege('anon', 'public.definir_minimo_stock(uuid, integer)', 'EXECUTE'),
  false, 'anon no ejecuta definir_minimo_stock'
);

select * from finish();

rollback;
