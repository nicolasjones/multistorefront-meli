-- F-TDA-18 (MSF-332, épica MSF-167): disponibilidad visible de la tienda pública.
-- Verifica FR-020, FR-021 y FR-023 (SC-009): paridad de private.disponible_publico con
-- private.productos_con_stock() bajo la sesión de la organización, producto sin existencias,
-- `anon`/`authenticated` sin `execute` y ninguna función `publico` que exponga cantidades.
-- El fixture corre como postgres (RLS no aplica) y la paridad como "authenticated".
begin;

select plan(13);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Con stock', 'CON-1', 10, 'USD', true),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'En cero', 'CER-1', 10, 'USD', true),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Con stock bajo', 'BAJ-1', 10, 'USD', true),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Ajeno con stock', 'AJE-1', 10, 'USD', true);

update dominio.existencias set cantidad = 7 where producto_id = 'a1000000-0000-0000-0000-000000000001';
update dominio.existencias set cantidad = 1 where producto_id = 'a1000000-0000-0000-0000-000000000003';
update dominio.existencias set cantidad = 5 where producto_id = 'b2000000-0000-0000-0000-000000000001';

-- ============================================================================
-- Privilegios (FR-020, FR-023)
-- ============================================================================

select is(has_function_privilege('anon', 'private.disponible_publico(uuid)', 'execute'), false, 'anon no ejecuta disponible_publico');
select is(has_function_privilege('authenticated', 'private.disponible_publico(uuid)', 'execute'), false, 'authenticated no ejecuta disponible_publico');
select is(
  (select prorettype::regtype::text from pg_proc where oid = 'private.disponible_publico(uuid)'::regprocedure),
  'boolean', 'devuelve solo un booleano (FR-023)'
);

-- ============================================================================
-- Valores (FR-020, FR-021)
-- ============================================================================

select is(private.disponible_publico('a1000000-0000-0000-0000-000000000001'), true, 'con unidades: disponible');
select is(private.disponible_publico('a1000000-0000-0000-0000-000000000003'), true, 'con una sola unidad: disponible');
select is(private.disponible_publico('a1000000-0000-0000-0000-000000000002'), false, 'sin existencias (cantidad 0): no disponible');
select is(private.disponible_publico('a1000000-0000-0000-0000-0000000000ff'), false, 'producto inexistente: no disponible');
select is(private.disponible_publico(null), false, 'nulo: no disponible');

update dominio.existencias set cantidad = 0 where producto_id = 'a1000000-0000-0000-0000-000000000003';
select is(private.disponible_publico('a1000000-0000-0000-0000-000000000003'), false, 'al agotarse pasa a no disponible');

-- La disponibilidad manual no cuenta (D6): sin stock sigue «Sin stock» aunque sea a pedido.
update dominio.productos set disponibilidad_manual = 'a_pedido' where id = 'a1000000-0000-0000-0000-000000000002';
select is(private.disponible_publico('a1000000-0000-0000-0000-000000000002'), false, 'a_pedido manual se ignora');

-- ============================================================================
-- Paridad con productos_con_stock() bajo la sesión de la organización (FR-020)
-- ============================================================================

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;

create temp table con_stock (id uuid);
grant all on con_stock to authenticated;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
insert into con_stock select * from private.productos_con_stock();
reset role;

select results_eq(
  $$ select p.id from dominio.productos p
      where p.organizacion_id = '11111111-1111-1111-1111-111111111111' and private.disponible_publico(p.id)
      order by p.id $$,
  $$ select id from con_stock order by id $$,
  'mismo conjunto de productos disponibles que productos_con_stock()'
);
select is((select count(*)::int from con_stock), 1, 'solo el producto con unidades queda disponible');

-- ============================================================================
-- Ninguna función pública expone cantidades (FR-023)
-- ============================================================================

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'publico' and p.prokind = 'f'
      and pg_get_function_result(p.oid) ~* '(cantidad|existencia|stock_actual|minimo)'),
  0, 'ninguna función publico devuelve columnas de cantidad'
);

select * from finish();
rollback;
