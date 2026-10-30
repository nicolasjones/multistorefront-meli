-- F-CLI-14 (MSF-384, épica MSF-171): `public.ranking_clientes_comparado` (FR-001, FR-002; SC-001).
-- Universo de ambos períodos, variación y porcentaje nulo sobre base 0, extremos inclusivos, mismos
-- filtros que el ranking básico (tipo, Consumidor final, IVA, tienda), notas de crédito, orden y
-- desempate, paginación, validaciones, niveles de la sección Clientes, otra organización y `anon`.
-- Las fechas son fijas porque la función no depende del reloj (no rechaza días futuros).
begin;

select plan(32);

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

insert into clientes (organizacion_id, numero, nombre, tipo) values
  ('11111111-1111-1111-1111-111111111111', 101, 'Alfa', 'mayorista'),
  ('11111111-1111-1111-1111-111111111111', 102, 'Beta', 'minorista'),
  ('11111111-1111-1111-1111-111111111111', 103, 'Gamma', 'mayorista'),
  ('11111111-1111-1111-1111-111111111111', 104, 'Delta', 'minorista'),
  ('11111111-1111-1111-1111-111111111111', 105, 'Epsilon', 'minorista'),
  ('22222222-2222-2222-2222-222222222222', 201, 'Ajeno', 'minorista');

-- Solo Alfa y Gamma están habilitados en la tienda.
insert into clientes_empresas (cliente_id, empresa_id, organizacion_id)
select c.id, 'a1000000-0000-0000-0000-000000000001', c.organizacion_id
  from clientes c
 where c.organizacion_id = '11111111-1111-1111-1111-111111111111' and c.nombre in ('Alfa', 'Gamma');

-- Período aplicado: octubre 2026. Comparación: septiembre 2026.
-- Alfa: octubre 1.000 (día 1) + 3.000 (día 31) − nota de crédito 500 = 3.500 en 2 facturas; septiembre 1.000 (día 30);
--       el 31/08 (5.000), el presupuesto y la anulada no suman.
-- Beta: octubre 2.000, sin septiembre. Epsilon: igual que Beta (empate, desempata el nombre).
-- Gamma: solo septiembre 3.000 (día 1). Delta: solo presupuesto y anulada, no aparece.
-- Consumidor final: octubre 6.000.
insert into dominio.comprobantes_venta
  (organizacion_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva)
select v.org::uuid, c.id, v.tipo, v.numero, v.fecha::date, v.estado, v.sin_iva, v.con_iva
  from (values
    ('11111111-1111-1111-1111-111111111111', 'Alfa', 'factura', '0001-00000001', '2026-10-01', 'emitida', 1000, 1210),
    ('11111111-1111-1111-1111-111111111111', 'Alfa', 'factura', '0001-00000002', '2026-10-31', 'cobrada', 3000, 3630),
    ('11111111-1111-1111-1111-111111111111', 'Alfa', 'nota_credito', '0001-00000003', '2026-10-15', 'emitida', 500, 605),
    ('11111111-1111-1111-1111-111111111111', 'Alfa', 'factura', '0001-00000004', '2026-09-30', 'cobrada', 1000, 1210),
    ('11111111-1111-1111-1111-111111111111', 'Alfa', 'factura', '0001-00000005', '2026-08-31', 'cobrada', 5000, 6050),
    ('11111111-1111-1111-1111-111111111111', 'Alfa', 'presupuesto', '0001-00000006', '2026-10-10', 'emitida', 9999, 12099),
    ('11111111-1111-1111-1111-111111111111', 'Alfa', 'factura', '0001-00000007', '2026-10-05', 'anulada', 8000, 9680),
    ('11111111-1111-1111-1111-111111111111', 'Beta', 'factura', '0001-00000008', '2026-10-15', 'deuda', 2000, 2420),
    ('11111111-1111-1111-1111-111111111111', 'Epsilon', 'factura', '0001-00000009', '2026-10-20', 'emitida', 2000, 2420),
    ('11111111-1111-1111-1111-111111111111', 'Gamma', 'factura', '0001-00000010', '2026-09-01', 'emitida', 3000, 3630),
    ('11111111-1111-1111-1111-111111111111', 'Delta', 'presupuesto', '0001-00000011', '2026-10-12', 'emitida', 500, 605),
    ('11111111-1111-1111-1111-111111111111', 'Delta', 'factura', '0001-00000012', '2026-10-13', 'anulada', 700, 847),
    ('11111111-1111-1111-1111-111111111111', 'Consumidor final', 'factura', '0001-00000013', '2026-10-14', 'cobrada', 6000, 7260),
    ('22222222-2222-2222-2222-222222222222', 'Ajeno', 'factura', '0001-00000001', '2026-10-10', 'emitida', 77777, 94110)
  ) as v(org, nombre, tipo, numero, fecha, estado, sin_iva, con_iva)
  join clientes c on c.organizacion_id = v.org::uuid and c.nombre = v.nombre;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- ============================================================================
-- Universo, variación, extremos inclusivos, notas, orden y desempate (US1-2…5)
-- ============================================================================

select is(
  (select count(*) from ranking_clientes_comparado('2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30')),
  4::bigint,
  'incluye a los clientes de cualquiera de los dos períodos (Delta y Consumidor final quedan fuera)'
);

select results_eq(
  $$select posicion, nombre, comprobantes, facturado, comprobantes_comparacion, facturado_comparacion, variacion
      from ranking_clientes_comparado('2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30') order by posicion$$,
  $$values (1::bigint, 'Alfa', 2::bigint, 3500::numeric, 1::bigint, 1000::numeric, 2500::numeric),
           (2::bigint, 'Beta', 1::bigint, 2000::numeric, 0::bigint, 0::numeric, 2000::numeric),
           (3::bigint, 'Epsilon', 1::bigint, 2000::numeric, 0::bigint, 0::numeric, 2000::numeric),
           (4::bigint, 'Gamma', 0::bigint, 0::numeric, 1::bigint, 3000::numeric, -3000::numeric)$$,
  'extremos inclusivos, nota de crédito resta sin contar comprobante, orden por facturado y desempate por nombre'
);

select results_eq(
  $$select nombre, variacion_porcentaje
      from ranking_clientes_comparado('2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30') order by posicion$$,
  $$values ('Alfa', 250::numeric), ('Beta', null::numeric), ('Epsilon', null::numeric), ('Gamma', -100::numeric)$$,
  'variación porcentual: sobre la base de comparación; nula sobre base 0'
);

select is(
  (select count(*) from ranking_clientes_comparado('2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30')
    where nombre = 'Alfa' and facturado = 3500),
  1::bigint,
  'el 31/08, el presupuesto y la factura anulada no suman a ningún período'
);

select results_eq(
  $$select nombre, facturado, facturado_comparacion
      from ranking_clientes_comparado('2026-09-01', '2026-09-30', '2026-10-01', '2026-10-31')
     where nombre = 'Gamma'$$,
  $$values ('Gamma', 3000::numeric, 0::numeric)$$,
  'intercambiar los períodos intercambia las columnas'
);

select is(
  (select count(*) from ranking_clientes_comparado('2026-10-01', '2026-10-31', '2026-10-01', '2026-10-31')
    where variacion <> 0),
  0::bigint,
  'períodos idénticos: se permite y la variación es 0'
);

select is(
  (select variacion_porcentaje from ranking_clientes_comparado('2026-10-01', '2026-10-31', '2026-10-01', '2026-10-31')
    where nombre = 'Alfa'),
  0::numeric,
  'períodos idénticos: porcentaje 0 (base positiva)'
);

select is(
  (select count(*) from ranking_clientes_comparado('2026-10-01', '2026-10-31', '2026-10-15', '2026-11-15')),
  4::bigint,
  'períodos superpuestos: se permite'
);

select is(
  (select count(*) from ranking_clientes_comparado('2025-01-01', '2025-01-31', '2025-02-01', '2025-02-28')),
  0::bigint,
  'sin facturación en ninguno de los dos períodos: sin filas'
);

-- ============================================================================
-- Mismos filtros que el ranking básico (US1-4)
-- ============================================================================

select results_eq(
  $$select nombre from ranking_clientes_comparado('2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30', 'mayorista') order by posicion$$,
  $$values ('Alfa'), ('Gamma')$$,
  'filtro por tipo de cliente'
);

select results_eq(
  $$select nombre, facturado from ranking_clientes_comparado('2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30', null, true)
     where nombre = 'Consumidor final'$$,
  $$values ('Consumidor final', 6000::numeric)$$,
  'Consumidor final solo aparece si se lo incluye'
);

select is(
  (select count(*) from ranking_clientes_comparado('2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30')
    where nombre = 'Consumidor final'),
  0::bigint,
  'Consumidor final excluido por defecto'
);

select results_eq(
  $$select facturado, facturado_comparacion from ranking_clientes_comparado(
      '2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30', null, false, true) where nombre = 'Alfa'$$,
  $$values (4235::numeric, 1210::numeric)$$,
  'con IVA usa el total con IVA en ambos períodos y la nota resta'
);

select results_eq(
  $$select nombre from ranking_clientes_comparado('2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30',
      null, false, false, 1, 25, 'a1000000-0000-0000-0000-000000000001') order by posicion$$,
  $$values ('Alfa'), ('Gamma')$$,
  'filtro por tienda: solo los clientes habilitados en ella'
);

-- ============================================================================
-- Paginación
-- ============================================================================

select results_eq(
  $$select posicion, nombre, total_filas from ranking_clientes_comparado(
      '2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30', null, false, false, 2, 2) order by posicion$$,
  $$values (3::bigint, 'Epsilon', 4::bigint), (4::bigint, 'Gamma', 4::bigint)$$,
  'página 2 de tamaño 2: posiciones 3 y 4 y total de filas completo'
);

select is(
  (select count(*) from ranking_clientes_comparado('2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30', null, false, false, 3, 2)),
  0::bigint,
  'página más allá del final: sin filas'
);

-- ============================================================================
-- Validaciones (FR-002)
-- ============================================================================

select throws_ok($$select * from ranking_clientes_comparado('2026-10-31', '2026-10-01', '2026-09-01', '2026-09-30')$$, '22023', null, 'Hasta anterior a Desde: rechazado');
select throws_ok($$select * from ranking_clientes_comparado('2026-10-01', '2026-10-31', '2026-09-30', '2026-09-01')$$, '22023', null, 'comparación con Hasta anterior a Desde: rechazado');
select throws_ok($$select * from ranking_clientes_comparado(null, '2026-10-31', '2026-09-01', '2026-09-30')$$, '22023', null, 'fecha del período aplicado nula: rechazado');
select throws_ok($$select * from ranking_clientes_comparado('2026-10-01', '2026-10-31', null, '2026-09-30')$$, '22023', null, 'fecha de comparación nula: rechazado');
select throws_ok($$select * from ranking_clientes_comparado('2026-10-01', '2026-10-31', '2020-01-01', '2026-01-02')$$, '22023', null, 'comparación de más de 5 años: rechazado');
select throws_ok($$select * from ranking_clientes_comparado('2020-01-01', '2026-01-02', '2026-09-01', '2026-09-30')$$, '22023', null, 'período aplicado de más de 5 años: rechazado');
select throws_ok($$select * from ranking_clientes_comparado('2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30', 'otro')$$, '22023', null, 'tipo inválido: rechazado');
select throws_ok($$select * from ranking_clientes_comparado('2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30', null, false, false, 0)$$, '22023', null, 'página 0: rechazado');
select throws_ok($$select * from ranking_clientes_comparado('2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30', null, false, false, 1, 1001)$$, '22023', null, 'tamaño mayor a 1.000: rechazado');

-- ============================================================================
-- Niveles de la sección Clientes, organización y anon (FR-002)
-- ============================================================================

select pg_temp.como('d4000000-0000-0000-0000-000000000001');
select ok(
  (select count(*) from ranking_clientes_comparado('2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30')) > 0,
  'consulta (Clientes en «lectura») puede usar la comparación'
);

select pg_temp.como('d5000000-0000-0000-0000-000000000001');
select throws_ok($$select * from ranking_clientes_comparado('2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30')$$, '42501', null, 'depósito (Clientes en «ninguno»): sin permiso, también llamando directo');

select pg_temp.como('d3000000-0000-0000-0000-000000000001');
select throws_ok($$select * from ranking_clientes_comparado('2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30')$$, '42501', null, 'sin membresía: sin permiso');

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select results_eq(
  $$select nombre, facturado from ranking_clientes_comparado('2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30')$$,
  $$values ('Ajeno', 77777::numeric)$$,
  'otra organización solo ve sus propias filas'
);

reset role;
set local role anon;
select throws_ok($$select * from ranking_clientes_comparado('2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30')$$, '42501', null, '«anon» no puede ejecutar ranking_clientes_comparado');

reset role;
select ok(
  not has_function_privilege('anon', 'public.ranking_clientes_comparado(date, date, date, date, text, boolean, boolean, integer, integer, uuid)', 'execute'),
  'anon no tiene EXECUTE sobre ranking_clientes_comparado'
);
select ok(
  has_function_privilege('authenticated', 'public.ranking_clientes_comparado(date, date, date, date, text, boolean, boolean, integer, integer, uuid)', 'execute'),
  'authenticated tiene EXECUTE sobre ranking_clientes_comparado'
);

select * from finish();
rollback;
