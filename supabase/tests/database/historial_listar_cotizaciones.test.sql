-- MSF-322 (F-VTA-39, SC-006): listar_historial_cotizaciones.
-- Cubre: búsqueda por fecha (dd/mm/aaaa, aaaa-mm-dd y partes, literal), orden, paginación y tope,
-- globales sin tienda, aislamiento por organización y por sección de `ventas`, `anon` sin ejecución.
begin;

select plan(16);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000011', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000012', 'mostrador-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000013', 'deposito-uno@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'miembro'),
  ('d1000000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'miembro');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'San Javucho');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000012', 'a1000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'mostrador'),
  ('d1000000-0000-0000-0000-000000000013', 'a1000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'deposito');
insert into usuario_empresa_activa (user_id, empresa_id) values
  ('d1000000-0000-0000-0000-000000000012', 'a1000000-0000-0000-0000-0000000000a1'),
  ('d1000000-0000-0000-0000-000000000013', 'a1000000-0000-0000-0000-0000000000a1');

insert into dominio.historial_cotizaciones_dolar (organizacion_id, fecha, dolar_comprador, dolar_vendedor, cargado_por) values
  ('11111111-1111-1111-1111-111111111111', '2020-01-10', 59.5, 63.5, 'Javier'),
  ('11111111-1111-1111-1111-111111111111', '2020-03-05', 64.25, 68.75, 'Emilse'),
  ('11111111-1111-1111-1111-111111111111', '2020-03-25', 65, 70, null),
  ('22222222-2222-2222-2222-222222222222', '2020-03-25', 999, 999, 'Otra Org');

-- 230 cotizaciones más (una por día) para probar paginación y tope.
insert into dominio.historial_cotizaciones_dolar (organizacion_id, fecha, dolar_comprador, dolar_vendedor)
select '11111111-1111-1111-1111-111111111111', date '2018-01-01' + g, 10, 11 from generate_series(1, 230) g;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('d1000000-0000-0000-0000-000000000011');

select is(
  (select total_filas::int from public.listar_historial_cotizaciones(null, 1, 1)), 233,
  'el total cuenta las cotizaciones de la organización y ninguna otra'
);

select is(
  (select dolar_comprador from public.listar_historial_cotizaciones('05/03/2020')), 64.25,
  'busca por fecha completa en dd/mm/aaaa'
);

select is(
  (select cargado_por from public.listar_historial_cotizaciones('2020-01-10')), 'Javier',
  'busca por fecha en aaaa-mm-dd'
);

select is(
  (select count(*)::int from public.listar_historial_cotizaciones('/03/2020')), 2,
  'busca por parte de la fecha (mes/año)'
);

select is(
  (select count(*)::int from public.listar_historial_cotizaciones('%')), 0,
  'el % se busca literal y no es comodín'
);

select is(
  (select count(*)::int from public.listar_historial_cotizaciones('_')), 0,
  'el _ se busca literal y no es comodín'
);

select is(
  (select count(*)::int from public.listar_historial_cotizaciones('31/12/2099')), 0,
  'una fecha sin cotizaciones devuelve cero filas'
);

select is(
  (select fecha::text from public.listar_historial_cotizaciones(null, 1, 1)), '2020-03-25',
  'orden por fecha descendente (la más nueva primero)'
);

select is(
  (select count(*)::int from public.listar_historial_cotizaciones(null, 1, 1000)), 200,
  'el tamaño de página tiene tope 200'
);

select is(
  (select count(*)::int from public.listar_historial_cotizaciones(null, 2, 200)), 33,
  'la segunda página trae el resto'
);

select is(
  (select count(*)::int from public.listar_historial_cotizaciones(null, 99, 200)), 0,
  'una página fuera de rango no devuelve filas'
);

-- Globales: un miembro con otra tienda asignada ve las mismas, sin filtro de empresa.
select pg_temp.como('d1000000-0000-0000-0000-000000000012');

select is(
  (select total_filas::int from public.listar_historial_cotizaciones(null, 1, 1)), 233,
  'mostrador ve las cotizaciones globales de la organización (sin tienda)'
);

-- Sin nivel en la sección ventas.
reset role;
insert into public.permisos_rol (organizacion_id, rol_id, seccion, nivel) values
  ('11111111-1111-1111-1111-111111111111', 'deposito', 'ventas', 'ninguno')
on conflict (organizacion_id, rol_id, seccion) do update set nivel = excluded.nivel;
select pg_temp.como('d1000000-0000-0000-0000-000000000013');

select is(
  (select count(*)::int from public.listar_historial_cotizaciones()), 0,
  'sin nivel en la sección ventas la base no devuelve filas'
);

reset role;

select ok(
  has_function_privilege('authenticated', 'public.listar_historial_cotizaciones(text, integer, integer)', 'execute'),
  'authenticated ejecuta la RPC'
);

set local role anon;

select throws_ok(
  $$ select * from public.listar_historial_cotizaciones() $$,
  '42501', null, 'anon no ejecuta listar_historial_cotizaciones'
);

reset role;

select ok(
  (select bool_and(p.prosecdef = false) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'listar_historial_cotizaciones'),
  'la RPC es security invoker (rige la RLS del llamador)'
);

select * from finish();
rollback;
