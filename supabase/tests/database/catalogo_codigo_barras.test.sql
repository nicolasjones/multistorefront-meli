-- MSF-529 (seguimiento de MSF-205): código de barras del producto.
-- Cubre: guardar y editar, 13 dígitos, único por organización (otra puede repetirlo),
-- "sin cambio" por defecto en actualizar_producto y permisos de las RPC (anon no ejecuta).
begin;

select plan(11);

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

select is(
  (select codigo_barras from public.crear_producto('Con código', null, 'CB-1', '{}', 'USD', 10, null, null, null, ' 7790001000015 ')),
  '7790001000015', 'el alta guarda el código de barras (sin espacios extremos)');
select is(
  (select codigo_barras from public.crear_producto('Sin código', null, 'CB-2', '{}', 'USD', 10)),
  null, 'el código de barras es opcional');

select throws_ok(
  $$select public.crear_producto('Corto', null, 'CB-3', '{}', 'USD', 10, null, null, null, '12345')$$,
  '22023', 'El código de barras debe tener 13 dígitos', 'rechaza un código que no tiene 13 dígitos');
select throws_ok(
  $$select public.crear_producto('Letras', null, 'CB-4', '{}', 'USD', 10, null, null, null, '77900010000AB')$$,
  '22023', 'El código de barras debe tener 13 dígitos', 'rechaza un código con letras');
select throws_ok(
  $$select public.crear_producto('Repetido', null, 'CB-5', '{}', 'USD', 10, null, null, null, '7790001000015')$$,
  '23505', null, 'rechaza un código repetido en la misma organización');

create temp table cb as select id, updated_at from dominio.productos where sku = 'CB-1';
grant select on cb to authenticated;

select is(
  (select codigo_barras from public.actualizar_producto((select id from cb), (select updated_at from cb), 'Con código', null, 'CB-1', '{}', 'USD', 10)),
  '7790001000015', 'actualizar sin p_cambiar_codigo_barras conserva el código');
select is(
  (select codigo_barras from public.actualizar_producto(
    (select id from dominio.productos where sku = 'CB-1'), (select updated_at from dominio.productos where sku = 'CB-1'),
    'Con código', null, 'CB-1', '{}', 'USD', 10, null, null, null, false, '7790001000022', true)),
  '7790001000022', 'actualizar con p_cambiar_codigo_barras reemplaza el código');
select is(
  (select codigo_barras from public.actualizar_producto(
    (select id from dominio.productos where sku = 'CB-1'), (select updated_at from dominio.productos where sku = 'CB-1'),
    'Con código', null, 'CB-1', '{}', 'USD', 10, null, null, null, false, null, true)),
  null, 'con p_cambiar_codigo_barras y nulo se quita el código');

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.crear_producto('Otra org', null, 'CB-1', '{}', 'USD', 10, null, null, null, '7790001000022')$$,
  'otra organización puede usar el mismo código');

reset role;
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('crear_producto', 'actualizar_producto')
      and has_function_privilege('anon', p.oid, 'execute')),
  0, 'anon no ejecuta crear_producto ni actualizar_producto');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('crear_producto', 'actualizar_producto')),
  2, 'una sola firma de cada RPC (sin sobrecargas ambiguas)');

select * from finish();
rollback;
