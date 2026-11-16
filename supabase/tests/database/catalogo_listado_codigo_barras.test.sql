-- F-CAT-14 (MSF-350) · FR-012, SC-003: `v_productos_listado` expone `codigo_barras` solo de la propia
-- organización, no expone costo, `anon` no la lee y la búsqueda exacta usa el índice único existente.
begin;

select plan(8);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, codigo_barras) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Con código', 'CB-1', 10, '7790001000015'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Sin código', 'CB-2', 10, null),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Otra organización', 'CB-3', 10, '7790001000022');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select is(has_table_privilege('anon', 'public.v_productos_listado', 'SELECT'), false, 'anon no lee la vista');
select is(has_table_privilege('authenticated', 'public.v_productos_listado', 'SELECT'), true, 'authenticated lee la vista');
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
    where table_schema = 'public' and table_name = 'v_productos_listado' and column_name in ('disponibilidad', 'codigo_barras')),
  array['disponibilidad', 'codigo_barras'], 'codigo_barras se suma al final, después de disponibilidad');
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'v_productos_listado' and column_name ~* 'costo|margen'),
  0, 'la vista no expone costo ni margen');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is(
  (select jsonb_object_agg(sku, codigo_barras) from public.v_productos_listado),
  '{"CB-1": "7790001000015", "CB-2": null}'::jsonb,
  'la vista expone el código de barras solo de la propia organización');
select is(
  (select nombre from public.v_productos_listado where codigo_barras = '7790001000015'),
  'Con código', 'la coincidencia exacta devuelve el producto');
select is(
  (select count(*)::int from public.v_productos_listado where codigo_barras = '7790001000022'),
  0, 'el código de otra organización no se resuelve');
select is(
  (select count(*)::int from public.v_productos_listado where codigo_barras = '0000000000000'),
  0, 'un código inexistente no devuelve filas');

select * from finish();
rollback;
