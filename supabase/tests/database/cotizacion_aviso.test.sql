-- F-PRE-05 (MSF-305, épica MSF-116) · SC-007: aviso de cotización no cargada.
-- Cubre FR-019: `public.cotizacion_del_dia()` evalúa «hoy» en America/Argentina/Buenos_Aires
-- (borde de medianoche), no cuenta la cotización pendiente, aísla dos organizaciones, respeta los
-- permisos de `cotizacion_dolar` y no es ejecutable por `anon`.
begin;

select plan(21);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'deposito@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

-- cotizacion_dolar: administrador = edición, operador = lectura, deposito = ninguno.
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Medianoche de hoy en Buenos Aires, como instante.
create function pg_temp.inicio_hoy() returns timestamptz language sql stable as $$
  select date_trunc('day', now() at time zone 'America/Argentina/Buenos_Aires') at time zone 'America/Argentina/Buenos_Aires'
$$;

-- ============================================================================
-- Privilegios
-- ============================================================================

select is(has_function_privilege('anon', 'public.cotizacion_del_dia()', 'EXECUTE'), false, 'anon no ejecuta cotizacion_del_dia');
select is(has_function_privilege('authenticated', 'public.cotizacion_del_dia()', 'EXECUTE'), true, 'authenticated ejecuta cotizacion_del_dia');

-- ============================================================================
-- Sin carga confirmada, y la pendiente no cuenta
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is((public.cotizacion_del_dia() ->> 'cargada_hoy')::boolean, false, 'sin historial: no se cargó hoy');
select is(jsonb_typeof(public.cotizacion_del_dia() -> 'valor'), 'null', 'sin carga hoy, el valor es null');
select is(jsonb_typeof(public.cotizacion_del_dia() -> 'cargada_por'), 'null', 'sin carga hoy, quién es null');

select lives_ok($$select public.cargar_cotizacion(1490)$$, 'el administrador deja una cotización pendiente');
select is((public.cotizacion_del_dia() ->> 'cargada_hoy')::boolean, false, 'la pendiente no cuenta como cargada hoy');

-- ============================================================================
-- Borde de medianoche (Buenos Aires)
-- ============================================================================

reset role;
insert into dominio.cotizaciones (organizacion_id, valor, cargada_por_nombre, cargada_en) values
  ('11111111-1111-1111-1111-111111111111', 1465, 'Javier', pg_temp.inicio_hoy() - interval '1 second');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is((public.cotizacion_del_dia() ->> 'cargada_hoy')::boolean, false, 'una carga a las 23:59:59 de ayer (Buenos Aires) no es de hoy');

reset role;
insert into dominio.cotizaciones (organizacion_id, valor, cargada_por_nombre, cargada_en) values
  ('11111111-1111-1111-1111-111111111111', 1480, 'Javier', pg_temp.inicio_hoy());
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is((public.cotizacion_del_dia() ->> 'cargada_hoy')::boolean, true, 'una carga a las 00:00:00 de hoy (Buenos Aires) es de hoy');
select is((public.cotizacion_del_dia() ->> 'valor')::numeric, 1480::numeric, 'devuelve el valor de la carga de hoy');
select is(public.cotizacion_del_dia() ->> 'cargada_por', 'Javier', 'devuelve quién la cargó');
select is(
  (public.cotizacion_del_dia() ->> 'cargada_en')::timestamptz, pg_temp.inicio_hoy(),
  'devuelve cuándo se cargó'
);

reset role;
insert into dominio.cotizaciones (organizacion_id, valor, cargada_por_nombre, cargada_en) values
  ('11111111-1111-1111-1111-111111111111', 1490, 'Lucía', pg_temp.inicio_hoy() + interval '1 second');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is((public.cotizacion_del_dia() ->> 'valor')::numeric, 1490::numeric, 'con varias cargas hoy, vale la más reciente');
select is(public.cotizacion_del_dia() ->> 'cargada_por', 'Lucía', 'con varias cargas hoy, quién es el de la más reciente');

-- ============================================================================
-- Dos organizaciones: aislamiento y carga con fecha de mañana
-- ============================================================================

select pg_temp.como('d2000000-0000-0000-0000-000000000001');

select is(
  (public.cotizacion_del_dia() ->> 'cargada_hoy')::boolean, false,
  'la carga de hoy de la organización Uno no se ve desde la organización Dos'
);

reset role;
insert into dominio.cotizaciones (organizacion_id, valor, cargada_por_nombre, cargada_en) values
  ('22222222-2222-2222-2222-222222222222', 1500, 'Marta', pg_temp.inicio_hoy() + interval '1 day');
select pg_temp.como('d2000000-0000-0000-0000-000000000001');

select is((public.cotizacion_del_dia() ->> 'cargada_hoy')::boolean, false, 'una carga con fecha de mañana no es de hoy');

reset role;
insert into dominio.cotizaciones (organizacion_id, valor, cargada_por_nombre, cargada_en) values
  ('22222222-2222-2222-2222-222222222222', 1510, 'Marta', pg_temp.inicio_hoy() + interval '2 seconds');
select pg_temp.como('d2000000-0000-0000-0000-000000000001');

select is((public.cotizacion_del_dia() ->> 'valor')::numeric, 1510::numeric, 'la organización Dos ve su propia carga de hoy');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is((public.cotizacion_del_dia() ->> 'valor')::numeric, 1490::numeric, 'la organización Uno sigue viendo la suya');

-- ============================================================================
-- Permisos por rol
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is((public.cotizacion_del_dia() ->> 'cargada_hoy')::boolean, true, 'con lectura se puede consultar');

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok($$select public.cotizacion_del_dia()$$, '42501', null, 'sin acceso a cotizacion_dolar: rechazado');

-- anon: sin ejecución.
reset role;
set local role anon;
select throws_ok($$select public.cotizacion_del_dia()$$, '42501', null, 'anon no puede ejecutar cotizacion_del_dia');

select * from finish();
rollback;
