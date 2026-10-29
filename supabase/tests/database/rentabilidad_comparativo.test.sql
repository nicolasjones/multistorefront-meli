-- F-REN-06 (MSF-261, épica MSF-127): vista `analitica.margen_comparativo_producto`.
-- Cubre FR-001, FR-002, FR-003 / SC-001: comparabilidad (≥ 2 empresas), diferencia en pp (40 % vs 33,3 % →
-- 6,7), mejor/peor con desempate por nombre, exclusiones (sin costo, sin cotización, una sola empresa,
-- empresa inactiva), valores iguales a la vista base, `anon`/`authenticated` sin acceso y rol de Superset
-- de solo lectura. `rls_en_toda_tabla` (global) recorre `public` + `dominio`; acá se verifica además que la
-- migración no cree tablas.
begin;

select plan(23);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos'),
  ('33333333-3333-3333-3333-333333333333', 'Organización Tres');

-- Org 1: Mundo JC (neto = lista) y San Javucho (−10 %) activas; Inactiva no cuenta.
-- Org 2: Alfa y Beta, ambas sin ajuste (empate). Org 3: una sola empresa.
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Mundo JC', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'San Javucho', true),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Inactiva', false),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Beta', true),
  ('e2000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Alfa', true),
  ('e3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Única', true);

insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct) values
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'central_ajuste', -10);

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 10000, true),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Sin costo', 'SIN-1', 'ARS', 5000, true),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'En dólares', 'USD-1', 'USD', 10, true),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Teclado', 'TEC-1', 'ARS', 10000, true),
  ('a3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Mouse', 'MOU-1', 'ARS', 10000, true);

-- Joystick 6.000 · En dólares 4 USD (sin cotización cargada) · Teclado 6.000 · Mouse 6.000. «Sin costo» no tiene.
insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 6000),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 4),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 6000),
  ('a3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 6000);

-- Comparabilidad (FR-001, FR-002)
select is(
  (select count(*)::int from analitica.margen_comparativo_producto where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  2, 'FR-001: un producto con margen en dos empresas tiene una fila por empresa'
);
select is(
  (select array_agg(distinct empresas_comparadas) from analitica.margen_comparativo_producto
    where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  array[2], 'empresas_comparadas = 2 (la empresa inactiva no cuenta)'
);
select is(
  (select array_agg(empresa_nombre order by empresa_nombre) from analitica.margen_comparativo_producto
    where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  array['Mundo JC', 'San Javucho'], 'las columnas del comparativo son las empresas activas'
);
select is(
  (select count(*)::int from analitica.margen_comparativo_producto where producto_id = 'a1000000-0000-0000-0000-000000000002'),
  0, 'FR-002: sin costo, el producto no aparece'
);
select is(
  (select count(*)::int from analitica.margen_comparativo_producto where producto_id = 'a1000000-0000-0000-0000-000000000003'),
  0, 'FR-002: en USD sin cotización, el producto no aparece (no se inventa margen)'
);
select is(
  (select count(*)::int from analitica.margen_comparativo_producto where organizacion_id = '33333333-3333-3333-3333-333333333333'),
  0, 'FR-002: un producto con margen en una sola empresa no aparece'
);
select is(
  (select count(*)::int from analitica.margen_comparativo_producto where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  2, 'org 1: solo las dos filas del Joystick'
);

-- Márgenes: Mundo JC 10.000/6.000 = 40 % · San Javucho 9.000/6.000 = 33,3 %
select is(
  (select round(margen_pct * 100, 1) from analitica.margen_comparativo_producto
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_nombre = 'Mundo JC'),
  40.0, 'Mundo JC: 40 %'
);
select is(
  (select round(margen_pct * 100, 1) from analitica.margen_comparativo_producto
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_nombre = 'San Javucho'),
  33.3, 'San Javucho: 33,3 %'
);

-- Diferencia y mejor/peor (FR-003)
select is(
  (select array_agg(distinct round(diferencia_pp, 1)) from analitica.margen_comparativo_producto
    where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  array[6.7::numeric], 'FR-003: 40 % vs 33,3 % = 6,7 pp en ambas filas'
);
select is(
  (select array_agg(distinct round(margen_pct_mejor * 100, 1) || '/' || round(margen_pct_peor * 100, 1))
     from analitica.margen_comparativo_producto where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  array['40.0/33.3'], 'margen_pct_mejor y margen_pct_peor'
);
select is(
  (select array_agg(distinct empresa_mejor || '>' || empresa_peor) from analitica.margen_comparativo_producto
    where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  array['Mundo JC>San Javucho'], 'empresa_mejor y empresa_peor'
);

-- Empate: mismo margen en Alfa y Beta → diferencia 0 y desempate por nombre (Alfa primero), estable.
select is(
  (select array_agg(distinct diferencia_pp) from analitica.margen_comparativo_producto where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  array[0::numeric], 'empate: diferencia 0 pp'
);
select is(
  (select array_agg(distinct empresa_mejor || '|' || empresa_peor) from analitica.margen_comparativo_producto
    where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  array['Alfa|Alfa'], 'empate: el desempate por nombre da el mismo resultado en todas las filas'
);

-- Valores iguales a la vista base
select is(
  (select count(*)::int from analitica.margen_comparativo_producto c
     join analitica.margen_producto_canal b using (organizacion_id, producto_id, empresa_id)
    where c.precio_neto = b.precio_neto and c.costo = b.costo and c.margen = b.margen
      and c.margen_pct = b.margen_pct and c.estado = b.estado),
  (select count(*)::int from analitica.margen_comparativo_producto),
  'las columnas heredadas valen lo mismo que en margen_producto_canal'
);

-- Acceso
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'analitica' and c.relkind in ('r', 'p')),
  0, 'analitica sigue sin tablas: solo vistas (la migración no crea tablas sin RLS)'
);
select ok(not has_table_privilege('anon', 'analitica.margen_comparativo_producto', 'SELECT'), 'anon sin select sobre la vista');
select ok(not has_table_privilege('authenticated', 'analitica.margen_comparativo_producto', 'SELECT'), 'authenticated sin select sobre la vista');

set local role authenticated;
select throws_ok($$select 1 from analitica.margen_comparativo_producto$$, '42501', null, 'authenticated: permiso denegado');
reset role;
set local role anon;
select throws_ok($$select 1 from analitica.margen_comparativo_producto$$, '42501', null, 'anon: permiso denegado');
reset role;

select ok(has_table_privilege('superset_analitica', 'analitica.margen_comparativo_producto', 'SELECT'), 'el rol de Superset lee la vista');
select ok(
  not has_table_privilege('superset_analitica', 'analitica.margen_comparativo_producto', 'INSERT')
  and not has_table_privilege('superset_analitica', 'analitica.margen_comparativo_producto', 'UPDATE')
  and not has_table_privilege('superset_analitica', 'analitica.margen_comparativo_producto', 'DELETE'),
  'el rol de Superset es de solo lectura'
);

-- RLS en toda tabla de public y dominio (equivalente a rls_en_toda_tabla)
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'dominio') and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0, 'rls_en_toda_tabla: ninguna tabla de public/dominio sin RLS'
);

select * from finish();
rollback;
