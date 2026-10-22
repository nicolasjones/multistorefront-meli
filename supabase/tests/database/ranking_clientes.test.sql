-- F-CLI-08 (MSF-238, épica MSF-126): `public.ranking_clientes` y el predicado
-- único `private.comprobante_cuenta_como_facturado` (FR-003…FR-007, FR-014;
-- SC-001, SC-002, SC-003): extremos inclusivos, orden y desempate, anuladas y
-- presupuestos fuera, filtros de tipo / Consumidor final / IVA, participación,
-- paginación, validaciones, niveles de la sección Clientes, aislamiento por
-- organización y `anon` sin ejecución.
begin;

select plan(39);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com'),
  ('d3000000-0000-0000-0000-000000000001', 'sin-membresia@example.com'),
  ('d4000000-0000-0000-0000-000000000001', 'consulta-uno@example.com'),
  ('d5000000-0000-0000-0000-000000000001', 'deposito-uno@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d4000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

-- Cada organización ya trae su Consumidor final (Nº 1, minorista).
insert into clientes (organizacion_id, numero, nombre, tipo) values
  ('11111111-1111-1111-1111-111111111111', 101, 'Alfa', 'mayorista'),
  ('11111111-1111-1111-1111-111111111111', 102, 'Beta', 'minorista'),
  ('11111111-1111-1111-1111-111111111111', 103, 'Gamma', 'mayorista'),
  ('11111111-1111-1111-1111-111111111111', 104, 'Delta', 'minorista'),
  ('11111111-1111-1111-1111-111111111111', 105, 'Epsilon', 'minorista'),
  ('22222222-2222-2222-2222-222222222222', 201, 'Ajeno', 'minorista');

-- Alfa (octubre): 1.000 + 3.000 = 4.000 en 2 facturas (una en cada extremo del mes);
-- la de septiembre, el presupuesto y la anulada no suman. Beta y Epsilon empatan en 2.000
-- (desempata el nombre). Gamma 1.000. Delta solo tiene presupuesto y anulada: no aparece.
-- Consumidor final 6.000.
insert into dominio.comprobantes_venta
  (organizacion_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva)
select v.org::uuid, c.id, v.tipo, v.numero, v.fecha::date, v.estado, v.sin_iva, v.con_iva
  from (values
    ('11111111-1111-1111-1111-111111111111', 'Alfa', 'factura', '0001-00000001', '2026-10-01', 'emitida', 1000, 1210),
    ('11111111-1111-1111-1111-111111111111', 'Alfa', 'factura', '0001-00000002', '2026-10-31', 'cobrada', 3000, 3630),
    ('11111111-1111-1111-1111-111111111111', 'Alfa', 'factura', '0001-00000003', '2026-09-30', 'cobrada', 5000, 6050),
    ('11111111-1111-1111-1111-111111111111', 'Alfa', 'presupuesto', '0001-00000004', '2026-10-10', 'emitida', 9999, 12099),
    ('11111111-1111-1111-1111-111111111111', 'Alfa', 'factura', '0001-00000005', '2026-10-05', 'anulada', 8000, 9680),
    ('11111111-1111-1111-1111-111111111111', 'Beta', 'factura', '0001-00000006', '2026-10-15', 'deuda', 2000, 2420),
    ('11111111-1111-1111-1111-111111111111', 'Epsilon', 'factura', '0001-00000007', '2026-10-20', 'emitida', 2000, 2420),
    ('11111111-1111-1111-1111-111111111111', 'Gamma', 'factura', '0001-00000008', '2026-10-12', 'emitida', 1000, 1210),
    ('11111111-1111-1111-1111-111111111111', 'Delta', 'presupuesto', '0001-00000009', '2026-10-12', 'emitida', 500, 605),
    ('11111111-1111-1111-1111-111111111111', 'Delta', 'factura', '0001-00000010', '2026-10-13', 'anulada', 700, 847),
    ('11111111-1111-1111-1111-111111111111', 'Consumidor final', 'factura', '0001-00000011', '2026-10-14', 'cobrada', 6000, 7260),
    ('22222222-2222-2222-2222-222222222222', 'Ajeno', 'factura', '0001-00000001', '2026-10-10', 'emitida', 77777, 94110)
  ) as v(org, nombre, tipo, numero, fecha, estado, sin_iva, con_iva)
  join clientes c on c.organizacion_id = v.org::uuid and c.nombre = v.nombre;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Predicado único (FR-005)
-- ============================================================================

select ok(private.comprobante_cuenta_como_facturado('factura', 'deuda'), 'predicado: una factura en deuda cuenta');
select ok(not private.comprobante_cuenta_como_facturado('factura', 'anulada'), 'predicado: una factura anulada no cuenta');
select ok(not private.comprobante_cuenta_como_facturado('presupuesto', 'emitida'), 'predicado: un presupuesto no cuenta');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- ============================================================================
-- Orden, desempate, exclusiones y extremos inclusivos (SC-001, SC-002)
-- ============================================================================

select results_eq(
  $$select posicion::int, nombre, comprobantes::int, facturado from ranking_clientes('2026-10-01', '2026-10-31')$$,
  $$values (1, 'Alfa', 2, 4000::numeric), (2, 'Beta', 1, 2000::numeric), (3, 'Epsilon', 1, 2000::numeric), (4, 'Gamma', 1, 1000::numeric)$$,
  'ordena por facturado desc con desempate por nombre; sin anuladas, presupuestos, fuera de rango, Consumidor final ni otra organización'
);
select is((select max(total_filas) from ranking_clientes('2026-10-01', '2026-10-31')), 4::bigint, 'total_filas cuenta todos los clientes del ranking');
select ok(
  abs((select sum(participacion) from ranking_clientes('2026-10-01', '2026-10-31')) - 100) < 0.0001,
  'la participación de todas las filas suma 100 %'
);
select is(
  (select round(participacion, 1) from ranking_clientes('2026-10-01', '2026-10-31') where nombre = 'Alfa'),
  44.4::numeric, 'participación de Alfa = 4.000 / 9.000'
);
select results_eq(
  $$select nombre, facturado from ranking_clientes('2026-10-01', '2026-10-01')$$,
  $$values ('Alfa', 1000::numeric)$$,
  'el extremo Desde es inclusivo'
);
select results_eq(
  $$select nombre, facturado from ranking_clientes('2026-10-31', '2026-10-31')$$,
  $$values ('Alfa', 3000::numeric)$$,
  'el extremo Hasta es inclusivo'
);
select results_eq(
  $$select nombre from ranking_clientes('2026-10-02', '2026-10-30')$$,
  $$values ('Beta'), ('Epsilon'), ('Gamma')$$,
  'las facturas fuera de los extremos no suman'
);
select results_eq(
  $$select nombre, facturado from ranking_clientes('2026-09-01', '2026-09-30')$$,
  $$values ('Alfa', 5000::numeric)$$,
  'otro período devuelve solo lo de ese período'
);
select is((select count(*)::int from ranking_clientes('2025-01-01', '2025-01-31')), 0, 'un período sin facturas devuelve vacío sin fallar');

-- ============================================================================
-- Filtros: tipo, Consumidor final, con IVA (SC-002)
-- ============================================================================

select results_eq(
  $$select nombre, facturado from ranking_clientes('2026-10-01', '2026-10-31', 'mayorista')$$,
  $$values ('Alfa', 4000::numeric), ('Gamma', 1000::numeric)$$,
  'filtra por tipo mayorista'
);
select is(
  (select round(participacion, 1) from ranking_clientes('2026-10-01', '2026-10-31', 'mayorista') where nombre = 'Alfa'),
  80.0::numeric, 'la participación se recalcula sobre el subconjunto filtrado'
);
select results_eq(
  $$select nombre from ranking_clientes('2026-10-01', '2026-10-31', 'minorista')$$,
  $$values ('Beta'), ('Epsilon')$$,
  'filtra por tipo minorista (Consumidor final excluido por defecto)'
);
select results_eq(
  $$select nombre, facturado from ranking_clientes('2026-10-01', '2026-10-31', null, true) where posicion = 1$$,
  $$values ('Consumidor final', 6000::numeric)$$,
  'con el interruptor, Consumidor final entra al ranking'
);
select is(
  (select round(participacion, 1) from ranking_clientes('2026-10-01', '2026-10-31', null, true) where nombre = 'Alfa'),
  26.7::numeric, 'Consumidor final también entra en la participación (4.000 / 15.000)'
);
select results_eq(
  $$select nombre, facturado from ranking_clientes('2026-10-01', '2026-10-31', null, false, true)$$,
  $$values ('Alfa', 4840::numeric), ('Beta', 2420::numeric), ('Epsilon', 2420::numeric), ('Gamma', 1210::numeric)$$,
  '«Ver con IVA» suma total_con_iva'
);

-- ============================================================================
-- Paginación
-- ============================================================================

select results_eq(
  $$select posicion::int, nombre from ranking_clientes('2026-10-01', '2026-10-31', null, false, false, 2, 2)$$,
  $$values (3, 'Epsilon'), (4, 'Gamma')$$,
  'la segunda página conserva la posición global'
);
select is(
  (select round(participacion, 1) from ranking_clientes('2026-10-01', '2026-10-31', null, false, false, 2, 2) where nombre = 'Gamma'),
  11.1::numeric, 'la participación se calcula sobre el ranking completo, no sobre la página'
);
select is((select count(*)::int from ranking_clientes('2026-10-01', '2026-10-31', null, false, false, 3, 2)), 0, 'una página fuera de rango no devuelve filas');

-- Un cliente archivado conserva su facturación histórica en el ranking.
reset role;
update clientes set archivado_en = now() where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = 'Gamma';
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from ranking_clientes('2026-10-01', '2026-10-31')), 4, 'un cliente archivado sigue contando en el ranking');

-- ============================================================================
-- Validaciones de parámetros (FR-007)
-- ============================================================================

select throws_ok($$select * from ranking_clientes('2026-10-31', '2026-10-01')$$, '22023', null, 'Hasta anterior a Desde: rechazado');
select throws_ok($$select * from ranking_clientes(null, '2026-10-01')$$, '22023', null, 'fecha Desde nula: rechazado');
select throws_ok($$select * from ranking_clientes('2020-01-01', '2026-01-02')$$, '22023', null, 'rango mayor a 5 años: rechazado');
select lives_ok($$select * from ranking_clientes('2021-10-15', '2026-10-15')$$, 'rango de exactamente 5 años: aceptado');
select throws_ok($$select * from ranking_clientes('2026-10-01', '2026-10-31', 'otro')$$, '22023', null, 'tipo inválido: rechazado');
select throws_ok($$select * from ranking_clientes('2026-10-01', '2026-10-31', null, false, false, 0)$$, '22023', null, 'página 0: rechazado');
select throws_ok($$select * from ranking_clientes('2026-10-01', '2026-10-31', null, false, false, 2000000000, 1000)$$, '22023', null, 'página enorme: 22023 claro, sin desborde');
select throws_ok($$select * from ranking_clientes('2026-10-01', '2026-10-31', null, false, false, 1, 0)$$, '22023', null, 'tamaño 0: rechazado');
select throws_ok($$select * from ranking_clientes('2026-10-01', '2026-10-31', null, false, false, 1, 1001)$$, '22023', null, 'tamaño mayor a 1.000: rechazado');
select lives_ok($$select * from ranking_clientes('2026-10-01', '2026-10-31', null, false, false, 1, 1000)$$, 'tamaño 1.000: aceptado');

-- ============================================================================
-- Niveles de la sección Clientes, organización y anon (SC-003, FR-004, FR-014)
-- ============================================================================

select pg_temp.como('d4000000-0000-0000-0000-000000000001');
select is((select count(*)::int from ranking_clientes('2026-10-01', '2026-10-31')), 4, 'consulta (lectura en Clientes) ve el ranking');

select pg_temp.como('d5000000-0000-0000-0000-000000000001');
select throws_ok($$select * from ranking_clientes('2026-10-01', '2026-10-31')$$, '42501', null, 'depósito (Clientes en «ninguno»): sin permiso, también llamando directo');

select pg_temp.como('d3000000-0000-0000-0000-000000000001');
select throws_ok($$select * from ranking_clientes('2026-10-01', '2026-10-31')$$, '42501', null, 'sin membresía: sin permiso');

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select results_eq(
  $$select nombre, facturado from ranking_clientes('2026-10-01', '2026-10-31')$$,
  $$values ('Ajeno', 77777::numeric)$$,
  'otra organización solo ve sus propias filas'
);

reset role;
set local role anon;
select throws_ok($$select * from ranking_clientes('2026-10-01', '2026-10-31')$$, '42501', null, '«anon» no puede ejecutar ranking_clientes');

reset role;
select ok(
  not has_function_privilege('anon', 'public.ranking_clientes(date, date, text, boolean, boolean, integer, integer, uuid)', 'execute'),
  'anon no tiene EXECUTE sobre ranking_clientes'
);
select ok(
  has_function_privilege('authenticated', 'public.ranking_clientes(date, date, text, boolean, boolean, integer, integer, uuid)', 'execute'),
  'authenticated tiene EXECUTE sobre ranking_clientes'
);

select * from finish();
rollback;
