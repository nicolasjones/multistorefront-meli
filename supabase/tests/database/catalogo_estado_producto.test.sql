-- F-CAT-06 (MSF-462, épica MSF-456): estado activo / inactivo de un producto.
-- Cubre FR-015/FR-016/SC-005: desactivar y reactivar conserva todos los datos y el costo,
-- Consulta no cambia el estado (ni por la RPC ni por UPDATE directo), eventos
-- `producto.activado|desactivado` sin costo ni precio, idempotencia, aislamiento y privilegios.
-- Las imágenes (F-CAT-05) no existen todavía en esta rama: el cambio de estado solo escribe
-- la columna `activo`, así que no toca ninguna otra tabla.
begin;

select plan(20);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.productos (id, organizacion_id, nombre, sku, descripcion, compatible_con, moneda, precio_lista, updated_at) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'Inalámbrico', array['PS5', 'PC'], 'USD', 49.90, '2026-01-01 10:00:00+00');
insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 20);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function pg_temp.datos() returns text language sql as $$
  select nombre || '|' || sku || '|' || descripcion || '|' || array_to_string(compatible_con, ',') || '|' || moneda || '|' || precio_lista::text
    || '|' || (select costo::text from dominio.producto_costos where producto_id = p.id)
  from dominio.productos p where id = 'a1000000-0000-0000-0000-000000000001'
$$;

-- ============================================================================
-- Administrador: desactiva y reactiva sin perder nada
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.cambiar_estado_producto('a1000000-0000-0000-0000-000000000001', false)$$,
  'administrador: desactiva el producto'
);
select is((select activo from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'), false, 'queda inactivo');
select is(pg_temp.datos(), 'Joystick|JOY-1|Inalámbrico|PS5,PC|USD|49.90|20.00', 'conserva todos sus datos y el costo');
reset role;
select isnt(
  (select updated_at from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'),
  '2026-01-01 10:00:00+00'::timestamptz, 'el cambio de estado avanza updated_at'
);
select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.desactivado'
     and detalle = 'Desactivó el producto Joystick (SKU JOY-1)'),
  1, 'registra producto.desactivado sin costo ni precio'
);

-- Idempotente: pedir el mismo estado no escribe ni duplica el evento.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.cambiar_estado_producto('a1000000-0000-0000-0000-000000000001', false)$$,
  'pedir el estado actual no falla'
);
reset role;
select is((select count(*)::int from registro_actividad where tipo = 'producto.desactivado'), 1, 'sin evento duplicado');
select is((select count(*)::int from registro_actividad where tipo = 'producto.editado'), 0, 'el cambio de estado no cuenta como edición');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.cambiar_estado_producto('a1000000-0000-0000-0000-000000000001', true)$$,
  'administrador: reactiva el producto'
);
select is((select activo from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'), true, 'vuelve a activo');
select is(pg_temp.datos(), 'Joystick|JOY-1|Inalámbrico|PS5,PC|USD|49.90|20.00', 'desactivar y reactivar conserva el 100 % de los datos (SC-005)');
reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.activado'
     and detalle = 'Activó el producto Joystick (SKU JOY-1)'),
  1, 'registra producto.activado'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.cambiar_estado_producto('a1000000-0000-0000-0000-000000000001', null)$$,
  '22023', null, 'el estado es obligatorio'
);
reset role;

-- ============================================================================
-- Consulta y otra organización
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.cambiar_estado_producto('a1000000-0000-0000-0000-000000000001', false)$$,
  '42501', null, 'consulta: no cambia el estado por la RPC'
);
select lives_ok(
  $$update dominio.productos set activo = false where id = 'a1000000-0000-0000-0000-000000000001'$$,
  'consulta: el UPDATE directo no falla pero RLS no le deja filas'
);
reset role;
select is((select activo from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'), true, 'el producto sigue activo tras los intentos de Consulta');

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.cambiar_estado_producto('a1000000-0000-0000-0000-000000000001', false)$$,
  'P0002', null, 'otra organización: no ve ni cambia productos ajenos'
);
reset role;
select is((select activo from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'), true, 'el producto ajeno quedó intacto');

-- ============================================================================
-- Privilegios
-- ============================================================================

select is(has_function_privilege('anon', 'public.cambiar_estado_producto(uuid, boolean)', 'EXECUTE'), false, 'anon no ejecuta cambiar_estado_producto');
select is(has_function_privilege('authenticated', 'public.cambiar_estado_producto(uuid, boolean)', 'EXECUTE'), true, 'authenticated ejecuta cambiar_estado_producto');

select * from finish();

rollback;
