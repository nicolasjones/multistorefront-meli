-- Lote 38: vaciar el costo de un producto lo BORRA (`actualizar_producto(..., p_borrar_costo)`).
-- Cubre: nulo sin la marca = «sin cambio», marca = borrado, la contradicción costo + borrar, quién puede borrar
-- (administrador sí; operador sin Rentabilidad no, ni siquiera con la marca), otra organización, el evento de Actividad y anon.
begin;

select plan(13);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, updated_at) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 49.90, '2026-01-01 10:00:00+00');
insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 20);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function pg_temp.act() returns timestamptz language sql security definer as $$
  select updated_at from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001' $$;
grant execute on function pg_temp.act() to authenticated;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- Nulo sin la marca = «sin cambio».
select lives_ok(
  $$select public.actualizar_producto('a1000000-0000-0000-0000-000000000001', pg_temp.act(), 'Joystick', null, 'JOY-1', '{}', 'ARS', 49.9, null)$$,
  'costo nulo sin marca: guarda sin tocar el costo');
select is((select costo from dominio.producto_costos where producto_id = 'a1000000-0000-0000-0000-000000000001'), 20::numeric,
  'el costo sigue igual con nulo sin la marca de borrado');

-- Contradicción.
select throws_ok(
  $$select public.actualizar_producto('a1000000-0000-0000-0000-000000000001', pg_temp.act(), 'Joystick', null, 'JOY-1', '{}', 'ARS', 49.9, 30,
      null, null, false, null, false, null, false, true)$$,
  '22023', 'No se puede cargar y borrar el costo a la vez', 'costo y borrado juntos se rechazan');

-- Operador sin Rentabilidad: ni con la marca.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.actualizar_producto('a1000000-0000-0000-0000-000000000001', pg_temp.act(), 'Joystick', null, 'JOY-1', '{}', 'ARS', 49.9, null,
      null, null, false, null, false, null, false, true)$$,
  '42501', 'Tu rol no puede cargar el costo', 'un rol sin Rentabilidad en edición no puede borrar el costo');

-- Otra organización: el producto no existe para ella y el costo ajeno no se toca.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.actualizar_producto('a1000000-0000-0000-0000-000000000001', '2026-01-01 10:00:00+00', 'X', null, 'X', '{}', 'ARS', 1, null,
      null, null, false, null, false, null, false, true)$$,
  'PT404', 'El producto no existe', 'otra organización no alcanza el producto');

reset role;
select is((select costo from dominio.producto_costos where producto_id = 'a1000000-0000-0000-0000-000000000001'), 20::numeric,
  'tras los rechazos el costo sigue en 20');

-- Administrador con la marca: borra.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.actualizar_producto('a1000000-0000-0000-0000-000000000001', pg_temp.act(), 'Joystick', null, 'JOY-1', '{}', 'ARS', 49.9, null,
      null, null, false, null, false, null, false, true)$$,
  'administrador: borra el costo con la marca');
reset role;
select is((select count(*)::int from dominio.producto_costos where producto_id = 'a1000000-0000-0000-0000-000000000001'), 0,
  'el costo quedó borrado');
select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.precio_actualizado' and detalle = 'Quitó el costo de Joystick'),
  1, 'el borrado deja el evento en Actividad');

-- Borrar un costo inexistente no falla ni genera otro evento.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.actualizar_producto('a1000000-0000-0000-0000-000000000001', pg_temp.act(), 'Joystick', null, 'JOY-1', '{}', 'ARS', 49.9, null,
      null, null, false, null, false, null, false, true)$$,
  'borrar un costo que ya no existe no falla');

reset role;
select is(has_function_privilege('anon', 'private.borrar_costo_producto(uuid,uuid)', 'EXECUTE'), false, 'anon no ejecuta el borrado interno');
select is(has_function_privilege('anon', 'public.actualizar_producto(uuid, timestamptz, text, text, text, text[], text, numeric, numeric, uuid, text, boolean, text, boolean, text, boolean, boolean)', 'EXECUTE'), false, 'anon no ejecuta actualizar_producto');
select is((select p.prosecdef from pg_proc p where p.oid = 'private.borrar_costo_producto(uuid,uuid)'::regprocedure), true, 'el borrado interno es security definer');

select * from finish();
rollback;
