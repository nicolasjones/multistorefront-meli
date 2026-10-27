-- F-REN-07 (MSF-280, épica MSF-127): historia de costos y margen con la cotización de cada fecha.
-- Cubre FR-009..FR-012 / SC-004: disparador (alta, cambio, mismo costo sin fila, vía RPC de catálogo),
-- siembra, sin update/delete/insert para `authenticated`, costo en fecha (fecha anterior → null),
-- cotización más cercana y empate, USD se mueve y ARS queda plano salvo cambio de costo, varias cargas
-- el mismo día = varias filas, exclusiones (sin costo, sin cotización, neto ≤ 0, inactivos), acceso de
-- `anon`/`authenticated` y rol de Superset de solo lectura, y RLS en toda tabla de public/dominio.
begin;

select plan(37);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos'),
  ('33333333-3333-3333-3333-333333333333', 'Organización Tres');

insert into auth.users (id, email) values
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

-- Org 1: Mundo JC (neto = lista) y San Javucho (−10 %) activas; Inactiva no cuenta.
-- Org 2: sin cotizaciones (productos con costo, sin historia de margen). Org 3: neto que redondea a 0.
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Mundo JC', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'San Javucho', true),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Inactiva', false),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Beta', true),
  ('e3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Gratis', true);

insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct) values
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'central_ajuste', -10),
  ('e3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'central_ajuste', -99.999);

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 10000, true),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'En dólares', 'USD-1', 'USD', 10, true),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Sin costo', 'SIN-1', 'ARS', 5000, true),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'De baja', 'BAJ-1', 'ARS', 5000, false),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Teclado', 'TEC-1', 'ARS', 10000, true),
  ('a3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Casi gratis', 'GRA-1', 'ARS', 1, true);

-- ============================================================================
-- Disparador (FR-009): el alta de un costo agrega una fila a la historia
-- ============================================================================

insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 6000),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 4),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 100),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 6000),
  ('a3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 1);

select is(
  (select count(*)::int from dominio.producto_costos_historial where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  1, 'FR-009: el alta del costo deja una fila en la historia'
);
select is(
  (select costo from dominio.producto_costos_historial where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  6000::numeric, 'la fila lleva el costo dado de alta'
);

-- Cambio de costo y mismo costo, por el RPC de catálogo (cubre a todos los escritores del costo).
select set_config('request.jwt.claims', json_build_object('sub', 'd2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(
  $$select public.actualizar_producto(id, updated_at, nombre, descripcion, sku, compatible_con, moneda, precio_lista, 7000)
      from dominio.productos where id = 'a2000000-0000-0000-0000-000000000001'$$,
  'el administrador cambia el costo por actualizar_producto'
);
select lives_ok(
  $$select public.actualizar_producto(id, updated_at, nombre, descripcion, sku, compatible_con, moneda, precio_lista, 7000)
      from dominio.productos where id = 'a2000000-0000-0000-0000-000000000001'$$,
  'guardar el mismo costo es válido'
);
reset role;

select is(
  (select array_agg(costo order by vigente_desde, id) from dominio.producto_costos_historial
    where producto_id = 'a2000000-0000-0000-0000-000000000001'),
  array[6000, 7000]::numeric[], 'FR-009: un cambio real agrega fila y guardar el mismo costo no agrega otra'
);

-- Siembra: la misma sentencia de la migración deja una fila inicial por costo existente.
delete from dominio.producto_costos_historial where producto_id = 'a1000000-0000-0000-0000-000000000004';
insert into dominio.producto_costos_historial (organizacion_id, producto_id, costo, vigente_desde)
select k.organizacion_id, k.producto_id, k.costo, clock_timestamp()
from dominio.producto_costos k
where not exists (select 1 from dominio.producto_costos_historial h where h.producto_id = k.producto_id);
select is(
  (select array_agg(costo) from dominio.producto_costos_historial where producto_id = 'a1000000-0000-0000-0000-000000000004'),
  array[100]::numeric[], 'FR-009: la siembra deja una fila inicial por costo existente'
);

-- ============================================================================
-- Historia determinista: fechas fijas (el test reemplaza las del disparador)
-- ============================================================================

delete from dominio.producto_costos_historial where organizacion_id = '11111111-1111-1111-1111-111111111111';
insert into dominio.producto_costos_historial (organizacion_id, producto_id, costo, vigente_desde) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 6000, '2026-01-01 12:00:00+00'),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 7000, '2026-02-01 12:00:00+00'),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000002', 4, '2026-01-01 12:00:00+00'),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000004', 100, '2026-01-01 12:00:00+00');

-- Sin cotizaciones en la organización: ninguna fila (FR-012)
select is(
  (select count(*)::int from analitica.margen_historico_producto_canal where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  0, 'FR-012: sin ninguna cotización cargada no hay filas en la historia'
);

insert into dominio.cotizaciones (organizacion_id, valor, cargada_por_nombre, cargada_en) values
  ('11111111-1111-1111-1111-111111111111', 900, 'Test', '2025-12-15 12:00:00+00'),
  ('11111111-1111-1111-1111-111111111111', 1000, 'Test', '2026-01-10 12:00:00+00'),
  ('11111111-1111-1111-1111-111111111111', 1200, 'Test', '2026-02-10 06:00:00+00'),
  ('11111111-1111-1111-1111-111111111111', 1300, 'Test', '2026-02-10 18:00:00+00');

-- ============================================================================
-- Funciones de apoyo (FR-010)
-- ============================================================================

select is(analitica.costo_en_fecha('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '2026-01-15 00:00:00+00'),
  6000::numeric, 'FR-010: el costo de una fecha es el último registrado hasta ella');
select is(analitica.costo_en_fecha('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '2026-02-01 12:00:00+00'),
  7000::numeric, 'el costo cambia desde la fecha del cambio (vigente_desde ≤ fecha)');
select is(analitica.costo_en_fecha('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '2025-12-31 00:00:00+00'),
  null::numeric, 'una fecha anterior al primer registro no tiene costo');
select is(analitica.costo_en_fecha('a1000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '2026-03-01 00:00:00+00'),
  null::numeric, 'el costo no cruza organizaciones');

select is(analitica.cotizacion_cercana('11111111-1111-1111-1111-111111111111', '2026-01-12 00:00:00+00'),
  1000::numeric, 'FR-010: la cotización más cercana a la fecha');
select is(analitica.cotizacion_cercana('11111111-1111-1111-1111-111111111111', '2026-02-01 12:00:00+00'),
  1200::numeric, 'la más cercana puede ser posterior a la fecha');
select is(analitica.cotizacion_cercana('11111111-1111-1111-1111-111111111111', '2026-01-10 00:00:00+00'),
  1000::numeric, 'cotización cargada el mismo día: la cercana en el tiempo');
select is(analitica.cotizacion_cercana('11111111-1111-1111-1111-111111111111', '2026-01-25 21:00:00+00'),
  1000::numeric, 'equidistante de dos cargas (15 días y 9 horas de cada una): se usa la anterior');
select is(analitica.cotizacion_cercana('22222222-2222-2222-2222-222222222222', '2026-01-10 00:00:00+00'),
  null::numeric, 'organización sin cotizaciones → null');

-- ============================================================================
-- Vista (FR-011, FR-012)
-- ============================================================================

-- Joystick (ARS) en Mundo JC: fechas con costo = 01-01, 01-10, 02-01, 02-10 06:00, 02-10 18:00 (la del 15/12 es anterior al costo)
select is(
  (select count(*)::int from analitica.margen_historico_producto_canal
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_nombre = 'Mundo JC'),
  5, 'FR-011: una fila por fecha de la serie (cambios de costo + cargas de cotización), varias cargas el mismo día = varias filas'
);
select is(
  (select count(*)::int from analitica.margen_historico_producto_canal
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and fecha = '2025-12-15 12:00:00+00'),
  0, 'FR-012: una fecha anterior al primer costo no tiene margen'
);
select is(
  (select array_agg(margen order by fecha) from analitica.margen_historico_producto_canal
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_nombre = 'Mundo JC'),
  array[4000, 4000, 3000, 3000, 3000]::numeric[], 'ARS: la cotización no mueve el margen; solo lo cambia el cambio de costo del 1/2'
);
select is(
  (select array_agg(costo order by fecha) from analitica.margen_historico_producto_canal
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_nombre = 'Mundo JC'),
  array[6000, 6000, 7000, 7000, 7000]::numeric[], 'el costo usado cambia desde la fecha del cambio'
);
select is(
  (select round(margen_pct * 100, 1) from analitica.margen_historico_producto_canal
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_nombre = 'Mundo JC' and fecha = '2026-01-10 12:00:00+00'),
  40.0, 'margen % = margen ÷ neto (10.000 / 6.000 → 40 %)'
);
select is(
  (select precio_neto from analitica.margen_historico_producto_canal
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_nombre = 'San Javucho' and fecha = '2026-01-10 12:00:00+00'),
  9000::numeric, 'el neto aplica la regla de la tienda (−10 %)'
);

-- En dólares: 10 USD de lista y 4 USD de costo, fechas 01-01, 01-10, 02-10 06:00, 02-10 18:00
select is(
  (select array_agg(cotizacion order by fecha) from analitica.margen_historico_producto_canal
    where producto_id = 'a1000000-0000-0000-0000-000000000002' and empresa_nombre = 'Mundo JC'),
  array[1000, 1000, 1200, 1300]::numeric[], 'FR-011: cada fecha usa la cotización más cercana a ESA fecha'
);
select is(
  (select array_agg(precio_neto order by fecha) from analitica.margen_historico_producto_canal
    where producto_id = 'a1000000-0000-0000-0000-000000000002' and empresa_nombre = 'Mundo JC'),
  array[10000, 10000, 12000, 13000]::numeric[], 'USD: el neto en pesos se mueve con la cotización de cada fecha'
);
select is(
  (select array_agg(margen order by fecha) from analitica.margen_historico_producto_canal
    where producto_id = 'a1000000-0000-0000-0000-000000000002' and empresa_nombre = 'Mundo JC'),
  array[6000, 6000, 7200, 7800]::numeric[], 'USD: el margen en pesos se mueve con el dólar (neto − costo × cotización)'
);

-- Exclusiones (FR-012)
select is(
  (select count(*)::int from analitica.margen_historico_producto_canal where producto_id = 'a1000000-0000-0000-0000-000000000003'),
  0, 'sin costo registrado no hay fila'
);
select is(
  (select count(*)::int from analitica.margen_historico_producto_canal where producto_id = 'a1000000-0000-0000-0000-000000000004'),
  0, 'un producto dado de baja queda fuera'
);
select is(
  (select count(*)::int from analitica.margen_historico_producto_canal where empresa_nombre = 'Inactiva'),
  0, 'una empresa pausada queda fuera'
);
select is(
  (select count(*)::int from analitica.margen_historico_producto_canal where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  0, 'organización sin cotizaciones: sin filas aunque el producto tenga costo'
);

insert into dominio.cotizaciones (organizacion_id, valor, cargada_por_nombre, cargada_en) values
  ('33333333-3333-3333-3333-333333333333', 1000, 'Test', now());
select is(
  (select count(*)::int from analitica.margen_historico_producto_canal where organizacion_id = '33333333-3333-3333-3333-333333333333'),
  0, 'neto ≤ 0 (el redondeo lo deja en 0): sin fila, no se divide por cero'
);

-- ============================================================================
-- Acceso (SC-004)
-- ============================================================================

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'analitica' and c.relkind in ('r', 'p')),
  0, 'analitica sigue sin tablas: solo vistas'
);
select ok(not has_table_privilege('anon', 'analitica.margen_historico_producto_canal', 'SELECT'), 'anon sin select sobre la vista');
select ok(not has_table_privilege('authenticated', 'analitica.margen_historico_producto_canal', 'SELECT'), 'authenticated sin select sobre la vista');
select ok(
  not has_function_privilege('authenticated', 'analitica.costo_en_fecha(uuid, uuid, timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'analitica.costo_en_fecha(uuid, uuid, timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'analitica.cotizacion_cercana(uuid, timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'analitica.cotizacion_cercana(uuid, timestamptz)', 'EXECUTE'),
  'las funciones de apoyo no las ejecuta anon ni authenticated'
);
select ok(
  has_table_privilege('superset_analitica', 'analitica.margen_historico_producto_canal', 'SELECT')
  and has_function_privilege('superset_analitica', 'analitica.costo_en_fecha(uuid, uuid, timestamptz)', 'EXECUTE')
  and not has_table_privilege('superset_analitica', 'analitica.margen_historico_producto_canal', 'INSERT')
  and not has_table_privilege('superset_analitica', 'dominio.producto_costos_historial', 'INSERT'),
  'el rol de Superset lee la vista y no escribe'
);
select ok(
  not has_table_privilege('authenticated', 'dominio.producto_costos_historial', 'INSERT')
  and not has_table_privilege('authenticated', 'dominio.producto_costos_historial', 'UPDATE')
  and not has_table_privilege('authenticated', 'dominio.producto_costos_historial', 'DELETE')
  and not has_table_privilege('anon', 'dominio.producto_costos_historial', 'SELECT'),
  'FR-009: authenticated solo lee la historia (sin insert/update/delete) y anon nada'
);

-- RLS en toda tabla de public y dominio (equivalente a rls_en_toda_tabla)
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'dominio') and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0, 'rls_en_toda_tabla: ninguna tabla de public/dominio sin RLS'
);

select * from finish();
rollback;
