-- F-PRE-02 (MSF-246, épica MSF-116) · SC-001: carga diaria de la cotización del dólar.
-- Cubre FR-001…FR-004 con dos organizaciones: aislamiento, permisos por rol (edición /
-- lectura / ninguno), validación del valor, reemplazo de la pendiente, vencimiento a 24 h al
-- consultar, historial sin escritura directa y `anon` sin ejecución ni acceso.
-- `rls_en_toda_tabla` cubre además que las tablas nuevas tengan RLS.
begin;

select plan(52);

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

-- Org 1: 2 productos USD activos, 1 USD inactivo, 1 ARS → «productos con precio en USD» = 2.
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'USD', 20, true),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Case', 'CAS-1', 'USD', 10, true),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Viejo', 'VIE-1', 'USD', 5, false),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 'ARS', 1000, true);
insert into dominio.cotizacion_inicial (organizacion_id, valor) values
  ('11111111-1111-1111-1111-111111111111', 1465);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Estructura y privilegios (FR-001)
-- ============================================================================

select ok((select relrowsecurity from pg_class where oid = 'dominio.cotizacion_pendiente'::regclass), 'cotizacion_pendiente tiene RLS activado');
select ok((select relrowsecurity from pg_class where oid = 'dominio.cotizaciones'::regclass), 'cotizaciones tiene RLS activado');
select is(has_table_privilege('anon', 'dominio.cotizacion_pendiente', 'SELECT'), false, 'anon no lee cotizacion_pendiente');
select is(has_table_privilege('anon', 'dominio.cotizaciones', 'SELECT'), false, 'anon no lee cotizaciones');
select is(has_table_privilege('authenticated', 'dominio.cotizaciones', 'INSERT'), false, 'authenticated no inserta en cotizaciones');
select is(has_table_privilege('authenticated', 'dominio.cotizaciones', 'UPDATE'), false, 'authenticated no actualiza cotizaciones');
select is(has_table_privilege('authenticated', 'dominio.cotizaciones', 'DELETE'), false, 'authenticated no borra de cotizaciones');
select is(has_function_privilege('anon', 'public.cargar_cotizacion(numeric)', 'EXECUTE'), false, 'anon no ejecuta cargar_cotizacion');
select is(has_function_privilege('anon', 'public.estado_cotizacion()', 'EXECUTE'), false, 'anon no ejecuta estado_cotizacion');
select is(has_function_privilege('authenticated', 'public.cargar_cotizacion(numeric)', 'EXECUTE'), true, 'authenticated ejecuta cargar_cotizacion');
select is(has_function_privilege('authenticated', 'public.estado_cotizacion()', 'EXECUTE'), true, 'authenticated ejecuta estado_cotizacion');

-- ============================================================================
-- Administrador (org 1): estado inicial y carga
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is(
  (select (public.estado_cotizacion() -> 'vigente' ->> 'valor')::numeric),
  1465::numeric, 'sin historial, la vigente es la cotización inicial'
);
select is(
  (select jsonb_typeof(public.estado_cotizacion() -> 'vigente' -> 'cargada_por')),
  'null', 'la cotización inicial no tiene quién la cargó'
);
select is((select (public.estado_cotizacion() ->> 'productos_usd')::int), 2, 'productos con precio en USD: solo los activos en USD');
select is((select jsonb_typeof(public.estado_cotizacion() -> 'pendiente')), 'null', 'sin carga, no hay pendiente');

select is(
  (select (public.cargar_cotizacion(1490) ->> 'anterior')::numeric),
  1465::numeric, 'cargar 1490: el anterior es la cotización inicial'
);
select is(
  (select (public.cargar_cotizacion(1490) ->> 'variacion_pct')::numeric),
  1.7065::numeric, 'cargar 1490 sobre 1465: variación +1,7 %'
);
select is(
  (select (public.estado_cotizacion() -> 'pendiente' ->> 'valor')::numeric),
  1490::numeric, 'la carga queda como pendiente'
);
select is(
  (select (public.estado_cotizacion() -> 'vigente' ->> 'valor')::numeric),
  1465::numeric, 'cargar no cambia la vigente (ningún precio se mueve)'
);

-- Reemplazo: una sola pendiente por organización.
select lives_ok($$select public.cargar_cotizacion(1500.5)$$, 'volver a cargar acepta decimales');
select is((select count(*)::int from dominio.cotizacion_pendiente), 1, 'volver a cargar reemplaza: una sola pendiente');
select is((select valor from dominio.cotizacion_pendiente), 1500.5::numeric, 'la pendiente es el último valor cargado');
select is(
  (select cargada_por from dominio.cotizacion_pendiente),
  'd1000000-0000-0000-0000-000000000001'::uuid, 'la pendiente guarda quién la cargó'
);

-- Validación del valor.
select throws_ok($$select public.cargar_cotizacion(0)$$, '23514', null, 'cero: rechazado');
select throws_ok($$select public.cargar_cotizacion(-5)$$, '23514', null, 'negativo: rechazado');
select throws_ok($$select public.cargar_cotizacion(null)$$, '23514', null, 'nulo: rechazado');
select throws_ok($$select public.cargar_cotizacion('NaN'::numeric)$$, '23514', null, 'NaN: rechazado');
select throws_ok($$select public.cargar_cotizacion(1465.00001)$$, '23514', null, 'más de 4 decimales: rechazado');
select throws_ok($$select public.cargar_cotizacion(10000000000)$$, '22003', null, 'fuera de rango: rechazado');
select is((select valor from dominio.cotizacion_pendiente), 1500.5::numeric, 'un valor inválido no pisa la pendiente');

-- Escritura directa: los tiempos y el historial no se tocan por la API.
select throws_ok(
  $$update dominio.cotizacion_pendiente set expira_en = now() + interval '30 days'$$,
  '42501', null, 'no se puede extender el vencimiento por la API'
);
select throws_ok(
  $$insert into dominio.cotizaciones (organizacion_id, valor, cargada_por_nombre)
    values ('11111111-1111-1111-1111-111111111111', 1600, 'Falso')$$,
  '42501', null, 'el historial no admite insert directo'
);

-- ============================================================================
-- Vencimiento a las 24 h: se resuelve al consultar
-- ============================================================================

reset role;
update dominio.cotizacion_pendiente
  set cargada_en = now() - interval '25 hours', expira_en = now() - interval '1 hour'
  where organizacion_id = '11111111-1111-1111-1111-111111111111';
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is(
  (select jsonb_typeof(public.estado_cotizacion() -> 'pendiente')),
  'null', 'una pendiente de más de 24 h se trata como inexistente'
);
select lives_ok($$select public.cargar_cotizacion(1495)$$, 'volver a cargar tras vencer renueva la pendiente');
select is(
  (select (public.estado_cotizacion() -> 'pendiente' ->> 'valor')::numeric),
  1495::numeric, 'la nueva pendiente vuelve a estar vigente'
);
select ok(
  (select expira_en > now() + interval '23 hours' from dominio.cotizacion_pendiente),
  'la nueva pendiente vence en ~24 h'
);

-- ============================================================================
-- Vigente = última confirmada (historial cargado por el sistema)
-- ============================================================================

reset role;
insert into dominio.cotizaciones (organizacion_id, valor, valor_anterior, variacion_pct, cargada_por_nombre, cargada_en)
values
  ('11111111-1111-1111-1111-111111111111', 1470, 1465, 0.3413, 'Javier', now() - interval '2 days'),
  ('11111111-1111-1111-1111-111111111111', 1480, 1470, 0.6803, 'Emilse', now() - interval '1 day');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is((select (public.estado_cotizacion() -> 'vigente' ->> 'valor')::numeric), 1480::numeric, 'la vigente es la última confirmada');
select is((select public.estado_cotizacion() -> 'vigente' ->> 'cargada_por'), 'Emilse', 'la vigente dice quién la cargó');
select is(
  (select (public.cargar_cotizacion(1500) ->> 'anterior')::numeric),
  1480::numeric, 'el anterior de una carga nueva es la última confirmada'
);

-- ============================================================================
-- Operador (lectura): ve el estado, no carga ni ve la pendiente
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select throws_ok($$select public.cargar_cotizacion(1500)$$, '42501', null, 'lectura: no puede cargar');
select is((select (public.estado_cotizacion() -> 'vigente' ->> 'valor')::numeric), 1480::numeric, 'lectura: ve la vigente');
select is((select jsonb_typeof(public.estado_cotizacion() -> 'pendiente')), 'null', 'lectura: no ve la pendiente de otro');
select is((select count(*)::int from dominio.cotizaciones), 2, 'lectura: ve el historial de su organización');

-- ============================================================================
-- Depósito (ninguno): sin acceso
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000003');

select throws_ok($$select public.estado_cotizacion()$$, '42501', null, 'ninguno: no ve el estado');
select throws_ok($$select public.cargar_cotizacion(1500)$$, '42501', null, 'ninguno: no puede cargar');
select is((select count(*)::int from dominio.cotizaciones), 0, 'ninguno: el historial viene vacío');

-- ============================================================================
-- Aislamiento: la organización 2 no ve ni toca lo de la 1
-- ============================================================================

select pg_temp.como('d2000000-0000-0000-0000-000000000001');

select is((select jsonb_typeof(public.estado_cotizacion() -> 'vigente')), 'null', 'org 2: sin cotización inicial ni historial, sin vigente');
select is((select (public.estado_cotizacion() ->> 'productos_usd')::int), 0, 'org 2: no cuenta los productos de la org 1');
select is((select count(*)::int from dominio.cotizacion_pendiente), 0, 'org 2: no ve la pendiente de la org 1');
select is((select count(*)::int from dominio.cotizaciones), 0, 'org 2: no ve el historial de la org 1');
select is(
  (select public.cargar_cotizacion(1000) ->> 'anterior'),
  null, 'org 2: sin cotización previa, no hay anterior'
);

reset role;
select is(
  (select valor from dominio.cotizacion_pendiente where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1500::numeric, 'cargar en la org 2 no pisa la pendiente de la org 1'
);

select * from finish();
rollback;
