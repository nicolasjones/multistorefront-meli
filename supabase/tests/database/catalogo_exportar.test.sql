-- F-CAT-11 (MSF-382) · SC-201, FR-206/FR-208: `public.exportar_productos` es solo para el Administrador, acota a su
-- organización, rechaza costo/proveedor sin Rentabilidad (42501), pagina estable por id y deja la actividad sin
-- precios ni costos. `anon` no ejecuta.
begin;

select plan(18);

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

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, compatible_con, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 49.90, '{PS5,Switch}', true),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 10, '{}', true),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Cargador', 'CAR-1', 15, '{ps5}', false),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Teclado de otra org', 'TEC-1', 30, '{}', true);
insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 20);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select is(has_function_privilege('anon', 'public.exportar_productos(jsonb, text[], uuid, integer)', 'EXECUTE'), false, 'anon no ejecuta exportar_productos');
select is(has_function_privilege('authenticated', 'public.exportar_productos(jsonb, text[], uuid, integer)', 'EXECUTE'), true, 'authenticated ejecuta exportar_productos');

-- Operador: no es Administrador.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok($$select public.exportar_productos('{}', array['sku'])$$, '42501', null, 'operador: no exporta');
reset role;

-- Administrador de la organización Uno.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is((select (public.exportar_productos('{}', array['sku','nombre']) ->> 'total')::int), 3, 'administrador: total solo de su organización');
select is(
  (select jsonb_array_length(public.exportar_productos('{}', array['sku','nombre']) -> 'filas')), 3,
  'administrador: no recibe filas de otra organización');
select is(
  (select public.exportar_productos('{"todos": true, "busqueda": "zzz"}', array['sku']) ->> 'total')::int, 3,
  '«Todos» ignora los filtros');
select is(
  (select (public.exportar_productos('{"busqueda": "joy"}', array['sku']) ->> 'total')::int), 1,
  'filtrado: busca por nombre o SKU');
select is(
  (select (public.exportar_productos('{"estado": "inactivos"}', array['sku']) ->> 'total')::int), 1,
  'filtrado: solo inactivos');
select is(
  (select (public.exportar_productos('{"compatible": ["PS5"]}', array['sku']) ->> 'total')::int), 2,
  'filtrado: compatible sin distinguir mayúsculas');

-- Columnas: solo las pedidas.
select is(
  ((select public.exportar_productos('{"busqueda": "joy"}', array['sku','precio']) -> 'filas' -> 0) - 'id'),
  '{"sku": "JOY-1", "precio": {"monto": 49.90, "moneda": "USD"}}'::jsonb,
  'devuelve solo las columnas pedidas');
select is(
  (select public.exportar_productos('{"busqueda": "joy"}', array['costo']) -> 'filas' -> 0 -> 'costo' ->> 'monto')::numeric, 20::numeric,
  'administrador con Rentabilidad: recibe el costo');
select throws_ok($$select public.exportar_productos('{}', array['sku','inexistente'])$$, '22023', null, 'columna desconocida');
select throws_ok($$select public.exportar_productos('{}', array['sku'], null, 5000)$$, '22023', null, 'p_limite fuera de rango');

-- Paginación estable por cursor de id.
create temp table pagina1 as select public.exportar_productos('{}', array['sku'], null, 2) as r;
select is(
  (select jsonb_array_length(r -> 'filas') from pagina1), 2, 'paginación: la primera página trae el límite');
select is(
  (select jsonb_array_length(public.exportar_productos('{}', array['sku'], (select (r ->> 'siguiente')::uuid from pagina1), 2) -> 'filas')), 1,
  'paginación: la segunda página trae el resto sin repetir');

-- Actividad: una por exportación (primera página), sin precios ni costos.
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'producto.exportado' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  9, 'actividad: una fila por exportación iniciada, no por página');
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'producto.exportado' and detalle ~ '49|20\.|precio_lista'),
  0, 'actividad: sin valores de precio ni costo');
reset role;

-- Administrador sin Rentabilidad: costo y proveedor se rechazan (42501). El Administrador no se puede restringir
-- por la matriz (constraint), así que se quita la restricción dentro de la transacción (rollback al final) para
-- ejercitar la defensa de la función.
alter table public.permisos_rol drop constraint permisos_rol_administrador_edicion;
insert into permisos_rol (organizacion_id, rol_id, seccion, nivel)
values ('11111111-1111-1111-1111-111111111111', 'administrador', 'rentabilidad', 'ninguno')
on conflict (organizacion_id, rol_id, seccion) do update set nivel = 'ninguno';
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok($$select public.exportar_productos('{}', array['sku','costo'])$$, '42501', null, 'costo sin Rentabilidad: 42501');
reset role;

select * from finish();
rollback;
