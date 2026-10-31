-- F-CLI-15 (MSF-391, épica MSF-171): `public.ranking_clientes_por_dimension` (FR-005…FR-008; SC-002).
-- Filtro por producto (suma de líneas, no del comprobante), categoría raíz con subcategorías, intersección
-- producto∩categoría, provincia sin mayúsculas ni tildes, combinación con tipo / Consumidor final / IVA /
-- tienda, participación 100 %, producto o categoría de otra organización, validaciones, niveles de la sección
-- Clientes y `anon`. Las fechas son fijas porque la función no depende del reloj (no rechaza días futuros).
begin;

select plan(43);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d3000000-0000-0000-0000-000000000001', 'sin-membresia@example.com'),
  ('d4000000-0000-0000-0000-000000000001', 'consulta-uno@example.com'),
  ('d5000000-0000-0000-0000-000000000001', 'deposito-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d4000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda Uno', true);

insert into clientes (organizacion_id, numero, nombre, tipo, provincia) values
  ('11111111-1111-1111-1111-111111111111', 101, 'Alfa', 'mayorista', 'Córdoba'),
  ('11111111-1111-1111-1111-111111111111', 102, 'Beta', 'minorista', 'CORDOBA'),
  ('11111111-1111-1111-1111-111111111111', 103, 'Gamma', 'mayorista', 'Santa Fe'),
  ('11111111-1111-1111-1111-111111111111', 104, 'Delta', 'minorista', null),
  ('22222222-2222-2222-2222-222222222222', 201, 'Ajeno', 'minorista', 'Córdoba');

-- Solo Alfa y Gamma están habilitados en la tienda.
insert into clientes_empresas (cliente_id, empresa_id, organizacion_id)
select c.id, 'a1000000-0000-0000-0000-000000000001', c.organizacion_id
  from clientes c
 where c.organizacion_id = '11111111-1111-1111-1111-111111111111' and c.nombre in ('Alfa', 'Gamma');

-- Catálogo: «Audio» (raíz) con la subcategoría «Cables»; «Periféricos» (raíz). Un producto por categoría.
insert into dominio.categorias (id, organizacion_id, nombre, padre_id) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Audio', null),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Periféricos', null),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Ajena', null);
insert into dominio.categorias (id, organizacion_id, nombre, padre_id) values
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cables', 'c1000000-0000-0000-0000-000000000001');

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Auricular', 'AUR-1', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001'),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000002'),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Mouse', 'MOU-1', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000003'),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto ajeno', 'AJE-1', 'ARS', 1000, 'c2000000-0000-0000-0000-000000000001');

-- Octubre 2026 (todas con IVA 21 % por línea):
--   0001: Alfa  factura 1.000 = Auricular 600 + Cable 400        0002: Alfa factura 500 = Mouse 500
--   0003: Beta  factura 300 = Auricular 300                      0004: Gamma factura 800 = Cable 800
--   0005: Alfa  nota de crédito 200 (devolución de Auricular)    0006: Alfa presupuesto 9.999 (no cuenta)
--   0007: Beta  factura anulada 7.777 (no cuenta)                0008: Beta factura del 30/09 (fuera del rango)
--   0009: Delta factura 400 = Mouse 400                          0010: Consumidor final factura 5.000 = Auricular
--   0011: Ajeno (otra organización) factura 77.777
insert into dominio.comprobantes_venta
  (organizacion_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva)
select v.org::uuid, c.id, v.tipo, v.numero, v.fecha::date, v.estado, v.sin_iva, v.con_iva
  from (values
    ('11111111-1111-1111-1111-111111111111', 'Alfa', 'factura', '0001-00000001', '2026-10-05', 'emitida', 1000, 1210),
    ('11111111-1111-1111-1111-111111111111', 'Alfa', 'factura', '0001-00000002', '2026-10-10', 'cobrada', 500, 605),
    ('11111111-1111-1111-1111-111111111111', 'Beta', 'factura', '0001-00000003', '2026-10-06', 'deuda', 300, 363),
    ('11111111-1111-1111-1111-111111111111', 'Gamma', 'factura', '0001-00000004', '2026-10-07', 'emitida', 800, 968),
    ('11111111-1111-1111-1111-111111111111', 'Alfa', 'presupuesto', '0001-00000006', '2026-10-08', 'emitida', 9999, 12099),
    ('11111111-1111-1111-1111-111111111111', 'Beta', 'factura', '0001-00000007', '2026-10-09', 'anulada', 7777, 9410),
    ('11111111-1111-1111-1111-111111111111', 'Beta', 'factura', '0001-00000008', '2026-09-30', 'cobrada', 1234, 1493),
    ('11111111-1111-1111-1111-111111111111', 'Delta', 'factura', '0001-00000009', '2026-10-11', 'emitida', 400, 484),
    ('11111111-1111-1111-1111-111111111111', 'Consumidor final', 'factura', '0001-00000010', '2026-10-14', 'cobrada', 5000, 6050),
    ('22222222-2222-2222-2222-222222222222', 'Ajeno', 'factura', '0001-00000011', '2026-10-10', 'emitida', 77777, 94110)
  ) as v(org, nombre, tipo, numero, fecha, estado, sin_iva, con_iva)
  join clientes c on c.organizacion_id = v.org::uuid and c.nombre = v.nombre;

-- La nota de crédito exige factura de origen y tipo (comprobantes_venta_nc_ck): cuelga de la 0001-00000001.
insert into dominio.comprobantes_venta
  (organizacion_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, comprobante_origen_id, nc_tipo)
select o.organizacion_id, o.cliente_id, 'nota_credito', '0001-00000005', date '2026-10-12', 'emitida', 200, 242, o.id, 'devolucion_productos'
  from dominio.comprobantes_venta o
 where o.organizacion_id = '11111111-1111-1111-1111-111111111111' and o.numero = '0001-00000001';

insert into dominio.comprobantes_venta_lineas
  (organizacion_id, comprobante_id, orden, producto_id, descripcion, cantidad, precio_unitario, escala, deposito_id, subtotal_sin_iva, iva)
select v.org::uuid, cv.id, v.orden::int, p.id, p.nombre, 1, v.sin_iva, 'x1', d.id, v.sin_iva, v.iva
  from (values
    ('11111111-1111-1111-1111-111111111111', '0001-00000001', 1, 'AUR-1', 600, 126),
    ('11111111-1111-1111-1111-111111111111', '0001-00000001', 2, 'CAB-1', 400, 84),
    ('11111111-1111-1111-1111-111111111111', '0001-00000002', 1, 'MOU-1', 500, 105),
    ('11111111-1111-1111-1111-111111111111', '0001-00000003', 1, 'AUR-1', 300, 63),
    ('11111111-1111-1111-1111-111111111111', '0001-00000004', 1, 'CAB-1', 800, 168),
    ('11111111-1111-1111-1111-111111111111', '0001-00000005', 1, 'AUR-1', 200, 42),
    ('11111111-1111-1111-1111-111111111111', '0001-00000006', 1, 'AUR-1', 9999, 2100),
    ('11111111-1111-1111-1111-111111111111', '0001-00000007', 1, 'AUR-1', 7777, 1633),
    ('11111111-1111-1111-1111-111111111111', '0001-00000008', 1, 'AUR-1', 1234, 259),
    ('11111111-1111-1111-1111-111111111111', '0001-00000009', 1, 'MOU-1', 400, 84),
    ('11111111-1111-1111-1111-111111111111', '0001-00000010', 1, 'AUR-1', 5000, 1050),
    ('22222222-2222-2222-2222-222222222222', '0001-00000011', 1, 'AJE-1', 77777, 16333)
  ) as v(org, comprobante, orden, sku, sin_iva, iva)
  join dominio.comprobantes_venta cv on cv.organizacion_id = v.org::uuid and cv.numero = v.comprobante
  join dominio.productos p on p.organizacion_id = v.org::uuid and p.sku = v.sku
  join dominio.depositos d on d.organizacion_id = v.org::uuid and d.por_defecto;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- ============================================================================
-- Sin producto ni categoría: igual que el ranking básico (US2-4)
-- ============================================================================

select results_eq(
  $$select posicion, nombre, comprobantes, facturado, total_filas
      from ranking_clientes_por_dimension('2026-10-01', '2026-10-31') order by posicion$$,
  $$select posicion, nombre, comprobantes, facturado, total_filas
      from ranking_clientes('2026-10-01', '2026-10-31') order by posicion$$,
  'sin filtros nuevos devuelve lo mismo que ranking_clientes'
);

select results_eq(
  $$select nombre, comprobantes, facturado from ranking_clientes_por_dimension('2026-10-01', '2026-10-31') order by posicion$$,
  $$values ('Alfa', 2::bigint, 1300::numeric), ('Gamma', 1::bigint, 800::numeric),
           ('Delta', 1::bigint, 400::numeric), ('Beta', 1::bigint, 300::numeric)$$,
  'importe del comprobante, nota de crédito resta sin contar comprobante; presupuesto, anulada y fuera de rango no suman'
);

-- ============================================================================
-- Producto: suma de LÍNEAS, no del comprobante (US2-2)
-- ============================================================================

select results_eq(
  $$select posicion, nombre, comprobantes, facturado
      from ranking_clientes_por_dimension('2026-10-01', '2026-10-31', 'b1000000-0000-0000-0000-000000000001') order by posicion$$,
  $$values (1::bigint, 'Alfa', 1::bigint, 400::numeric), (2::bigint, 'Beta', 1::bigint, 300::numeric)$$,
  'producto: suma solo las líneas del producto (600 − 200 de la nota), no los 1.000 del comprobante'
);

select results_eq(
  $$select nombre, facturado from ranking_clientes_por_dimension('2026-10-01', '2026-10-31', 'b1000000-0000-0000-0000-000000000002') order by posicion$$,
  $$values ('Gamma', 800::numeric), ('Alfa', 400::numeric)$$,
  'otro producto: Gamma 800 y Alfa 400 (solo la línea del cable)'
);

select results_eq(
  $$select nombre, facturado from ranking_clientes_por_dimension('2026-10-01', '2026-10-31', 'b1000000-0000-0000-0000-000000000001', null, null, null, false, true) order by posicion$$,
  $$values ('Alfa', 484::numeric), ('Beta', 363::numeric)$$,
  'con IVA: subtotal + IVA de la línea, y la nota resta con el mismo criterio'
);

select is(
  (select count(*) from ranking_clientes_por_dimension('2026-10-01', '2026-10-31', 'b1000000-0000-0000-0000-000000000001')
    where nombre = 'Consumidor final'),
  0::bigint,
  'Consumidor final excluido por defecto'
);

select results_eq(
  $$select nombre, facturado from ranking_clientes_por_dimension('2026-10-01', '2026-10-31', 'b1000000-0000-0000-0000-000000000001', null, null, null, true) order by posicion limit 1$$,
  $$values ('Consumidor final', 5000::numeric)$$,
  'Consumidor final solo aparece si se lo incluye'
);

-- ============================================================================
-- Categoría: la raíz incluye sus subcategorías (US2-3)
-- ============================================================================

select results_eq(
  $$select nombre, comprobantes, facturado from ranking_clientes_por_dimension('2026-10-01', '2026-10-31', null, 'c1000000-0000-0000-0000-000000000001') order by posicion$$,
  $$values ('Alfa', 1::bigint, 800::numeric), ('Gamma', 1::bigint, 800::numeric), ('Beta', 1::bigint, 300::numeric)$$,
  'categoría raíz: incluye la subcategoría (Auricular + Cable); empate de Alfa y Gamma por nombre'
);

select results_eq(
  $$select nombre, facturado from ranking_clientes_por_dimension('2026-10-01', '2026-10-31', null, 'c1000000-0000-0000-0000-000000000002') order by posicion$$,
  $$values ('Gamma', 800::numeric), ('Alfa', 400::numeric)$$,
  'subcategoría: solo sus productos'
);

select results_eq(
  $$select nombre, facturado from ranking_clientes_por_dimension('2026-10-01', '2026-10-31', null, 'c1000000-0000-0000-0000-000000000003') order by posicion$$,
  $$values ('Alfa', 500::numeric), ('Delta', 400::numeric)$$,
  'otra categoría raíz sin hijas'
);

select results_eq(
  $$select nombre, facturado from ranking_clientes_por_dimension('2026-10-01', '2026-10-31',
      'b1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001') order by posicion$$,
  $$values ('Alfa', 400::numeric), ('Beta', 300::numeric)$$,
  'producto ∩ categoría: el producto pertenece a la categoría'
);

select is(
  (select count(*) from ranking_clientes_por_dimension('2026-10-01', '2026-10-31',
      'b1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002')),
  0::bigint,
  'producto ∩ categoría: si el producto no es de la categoría, el resultado es vacío'
);

select results_eq(
  $$select nombre, facturado from ranking_clientes_por_dimension('2026-10-01', '2026-10-31',
      'b1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001') order by posicion$$,
  $$values ('Gamma', 800::numeric), ('Alfa', 400::numeric)$$,
  'producto de una subcategoría ∩ su categoría raíz'
);

-- ============================================================================
-- Participación sobre el conjunto filtrado completo (US2-5)
-- ============================================================================

select is(
  (select round(sum(participacion), 6) from ranking_clientes_por_dimension('2026-10-01', '2026-10-31', null, 'c1000000-0000-0000-0000-000000000001')),
  100::numeric,
  'la participación del ranking filtrado suma 100 %'
);

select is(
  (select round(sum(participacion), 6) from ranking_clientes_por_dimension('2026-10-01', '2026-10-31', null, 'c1000000-0000-0000-0000-000000000001', null, null, false, false, 2, 1)),
  round(800::numeric * 100 / 1900, 6),
  'la participación de una página se calcula sobre el total filtrado, no sobre la página'
);

-- ============================================================================
-- Provincia: sin mayúsculas ni tildes (US2-4)
-- ============================================================================

select results_eq(
  $$select nombre, facturado from ranking_clientes_por_dimension('2026-10-01', '2026-10-31', null, null, 'cordoba') order by posicion$$,
  $$values ('Alfa', 1300::numeric), ('Beta', 300::numeric)$$,
  'provincia «cordoba» coincide con «Córdoba» y «CORDOBA»; el importe es el del comprobante'
);

select results_eq(
  $$select nombre from ranking_clientes_por_dimension('2026-10-01', '2026-10-31', null, null, '  CÓRDOBA ') order by posicion$$,
  $$values ('Alfa'), ('Beta')$$,
  'provincia con mayúsculas, tilde y espacios sobrantes'
);

select results_eq(
  $$select nombre from ranking_clientes_por_dimension('2026-10-01', '2026-10-31', null, null, 'Santa Fe')$$,
  $$values ('Gamma')$$,
  'otra provincia'
);

select is(
  (select count(*) from ranking_clientes_por_dimension('2026-10-01', '2026-10-31', null, null, 'Mendoza')),
  0::bigint,
  'una provincia sin clientes devuelve vacío (Delta, sin provincia, no coincide con ninguna)'
);

-- ============================================================================
-- Combinación con los filtros existentes (US2-1)
-- ============================================================================

select results_eq(
  $$select nombre, facturado from ranking_clientes_por_dimension('2026-10-01', '2026-10-31',
      'b1000000-0000-0000-0000-000000000001', null, 'cordoba') order by posicion$$,
  $$values ('Alfa', 400::numeric), ('Beta', 300::numeric)$$,
  'producto + provincia'
);

select is(
  (select count(*) from ranking_clientes_por_dimension('2026-10-01', '2026-10-31',
      'b1000000-0000-0000-0000-000000000001', null, 'santa fe')),
  0::bigint,
  'producto + provincia sin coincidencias: vacío'
);

select results_eq(
  $$select nombre from ranking_clientes_por_dimension('2026-10-01', '2026-10-31',
      'b1000000-0000-0000-0000-000000000002', null, null, 'mayorista') order by posicion$$,
  $$values ('Gamma'), ('Alfa')$$,
  'producto + tipo mayorista'
);

select is(
  (select count(*) from ranking_clientes_por_dimension('2026-10-01', '2026-10-31',
      'b1000000-0000-0000-0000-000000000002', null, null, 'minorista')),
  0::bigint,
  'producto + tipo minorista: vacío'
);

select results_eq(
  $$select nombre from ranking_clientes_por_dimension('2026-10-01', '2026-10-31',
      'b1000000-0000-0000-0000-000000000001', null, null, null, false, false, 1, 25, 'a1000000-0000-0000-0000-000000000001')$$,
  $$values ('Alfa')$$,
  'producto + tienda: solo los clientes habilitados en ella'
);

select results_eq(
  $$select nombre from ranking_clientes_por_dimension('2026-10-01', '2026-10-31', null, null, null, null, false, false, 1, 25, 'a1000000-0000-0000-0000-000000000001') order by posicion$$,
  $$values ('Alfa'), ('Gamma')$$,
  'solo tienda: igual que el ranking básico'
);

-- ============================================================================
-- Paginación
-- ============================================================================

select results_eq(
  $$select posicion, nombre, total_filas from ranking_clientes_por_dimension(
      '2026-10-01', '2026-10-31', null, null, null, null, false, false, 2, 2) order by posicion$$,
  $$values (3::bigint, 'Delta', 4::bigint), (4::bigint, 'Beta', 4::bigint)$$,
  'página 2 de tamaño 2: posiciones 3 y 4 y total de filas completo'
);

-- ============================================================================
-- Producto o categoría de otra organización o inexistente (US2-8, FR-007)
-- ============================================================================

select is(
  (select count(*) from ranking_clientes_por_dimension('2026-10-01', '2026-10-31', 'b2000000-0000-0000-0000-000000000001')),
  0::bigint,
  'producto de otra organización: vacío, nunca filas ajenas'
);

select is(
  (select count(*) from ranking_clientes_por_dimension('2026-10-01', '2026-10-31', null, 'c2000000-0000-0000-0000-000000000001')),
  0::bigint,
  'categoría de otra organización: vacío'
);

select is(
  (select count(*) from ranking_clientes_por_dimension('2026-10-01', '2026-10-31', 'b9999999-9999-9999-9999-999999999999')),
  0::bigint,
  'producto inexistente: vacío'
);

-- ============================================================================
-- Validaciones (FR-008)
-- ============================================================================

select throws_ok($$select * from ranking_clientes_por_dimension('2026-10-31', '2026-10-01')$$, '22023', null, 'Hasta anterior a Desde: rechazado');
select throws_ok($$select * from ranking_clientes_por_dimension(null, '2026-10-31')$$, '22023', null, 'fecha nula: rechazado');
select throws_ok($$select * from ranking_clientes_por_dimension('2020-01-01', '2026-01-02')$$, '22023', null, 'más de 5 años: rechazado');
select throws_ok($$select * from ranking_clientes_por_dimension('2026-10-01', '2026-10-31', null, null, null, 'otro')$$, '22023', null, 'tipo inválido: rechazado');
select throws_ok($$select * from ranking_clientes_por_dimension('2026-10-01', '2026-10-31', null, null, repeat('a', 101))$$, '22023', null, 'provincia de más de 100 caracteres: rechazado');
select throws_ok($$select * from ranking_clientes_por_dimension('2026-10-01', '2026-10-31', null, null, null, null, false, false, 0)$$, '22023', null, 'página 0: rechazado');
select throws_ok($$select * from ranking_clientes_por_dimension('2026-10-01', '2026-10-31', null, null, null, null, false, false, 1, 1001)$$, '22023', null, 'tamaño mayor a 1.000: rechazado');

-- ============================================================================
-- Niveles de la sección Clientes, organización y anon (FR-008)
-- ============================================================================

select pg_temp.como('d4000000-0000-0000-0000-000000000001');
select ok(
  (select count(*) from ranking_clientes_por_dimension('2026-10-01', '2026-10-31', 'b1000000-0000-0000-0000-000000000001')) > 0,
  'consulta (Clientes en «lectura») puede usar los filtros'
);

select pg_temp.como('d5000000-0000-0000-0000-000000000001');
select throws_ok($$select * from ranking_clientes_por_dimension('2026-10-01', '2026-10-31')$$, '42501', null, 'depósito (Clientes en «ninguno»): sin permiso, también llamando directo');

select pg_temp.como('d3000000-0000-0000-0000-000000000001');
select throws_ok($$select * from ranking_clientes_por_dimension('2026-10-01', '2026-10-31')$$, '42501', null, 'sin membresía: sin permiso');

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select results_eq(
  $$select nombre, facturado from ranking_clientes_por_dimension('2026-10-01', '2026-10-31')$$,
  $$values ('Ajeno', 77777::numeric)$$,
  'otra organización solo ve sus propias filas'
);

reset role;
set local role anon;
select throws_ok($$select * from ranking_clientes_por_dimension('2026-10-01', '2026-10-31')$$, '42501', null, '«anon» no puede ejecutar ranking_clientes_por_dimension');

reset role;
select ok(
  not has_function_privilege('anon', 'public.ranking_clientes_por_dimension(date, date, uuid, uuid, text, text, boolean, boolean, integer, integer, uuid)', 'execute'),
  'anon no tiene EXECUTE sobre ranking_clientes_por_dimension'
);
select ok(
  has_function_privilege('authenticated', 'public.ranking_clientes_por_dimension(date, date, uuid, uuid, text, text, boolean, boolean, integer, integer, uuid)', 'execute'),
  'authenticated tiene EXECUTE sobre ranking_clientes_por_dimension'
);

select * from finish();
rollback;
