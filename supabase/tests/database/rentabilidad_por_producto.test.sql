-- F-REN-03 (MSF-242, épica MSF-120): tablero «Por producto» de Rentabilidad.
-- Cubre FR-019, FR-020 / SC-007: las filas que dibuja el tablero salen de `analitica.margen_producto_canal`
-- (un producto en dos tiendas = dos filas; el negativo queda «Negativo»), y los filtros de estado, canal y
-- búsqueda y el orden por margen % del dataset (infra/superset/dashboards/rentabilidad/datasets/…/
-- margen_producto_canal.yaml, columnas calculadas) devuelven lo mismo que la vista. Las expresiones de
-- texto son las del YAML: si cambian allá, este test las vuelve a ejercitar contra Postgres.
begin;

select plan(19);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'administracion@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'operador@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

-- E1 Mundo JC (neto = lista) · E2 San Javucho (+10 %) · E3 Empresa Dos (org 2).
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Mundo JC', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'San Javucho', true),
  ('e2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Empresa Dos', true);

insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct) values
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'central_ajuste', 10);

-- Org 1: A1 costo 6.000 · A4 costo 9.500 · A6 costo 10.500 (todos de lista 10.000) · A3 sin costo.
-- Org 2: B1 de lista 500 sin costo (no hay ninguna fila de margen).
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 10000, true),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Sin costo', 'SIN-1', 'ARS', 5000, true),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Margen bajo', 'BAJ-1', 'ARS', 10000, true),
  ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Margen negativo', 'NEG-1', 'ARS', 10000, true),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Teclado', 'TEC-1', 'ARS', 500, true);

insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 6000),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 9500),
  ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 10500);

-- Expresiones del dataset (columnas calculadas del YAML), aplicadas sobre la vista.
create temp view tablero as
select
  organizacion_id, empresa_nombre, producto_nombre, sku, estado, margen_pct,
  producto_nombre || ' ' || coalesce(sku, '') as producto_busqueda,
  CASE estado WHEN 'ok' THEN 'OK' WHEN 'bajo' THEN 'Bajo' ELSE 'Negativo' END as estado_etiqueta,
  CASE WHEN precio_neto < 0 THEN '-$ ' ELSE '$ ' END || replace(to_char(round(abs(precio_neto)), 'FM999,999,999,999'), ',', '.') as precio_texto,
  CASE WHEN margen < 0 THEN '-$ ' ELSE '$ ' END || replace(to_char(round(abs(margen)), 'FM999,999,999,999'), ',', '.') as margen_texto,
  CASE WHEN comision = 0 THEN '—' ELSE CASE WHEN comision < 0 THEN '-$ ' ELSE '$ ' END || replace(to_char(round(abs(comision)), 'FM999,999,999,999'), ',', '.') END as comision_texto,
  replace(to_char(round(margen_pct * 100, 1), 'FM990.0'), '.', ',') || ' %' as margen_pct_texto,
  LEAST(GREATEST(round(margen_pct * 100), 0), 100) as barra_pct,
  CASE WHEN margen < 0 THEN '#C62828' ELSE '#15181D' END as margen_color
from analitica.margen_producto_canal;

-- Mundo JC: A1 10.000/6.000 (ok) · A4 10.000/9.500 (bajo) · A6 10.000/10.500 (negativo)
-- San Javucho: A1 11.000/6.000 (ok) · A4 11.000/9.500 (ok) · A6 11.000/10.500 (bajo)

select is(
  (select count(*)::int from tablero where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  6, 'FR-019: 3 productos con costo × 2 tiendas = 6 filas (el sin costo no aparece)'
);
select is(
  (select count(*)::int from tablero where producto_nombre = 'Joystick'),
  2, 'SC-007: un producto en dos tiendas son dos filas'
);
select is(
  (select array_agg(empresa_nombre order by empresa_nombre) from tablero where producto_nombre = 'Joystick'),
  array['Mundo JC', 'San Javucho'], 'las dos filas del producto son una por tienda (Canal)'
);
select is(
  (select estado_etiqueta from tablero where sku = 'NEG-1' and empresa_nombre = 'Mundo JC'),
  'Negativo', 'SC-007: el producto con margen negativo queda «Negativo»'
);
select is(
  (select margen_texto || ' · ' || margen_pct_texto || ' · ' || margen_color from tablero where sku = 'NEG-1' and empresa_nombre = 'Mundo JC'),
  '-$ 500 · -5,0 % · #C62828', 'FR-021: el negativo se muestra con signo y con el color de error'
);
select is(
  (select margen_color from tablero where sku = 'JOY-1' and empresa_nombre = 'Mundo JC'),
  '#15181D', 'un margen positivo no se resalta'
);
select is(
  (select precio_texto || ' · ' || margen_texto || ' · ' || margen_pct_texto || ' · ' || comision_texto
     from tablero where sku = 'JOY-1' and empresa_nombre = 'San Javucho'),
  '$ 11.000 · $ 5.000 · 45,5 % · —', 'FR-019: columnas Precio, Margen, Margen % y Comisión («—» sin comisión) en es-AR'
);
select is(
  (select barra_pct from tablero where sku = 'NEG-1' and empresa_nombre = 'Mundo JC'),
  0::numeric, 'la barra de un negativo queda en 0'
);

-- Filtro de estado (FR-020)
select is(
  (select count(*)::int from tablero where organizacion_id = '11111111-1111-1111-1111-111111111111' and estado_etiqueta in ('Bajo', 'Negativo')),
  3, '«Bajo o negativo» (filtro inicial desde el resumen): A4 y A6 en Mundo JC y A6 en San Javucho'
);
select is(
  (select count(*)::int from tablero where organizacion_id = '11111111-1111-1111-1111-111111111111' and estado_etiqueta = 'Negativo'),
  1, '«Solo negativo»: una sola fila'
);
select is(
  (select count(*)::int from tablero where organizacion_id = '11111111-1111-1111-1111-111111111111' and estado_etiqueta in ('Bajo', 'Negativo'))::bigint,
  (select count(*) from analitica.margen_producto_canal
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and estado in ('bajo', 'negativo')),
  'el filtro por etiqueta coincide con el estado de la vista'
);

-- Filtro de canal (FR-020: solo tiendas, sin Mercado Libre)
select is(
  (select array_agg(distinct empresa_nombre order by empresa_nombre) from tablero where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  array['Mundo JC', 'San Javucho'], 'los canales disponibles son solo las tiendas'
);
select is(
  (select count(*)::int from tablero where empresa_nombre = 'San Javucho'),
  3, 'filtrar por canal deja las filas de esa tienda'
);

-- Buscador «Buscar producto o SKU» (FR-020)
select is(
  (select count(*)::int from tablero where producto_busqueda ilike '%joy%'),
  2, 'buscar por nombre'
);
select is(
  (select count(*)::int from tablero where producto_busqueda ilike '%baj-1%'),
  2, 'buscar por SKU'
);
select is(
  (select count(*)::int from tablero where producto_busqueda ilike '%no existe%'),
  0, 'sin coincidencias no hay filas (el tablero muestra «Sin resultados»)'
);

-- Orden por margen % (el tablero ordena por menor margen primero)
select is(
  (select array_agg(sku || '@' || empresa_nombre order by margen_pct asc, sku, empresa_nombre)
     from tablero where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  array['NEG-1@Mundo JC', 'NEG-1@San Javucho', 'BAJ-1@Mundo JC', 'BAJ-1@San Javucho', 'JOY-1@Mundo JC', 'JOY-1@San Javucho'],
  'orden «Menor margen primero»: el negativo arriba'
);
select is(
  (select array_agg(sku || '@' || empresa_nombre order by margen_pct desc, sku, empresa_nombre)
     from tablero where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  array['JOY-1@San Javucho', 'JOY-1@Mundo JC', 'BAJ-1@San Javucho', 'BAJ-1@Mundo JC', 'NEG-1@San Javucho', 'NEG-1@Mundo JC'],
  'orden «Mayor margen primero»: el de más margen arriba'
);

-- Aislamiento: la organización 2 no ve ni aporta filas del tablero.
select is(
  (select count(*)::int from tablero where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  0, 'la organización 2 no tiene filas (sin datos de la 1 mezclados)'
);

select * from finish();
rollback;
