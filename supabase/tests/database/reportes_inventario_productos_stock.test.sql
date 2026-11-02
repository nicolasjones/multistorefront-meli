-- F-REP-01 (MSF-297, épica MSF-140): vista `analitica.inventario_productos_stock`.
-- Cubre FR-002 / SC-001: columnas, valor = cantidad × costo convertido (USD con cotización vigente),
-- producto sin costo → sin valor, USD sin cotización → sin valor, producto inactivo fuera, estado
-- con la regla de `public.stock_estados`, y sin mezcla de organizaciones.
begin;

select plan(19);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Periféricos');

-- Org 1 (dólar 1.000): P1 ARS costo 6.000 (cant 3) · P2 USD costo 10 (cant 5) · P3 sin costo (cant 2) ·
-- P4 inactivo · P5 sin stock con costo. Org 2 (sin cotización): Q1 USD costo 5 · Q2 ARS costo 100.
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, activo, categoria_id) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 10000, true, 'c1000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable USB', 'CAB-1', 'USD', 20, true, null),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Sin costo', 'SIN-1', 'ARS', 5000, true, null),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Inactivo', 'INA-1', 'ARS', 10000, false, null),
  ('a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Agotado', 'AGO-1', 'ARS', 10000, true, null),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Mouse', 'MOU-1', 'USD', 10, true, null),
  ('a2000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Teclado', 'TEC-1', 'ARS', 500, true, null);

insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 6000),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 10),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 1000),
  ('a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 100),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 5),
  ('a2000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 100);

insert into dominio.cotizacion_inicial (organizacion_id, valor) values
  ('11111111-1111-1111-1111-111111111111', 1000);

-- Existencias (las crea el alta del producto): cantidad y mínimo.
update dominio.existencias set cantidad = 3, minimo = 5 where producto_id = 'a1000000-0000-0000-0000-000000000001';
update dominio.existencias set cantidad = 5, minimo = 2 where producto_id = 'a1000000-0000-0000-0000-000000000002';
update dominio.existencias set cantidad = 2, minimo = 0 where producto_id = 'a1000000-0000-0000-0000-000000000003';
update dominio.existencias set cantidad = 9, minimo = 1 where producto_id = 'a1000000-0000-0000-0000-000000000004';
update dominio.existencias set cantidad = 0, minimo = 4 where producto_id = 'a1000000-0000-0000-0000-000000000005';
update dominio.existencias set cantidad = 4, minimo = 1 where producto_id = 'a2000000-0000-0000-0000-000000000001';
update dominio.existencias set cantidad = 7, minimo = 1 where producto_id = 'a2000000-0000-0000-0000-000000000002';

-- ============================================================================
-- Contrato de la vista
-- ============================================================================

select has_view('analitica', 'inventario_productos_stock', 'existe analitica.inventario_productos_stock');
select columns_are(
  'analitica', 'inventario_productos_stock',
  array['organizacion_id', 'producto_id', 'producto_nombre', 'sku', 'categoria', 'cantidad', 'minimo',
        'estado', 'moneda_costo', 'costo', 'costo_ars', 'valor_ars'],
  'columnas del contrato'
);

-- ============================================================================
-- Valor = cantidad × costo convertido (SC-001)
-- ============================================================================

select is(
  (select valor_ars from analitica.inventario_productos_stock where sku = 'JOY-1'),
  18000::numeric, 'ARS: valor = 3 × 6.000'
);
select is(
  (select costo_ars from analitica.inventario_productos_stock where sku = 'CAB-1'),
  10000::numeric, 'USD: costo en pesos = 10 × cotización 1.000'
);
select is(
  (select valor_ars from analitica.inventario_productos_stock where sku = 'CAB-1'),
  50000::numeric, 'USD: valor = 5 × 10.000'
);
select is(
  (select moneda_costo from analitica.inventario_productos_stock where sku = 'CAB-1'),
  'USD', 'la moneda del costo es la del producto'
);
select is(
  (select costo from analitica.inventario_productos_stock where sku = 'CAB-1'),
  10::numeric, 'el costo se expone en su moneda'
);
select is(
  (select valor_ars from analitica.inventario_productos_stock where sku = 'AGO-1'),
  0::numeric, 'sin stock con costo: valor 0'
);

-- ============================================================================
-- Sin costo / sin cotización → sin valor
-- ============================================================================

select is(
  (select count(*)::int from analitica.inventario_productos_stock where sku = 'SIN-1'),
  1, 'el producto sin costo aparece (con su stock)'
);
select ok(
  (select costo is null and costo_ars is null and valor_ars is null and moneda_costo is null
     from analitica.inventario_productos_stock where sku = 'SIN-1'),
  'sin costo: sin costo_ars ni valor_ars (no se inventa un valor)'
);
select ok(
  (select cantidad = 2 from analitica.inventario_productos_stock where sku = 'SIN-1'),
  'sin costo: conserva su cantidad'
);
select ok(
  (select costo_ars is null and valor_ars is null from analitica.inventario_productos_stock where sku = 'MOU-1'),
  'USD sin cotización: sin costo_ars ni valor_ars'
);
select is(
  (select valor_ars from analitica.inventario_productos_stock where sku = 'TEC-1'),
  700::numeric, 'ARS no necesita cotización: valor = 7 × 100'
);

-- ============================================================================
-- Estado, categoría y alcance
-- ============================================================================

select is(
  (select array_agg(estado order by sku)
     from analitica.inventario_productos_stock where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  array['sin_stock', 'disponible', 'stock_bajo', 'disponible']::text[],
  'estado con la regla de stock_estados (AGO-1 sin stock, CAB-1 y SIN-1 disponibles con mínimo bajo, JOY-1 bajo)'
);
select is(
  (select categoria from analitica.inventario_productos_stock where sku = 'JOY-1'),
  'Periféricos', 'la categoría sale de dominio.categorias'
);
select is(
  (select count(*)::int from analitica.inventario_productos_stock where sku = 'INA-1'),
  0, 'el producto inactivo no aparece'
);

-- ============================================================================
-- Sin mezcla de organizaciones
-- ============================================================================

select is(
  (select count(*)::int from analitica.inventario_productos_stock where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  4, 'la organización 1 ve solo sus 4 productos activos'
);
select is(
  (select array_agg(sku order by sku) from analitica.inventario_productos_stock where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  array['MOU-1', 'TEC-1']::text[], 'la organización 2 ve solo los suyos'
);

select * from finish();
rollback;
