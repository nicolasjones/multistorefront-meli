-- F-CAT-04 (MSF-460, épica MSF-456): edición de producto.
-- Cubre FR-009/FR-010: el Operador no cambia el costo, Consulta no actualiza,
-- conflicto de edición concurrente (bloqueo optimista por updated_at), evento
-- `producto.editado` solo con cambios reales y sin costo, aislamiento y privilegios.
begin;

select plan(27);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, updated_at) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 49.90, '2026-01-01 10:00:00+00'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 10, '2026-01-01 10:00:00+00');
insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 20);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Administrador: edita y cambia el costo
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.actualizar_producto('a1000000-0000-0000-0000-000000000001', '2026-01-01 10:00:00+00',
      '  Joystick Pro ', 'Nuevo', 'JOY-2', array['PS5'], 'ARS', 99.5, 30)$$,
  'administrador: edita datos y costo'
);
select is(
  (select nombre || '|' || sku || '|' || moneda || '|' || precio_lista::text from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'),
  'Joystick Pro|JOY-2|ARS|99.50', 'los cambios persisten (nombre recortado)'
);
select is((select costo from dominio.producto_costos where producto_id = 'a1000000-0000-0000-0000-000000000001'), 30::numeric, 'el costo se actualizó');
select isnt(
  (select updated_at from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'),
  '2026-01-01 10:00:00+00'::timestamptz, 'updated_at avanzó'
);

-- Conflicto: se reusa el updated_at viejo.
select throws_ok(
  $$select public.actualizar_producto('a1000000-0000-0000-0000-000000000001', '2026-01-01 10:00:00+00',
      'Pisado', null, 'JOY-2', '{}', 'ARS', 99.5, null)$$,
  '40001', null, 'conflicto: updated_at desactualizado se rechaza'
);
select is((select nombre from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'), 'Joystick Pro', 'el conflicto no pisó nada');

-- Cambio solo de costo: avanza updated_at y registra evento.
select lives_ok(
  $$select public.actualizar_producto(id, updated_at, nombre, descripcion, sku, compatible_con, moneda, precio_lista, 45)
    from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'$$,
  'administrador: cambio solo de costo'
);
select is((select costo from dominio.producto_costos where producto_id = 'a1000000-0000-0000-0000-000000000001'), 45::numeric, 'costo 45');

-- Sin cambios reales: no avanza updated_at ni registra evento.
create temp table antes as
  select updated_at from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001';
grant select on antes to authenticated;
select lives_ok(
  $$select public.actualizar_producto(id, updated_at, nombre, descripcion, sku, compatible_con, moneda, precio_lista, 45)
    from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'$$,
  'administrador: guardar sin cambios no falla'
);
select is(
  (select updated_at from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'),
  (select updated_at from antes), 'sin cambios reales updated_at no avanza'
);
reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.editado'),
  2, 'solo las dos ediciones reales dejaron producto.editado'
);
select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.editado' and (detalle like '%30%' or detalle like '%45%' or detalle like '%99%')),
  0, 'el detalle de Actividad no incluye costo ni precio'
);

-- ============================================================================
-- Validaciones
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- Producto inexistente: P0002.
select throws_ok(
  $$select public.actualizar_producto('a1999999-0000-0000-0000-000000000999', now(),
      'X', null, 'X-1', '{}', 'ARS', 1, null)$$,
  'P0002', null, 'producto inexistente: P0002'
);

-- Doble edición en la misma transacción (now() constante): la 2.ª avanza updated_at y deja evento.
create temp table ed1 as
  select updated_at from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001';
grant select on ed1 to authenticated;
select lives_ok(
  $$select public.actualizar_producto(id, updated_at, 'Joystick Pro A', descripcion, sku, compatible_con, moneda, precio_lista, null)
    from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'$$,
  'doble edición: primera'
);
create temp table ed2 as
  select updated_at from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001';
grant select on ed2 to authenticated;
select lives_ok(
  $$select public.actualizar_producto(id, updated_at, 'Joystick Pro B', descripcion, sku, compatible_con, moneda, precio_lista, null)
    from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'$$,
  'doble edición: segunda en la misma transacción'
);
select ok(
  (select updated_at from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001')
    > (select updated_at from ed2) and (select updated_at from ed2) > (select updated_at from ed1),
  'updated_at avanza estrictamente en cada edición de la misma transacción'
);
select throws_ok(
  $$select public.actualizar_producto(id, updated_at, '   ', null, null, '{}', 'USD', 10, null) from dominio.productos where sku = 'CAB-1'$$,
  '22023', null, 'nombre vacío: rechazado'
);
select throws_ok(
  $$select public.actualizar_producto(id, updated_at, 'Cable', null, null, '{}', 'USD', 0, null) from dominio.productos where sku = 'CAB-1'$$,
  '22023', null, 'precio cero: rechazado'
);
select throws_ok(
  $$select public.actualizar_producto('a1000000-0000-0000-0000-0000000000ff', now(), 'X', null, null, '{}', 'USD', 10, null)$$,
  'P0002', null, 'producto inexistente: rechazado'
);
reset role;

-- ============================================================================
-- Operador: edita sin costo; no lo cambia
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select lives_ok(
  $$select public.actualizar_producto(id, updated_at, 'Cable HDMI', null, 'CAB-1', '{}', 'USD', 12, null) from dominio.productos where sku = 'CAB-1'$$,
  'operador: edita sin costo'
);
select throws_ok(
  $$select public.actualizar_producto(id, updated_at, 'Cable HDMI', null, 'CAB-1', '{}', 'USD', 12, 1) from dominio.productos where sku = 'CAB-1'$$,
  '42501', null, 'operador: enviar costo por la RPC se rechaza'
);
reset role;
select is((select costo from dominio.producto_costos where producto_id = 'a1000000-0000-0000-0000-000000000001'), 45::numeric, 'el costo del operador no cambió nada');

-- ============================================================================
-- Consulta y otra organización
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.actualizar_producto(id, updated_at, 'Hack', null, null, '{}', 'USD', 1, null) from dominio.productos where sku = 'CAB-1'$$,
  '42501', null, 'consulta: no actualiza por la RPC'
);
reset role;

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.actualizar_producto('a1000000-0000-0000-0000-000000000002', now(), 'Intruso', null, null, '{}', 'USD', 1, null)$$,
  'P0002', null, 'otra organización: no ve ni edita productos ajenos'
);
reset role;
select is((select nombre from dominio.productos where sku = 'CAB-1'), 'Cable HDMI', 'el producto ajeno quedó intacto');

-- ============================================================================
-- Privilegios
-- ============================================================================

select is(has_function_privilege('anon', 'public.actualizar_producto(uuid, timestamptz, text, text, text, text[], text, numeric, numeric)', 'EXECUTE'), false, 'anon no ejecuta actualizar_producto');
select is(has_function_privilege('authenticated', 'public.actualizar_producto(uuid, timestamptz, text, text, text, text[], text, numeric, numeric)', 'EXECUTE'), true, 'authenticated ejecuta actualizar_producto');

select * from finish();

rollback;
