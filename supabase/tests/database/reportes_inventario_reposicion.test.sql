-- F-REP-02 (MSF-311, épica MSF-140): vista `analitica.inventario_reposicion`.
-- Cubre FR-005 / FR-006 / SC-003: incluye Sin stock y Bajo, excluye Normal (mínimo 0 con cantidad > 0
-- es Normal) y los inactivos, faltante sugerido = mínimo − cantidad, proveedor, grants y sin mezcla
-- de organizaciones.
begin;

select plan(18);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Periféricos');

insert into dominio.proveedores (id, organizacion_id, razon_social, cuit, activo) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Distribuidora Norte', '30700000040', true);

-- Org 1: BAJ-1 bajo (cant 4, mín 10) · SIN-1 sin stock (cant 0, mín 10) · NOR-1 normal (cant 20, mín 10) ·
-- MIN0-1 mínimo 0 con cantidad 3 (normal) · AGO-0 sin stock con mínimo 0 · INA-1 inactivo sin stock ·
-- LIM-1 cantidad = mínimo (bajo). Org 2: Q-SIN sin stock.
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, activo, categoria_id, proveedor_id, codigo_proveedor) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'BAJ-1', 'ARS', 10000, true, 'c1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'JOY-NORTE'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable USB', 'SIN-1', 'ARS', 5000, true, null, null, null),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Mouse', 'NOR-1', 'ARS', 5000, true, null, null, null),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Teclado', 'MIN0-1', 'ARS', 5000, true, null, null, null),
  ('a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Agotado sin mínimo', 'AGO-0', 'ARS', 5000, true, null, null, null),
  ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Inactivo', 'INA-1', 'ARS', 5000, false, null, null, null),
  ('a1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'En el límite', 'LIM-1', 'ARS', 5000, true, null, null, null),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Otra org', 'Q-SIN', 'ARS', 500, true, null, null, null);

update dominio.existencias set cantidad = 4, minimo = 10 where producto_id = 'a1000000-0000-0000-0000-000000000001';
update dominio.existencias set cantidad = 0, minimo = 10 where producto_id = 'a1000000-0000-0000-0000-000000000002';
update dominio.existencias set cantidad = 20, minimo = 10 where producto_id = 'a1000000-0000-0000-0000-000000000003';
update dominio.existencias set cantidad = 3, minimo = 0 where producto_id = 'a1000000-0000-0000-0000-000000000004';
update dominio.existencias set cantidad = 0, minimo = 0 where producto_id = 'a1000000-0000-0000-0000-000000000005';
update dominio.existencias set cantidad = 0, minimo = 5 where producto_id = 'a1000000-0000-0000-0000-000000000006';
update dominio.existencias set cantidad = 5, minimo = 5 where producto_id = 'a1000000-0000-0000-0000-000000000007';
update dominio.existencias set cantidad = 0, minimo = 3 where producto_id = 'a2000000-0000-0000-0000-000000000001';

-- Contrato
select has_view('analitica', 'inventario_reposicion', 'existe analitica.inventario_reposicion');
select columns_are(
  'analitica', 'inventario_reposicion',
  array['organizacion_id', 'producto_id', 'producto_nombre', 'sku', 'categoria', 'proveedor',
        'codigo_proveedor', 'cantidad', 'minimo', 'estado', 'faltante_sugerido'],
  'columnas del contrato'
);

-- Qué entra y qué no (FR-005, SC-003)
select is(
  (select array_agg(sku order by sku) from analitica.inventario_reposicion
    where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  array['AGO-0', 'BAJ-1', 'LIM-1', 'SIN-1']::text[],
  'aparecen Sin stock y Bajo (incluida cantidad = mínimo)'
);
select is((select estado from analitica.inventario_reposicion where sku = 'SIN-1'), 'sin_stock', 'cantidad 0 → sin_stock');
select is((select estado from analitica.inventario_reposicion where sku = 'BAJ-1'), 'stock_bajo', '0 < cantidad ≤ mínimo → stock_bajo');
select is((select estado from analitica.inventario_reposicion where sku = 'LIM-1'), 'stock_bajo', 'cantidad = mínimo → stock_bajo');
select is((select count(*)::int from analitica.inventario_reposicion where sku = 'NOR-1'), 0, 'un producto Normal no aparece');
select is((select count(*)::int from analitica.inventario_reposicion where sku = 'MIN0-1'), 0, 'mínimo 0 con cantidad > 0 es Normal: no aparece');
select is((select count(*)::int from analitica.inventario_reposicion where sku = 'INA-1'), 0, 'el producto inactivo no aparece');

-- Faltante sugerido (FR-006)
select is((select faltante_sugerido from analitica.inventario_reposicion where sku = 'BAJ-1'), 6, 'mínimo 10 / cantidad 4 → faltante 6');
select is((select faltante_sugerido from analitica.inventario_reposicion where sku = 'SIN-1'), 10, 'sin stock con mínimo 10 → faltante 10');
select is((select faltante_sugerido from analitica.inventario_reposicion where sku = 'AGO-0'), 0, 'sin stock con mínimo 0 → faltante 0 (nunca negativo)');
select is((select faltante_sugerido from analitica.inventario_reposicion where sku = 'LIM-1'), 0, 'cantidad = mínimo → faltante 0');

-- Proveedor y categoría
select ok(
  (select proveedor = 'Distribuidora Norte' and codigo_proveedor = 'JOY-NORTE' and categoria = 'Periféricos'
     from analitica.inventario_reposicion where sku = 'BAJ-1'),
  'proveedor, código de proveedor y categoría del producto'
);
select ok(
  (select proveedor is null and codigo_proveedor is null from analitica.inventario_reposicion where sku = 'SIN-1'),
  'sin proveedor: columnas vacías (el producto igual aparece)'
);

-- Sin mezcla de organizaciones y grants
select is(
  (select array_agg(sku) from analitica.inventario_reposicion where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  array['Q-SIN']::text[], 'la organización 2 ve solo lo suyo'
);
select ok(
  not has_table_privilege('anon', 'analitica.inventario_reposicion', 'SELECT')
  and not has_table_privilege('authenticated', 'analitica.inventario_reposicion', 'SELECT'),
  'anon y authenticated no leen la vista'
);
select ok(
  has_table_privilege('superset_analitica', 'analitica.inventario_reposicion', 'SELECT')
  and not has_table_privilege('superset_analitica', 'analitica.inventario_reposicion', 'INSERT,UPDATE,DELETE,TRUNCATE'),
  'el rol de Superset solo lee la vista'
);

select * from finish();
rollback;
