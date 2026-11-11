-- F-CLI-19 (MSF-451, épica MSF-450, spec 20261109-100000-cuenta-corriente-y-saldo-cliente,
-- FR-001…FR-004, SC-001, SC-002): `public.cuenta_corriente_cliente` — la cuenta corriente del
-- cliente: saldo total, comprobantes abiertos y sus filas (id, total, cobrado y saldo).
--
-- Qué se comprueba:
-- · el saldo de cada comprobante es el de `private.saldo_comprobante` (F-VTA-12) —el único
--   dueño de la regla— y el total es la suma de los abiertos (FR-002, FR-004, SC-001);
-- · cada fila trae el id del comprobante: el número se repite entre tiendas (el correlativo es
--   por organización, empresa y tipo) y el id es lo que distingue las filas;
-- · entran solo las facturas que no están en `borrador`, `anulada` ni `cobrado` (una cobrada sin fila
--   de cobro está saldada): presupuesto, anulada,
--   borrador y nota de crédito quedan fuera (FR-003);
-- · una factura en estado «deuda» (sin cobros) debe su total completo (FR-002);
-- · un cliente sin deuda devuelve saldo 0 y sin documentos; un cliente de otra organización no
--   revela nada (FR-001);
-- · el alcance por tienda: quien no accede a una tienda no ve su deuda (`empresas_accesibles`);
-- · los niveles de la sección Clientes y la ejecutabilidad por `anon` (SC-002).
begin;

select plan(44);

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

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda Uno'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda Dos'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Ajena');

insert into clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 101, 'Alfa', 'mayorista'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 102, 'Sin deuda', 'minorista'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 201, 'Ajeno', 'minorista');

-- Consulta trabaja solo en Tienda Uno: no ve la deuda de Tienda Dos.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d4000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');

insert into dominio.formas_pago (id, organizacion_id, empresa_id, nombre, tipo) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'Transferencia Uno', 'transferencia'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'Transferencia Dos', 'transferencia');

-- Fechas relativas a hoy: el orden de la cuenta corriente depende de ellas.
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva)
values
  -- En deuda, sin cobros: debe su total completo.
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000001', current_date - 5, 'deuda', 1000, 1210),
  -- Cobro parcial: queda saldo.
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000002', current_date - 4, 'confirmada', 800, 1000),
  -- Cobrada: saldo 0, no aparece.
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000003', current_date - 3, 'cobrado', 400, 500),
  -- De la otra tienda: suma en el mismo saldo (FR-007). Comparte el número con la primera
  -- factura: el correlativo es por empresa, así que el número se repite entre tiendas y la
  -- fila se distingue por su id.
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000001', current_date - 2, 'confirmada', 1600, 2000),
  -- Presupuesto: no es deuda.
  ('a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'presupuesto', '0001-00000005', current_date - 1, 'confirmada', 9000, 12099),
  -- Anulada, borrador y nota de crédito: ninguno debe nada.
  ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000006', current_date - 1, 'anulada', 8000, 9680),
  ('a1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000007', current_date - 1, 'borrador', 7000, 8470),
  -- Cobro que supera el total: el saldo es 0, no negativo.
  ('a1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000009', current_date - 1, 'confirmada', 200, 300),
  -- Cobrada sin fila de cobro (mostrador o anterior al libro): está saldada, no es deuda.
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000010', current_date - 1, 'cobrado', 500, 600),
  -- De otra organización: no se ve desde la primera.
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 'factura', '0002-00000001', current_date - 1, 'deuda', 70000, 77000);

-- La nota de crédito cuelga de una factura (regla de la base). Esta es la que genera la ANULACIÓN de la factura 06:
-- como esa factura ya no figura en la cuenta corriente, la nota no se descuenta dos veces (los casos de notas de
-- crédito sobre facturas abiertas están más abajo, con su propio cliente).
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva,
   comprobante_origen_id, nc_tipo)
values
  ('a1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'nota_credito', '0001-00000008', current_date - 1, 'emitida', 300, 363, 'a1000000-0000-0000-0000-000000000006', 'devolucion_importe');

insert into dominio.cobros_comprobante
  (organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, origen, registrado_por, registrado_por_nombre)
values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 400, 'f1000000-0000-0000-0000-000000000001', 'manual', 'd1000000-0000-0000-0000-000000000001', 'Admin Uno'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', 500, 'f1000000-0000-0000-0000-000000000001', 'manual', 'd1000000-0000-0000-0000-000000000001', 'Admin Uno'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000004', 500, 'f1000000-0000-0000-0000-000000000002', 'manual', 'd1000000-0000-0000-0000-000000000001', 'Admin Uno'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000009', 500, 'f1000000-0000-0000-0000-000000000001', 'manual', 'd1000000-0000-0000-0000-000000000001', 'Admin Uno');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is(
  (select count(*) from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000001') where id = 'a1000000-0000-0000-0000-00000000000a'),
  0::bigint, 'una factura cobrada sin fila de cobro no es deuda');

-- El saldo total y la cantidad de comprobantes abiertos.
select is(
  (select saldo_total from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000001') limit 1),
  3310::numeric, 'el saldo total es la suma de los comprobantes abiertos (1.210 + 600 + 1.500)');
select is(
  (select comprobantes from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000001') limit 1),
  3::bigint, 'el cliente tiene 3 comprobantes con saldo');
select is(
  (select count(*) from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000001')),
  3::bigint, 'la cuenta corriente lista un documento por comprobante abierto');
select is(
  (select sum(saldo) from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000001')),
  3310::numeric, 'el saldo total es la suma de los saldos listados (FR-004)');

-- Las filas: documento, total, cobrado y saldo; del más reciente al más antiguo.
select results_eq(
  $$select id, numero, estado, total_con_iva, cobrado, saldo from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000001')$$,
  $$values
    ('a1000000-0000-0000-0000-000000000004'::uuid, '0001-00000001', 'confirmada', 2000::numeric, 500::numeric, 1500::numeric),
    ('a1000000-0000-0000-0000-000000000002'::uuid, '0001-00000002', 'confirmada', 1000::numeric, 400::numeric, 600::numeric),
    ('a1000000-0000-0000-0000-000000000001'::uuid, '0001-00000001', 'deuda', 1210::numeric, 0::numeric, 1210::numeric)$$,
  'las filas traen el id, el número, el total, el cobrado y el saldo, ordenadas por fecha descendente');
select is(
  (select count(*) from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000001')
    where numero = '0001-00000001'),
  2::bigint, 'el número se repite entre tiendas: las dos facturas con el mismo número son filas distintas');
select is(
  (select count(distinct id) from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000001')),
  3::bigint, 'cada fila es un comprobante distinto: el id la identifica aunque el número se repita');
select is(
  (select saldo from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000001')
    where id = 'a1000000-0000-0000-0000-000000000001'),
  1210::numeric, 'la factura en estado «deuda» debe su total completo');
select is(
  (select count(*) from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000001')
    where numero in ('0001-00000003', '0001-00000005', '0001-00000006', '0001-00000007', '0001-00000008', '0001-00000009')),
  0::bigint, 'no aparecen la cobrada, el presupuesto, la anulada, el borrador, la nota de crédito ni la que tiene cobro de más');

-- SC-001: el saldo sale de `private.saldo_comprobante` (F-VTA-12), su único dueño, y la función
-- interna no la ejecuta `authenticated`: el test la llama como el dueño de la base.
reset role;
select results_eq(
  $$select c.saldo, s.saldo
     from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000001') c
     join private.saldo_comprobante(c.id) s on true
    order by c.id$$,
  $$values
    (1210::numeric, 1210::numeric),
    (600::numeric, 600::numeric),
    (1500::numeric, 1500::numeric)$$,
  'SC-001: el saldo de cada documento cuadra con private.saldo_comprobante, documento por documento');
select is(
  (select count(*) from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000001') c
     join private.saldo_comprobante(c.id) s on true
    where c.total_con_iva = s.total and c.cobrado = s.cobrado and c.saldo = s.saldo),
  3::bigint, 'total, cobrado y saldo de cada fila son los de private.saldo_comprobante');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- Cliente sin deuda: saldo 0 y sin documentos.
select results_eq(
  $$select saldo_total, comprobantes, numero from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000002')$$,
  $$values (0::numeric, 0::bigint, null::text)$$,
  'cliente sin deuda: saldo 0, 0 comprobantes y sin documentos');

-- Cliente de otra organización o inexistente: no se revela nada.
select results_eq(
  $$select saldo_total, comprobantes, numero from cuenta_corriente_cliente('c2000000-0000-0000-0000-000000000001')$$,
  $$values (0::numeric, 0::bigint, null::text)$$,
  'un cliente de otra organización devuelve saldo 0 y sin documentos');
select results_eq(
  $$select saldo_total, comprobantes, numero from cuenta_corriente_cliente('c9000000-0000-0000-0000-000000000009')$$,
  $$values (0::numeric, 0::bigint, null::text)$$,
  'un cliente inexistente devuelve saldo 0 y sin documentos');

-- Validaciones.
select throws_ok($$select * from cuenta_corriente_cliente(null)$$, '22023', null, 'cliente nulo se rechaza');

-- Niveles de la sección Clientes: lectura y edición ven; ninguno y sin membresía, no.
select pg_temp.como('d4000000-0000-0000-0000-000000000001');
select is(
  (select saldo_total from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000001') limit 1),
  1810::numeric, 'con lectura en Clientes (rol consulta) se ve la cuenta corriente de sus tiendas');
select is(
  (select count(*) from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000001') where id = 'a1000000-0000-0000-0000-000000000004'),
  0::bigint, 'quien no accede a Tienda Dos no ve su factura en deuda');

select pg_temp.como('d5000000-0000-0000-0000-000000000001');
select throws_ok($$select * from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000001')$$, '42501', null,
  'depósito (Clientes en «ninguno»): sin permiso, también llamando directo');

select pg_temp.como('d3000000-0000-0000-0000-000000000001');
select throws_ok($$select * from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000001')$$, '42501', null,
  'sin membresía no se ve la cuenta corriente');

-- Otra organización no ve el cliente de la primera.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(
  (select saldo_total from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000001') limit 1),
  0::numeric, 'el administrador de otra organización no ve la deuda del cliente ajeno');
select is(
  (select saldo_total from cuenta_corriente_cliente('c2000000-0000-0000-0000-000000000001') limit 1),
  77000::numeric, 'cada organización ve solo lo suyo');


-- ---------------------------------------------------------------------------------------------
-- Casos de borde (revisión final de MSF-450): centavos, cada estado vivo, tienda desactivada,
-- persona sin tiendas y superadmin. Cada caso usa su propio cliente para no mover los totales
-- de los casos de arriba.
-- ---------------------------------------------------------------------------------------------
reset role;

insert into clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 103, 'Estados', 'minorista'),
  ('c1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 104, 'Centavos', 'minorista'),
  ('c1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 105, 'Tienda desactivada', 'minorista');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Tienda Desactivada', false);

-- Los diez estados que admite la matriz de transiciones: borrador, anulada y cobrado no son deuda; los
-- siete restantes sí (decisión provisoria de MSF-451, a confirmar con el cliente).
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva)
select ('b1000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001',
       'c1000000-0000-0000-0000-000000000003', 'factura', '0003-' || lpad(n::text, 8, '0'),
       current_date - n::int, e, 100, 100
  from unnest(array['borrador', 'confirmada', 'pendiente', 'aceptado', 'cobrado', 'en_proceso', 'deuda', 'armando', 'incompleto', 'anulada'])
       with ordinality as t(e, n);

-- Centavos: el saldo conserva los dos decimales (1.210,50 − 0,10 y 100,45 − 100,05).
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva)
values
  ('b2000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', 'factura', '0004-00000001', current_date - 2, 'deuda', 1000, 1210.50),
  ('b2000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', 'factura', '0004-00000002', current_date - 1, 'confirmada', 100, 100.45);

-- Tienda desactivada: su deuda no suma ni para el administrador; la de la tienda activa sí.
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva)
values
  ('b3000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000005', 'factura', '0005-00000001', current_date - 2, 'deuda', 100, 100),
  ('b3000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000005', 'factura', '0005-00000001', current_date - 1, 'deuda', 500, 500);

insert into dominio.cobros_comprobante
  (organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, origen, registrado_por, registrado_por_nombre)
values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 0.10, 'f1000000-0000-0000-0000-000000000001', 'manual', 'd1000000-0000-0000-0000-000000000001', 'Admin Uno'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000002', 100.05, 'f1000000-0000-0000-0000-000000000001', 'manual', 'd1000000-0000-0000-0000-000000000001', 'Admin Uno');

-- Una persona de la organización sin tiendas asignadas y un superadmin con la organización activa.
insert into auth.users (id, email) values
  ('d6000000-0000-0000-0000-000000000001', 'sin-tiendas@example.com'),
  ('d7000000-0000-0000-0000-000000000001', 'superadmin@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d6000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');
insert into superadmins (user_id) values ('d7000000-0000-0000-0000-000000000001');
insert into superadmin_organizacion_activa (user_id, organizacion_id) values
  ('d7000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select results_eq(
  $$select numero, estado from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000003') order by numero$$,
  $$values ('0003-00000002', 'confirmada'), ('0003-00000003', 'pendiente'), ('0003-00000004', 'aceptado'),
           ('0003-00000006', 'en_proceso'), ('0003-00000007', 'deuda'), ('0003-00000008', 'armando'),
           ('0003-00000009', 'incompleto')$$,
  'cuentan siete estados vivos; borrador, cobrado y anulada no son deuda');
select is(
  (select saldo_total from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000003') limit 1),
  700::numeric, 'el saldo de los siete estados vivos es 700');

select results_eq(
  $$select numero, total_con_iva, cobrado, saldo from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000004') order by numero$$,
  $$values ('0004-00000001', 1210.50::numeric, 0.10::numeric, 1210.40::numeric),
           ('0004-00000002', 100.45::numeric, 100.05::numeric, 0.40::numeric)$$,
  'los centavos se conservan: 1.210,50 − 0,10 = 1.210,40 y 100,45 − 100,05 = 0,40');
select is(
  (select saldo_total from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000004') limit 1),
  1210.80::numeric, 'el saldo total suma los centavos (1.210,80)');

select is(
  (select saldo_total from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000005') limit 1),
  100::numeric, 'la deuda de una tienda desactivada no suma, ni para el administrador');
select is(
  (select count(*) from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000005') where numero is not null),
  1::bigint, 'y su comprobante no figura en la lista (el número se repite entre tiendas)');

-- Notas de crédito (decisión del 2026-11-11): RESTAN de la deuda de la factura de la que cuelgan.
reset role;
insert into clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 106, 'Notas de crédito', 'minorista');

insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva,
   comprobante_origen_id, nc_tipo)
values
  -- A: 1.000 con una nota de 300 → debe 700.
  ('b6000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000006', 'factura', '0006-00000001', current_date - 4, 'deuda', 1000, 1000, null, null),
  -- B: 500 con 200 cobrados y una nota de 400 → supera el total: queda en 0 y no aparece (sin saldo a favor).
  ('b6000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000006', 'factura', '0006-00000002', current_date - 3, 'confirmada', 500, 500, null, null),
  -- C: 800 con una nota en borrador y otra anulada → ninguna cuenta: debe 800.
  ('b6000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000006', 'factura', '0006-00000003', current_date - 2, 'deuda', 800, 800, null, null),
  -- D: 600 con dos notas (100 y 50) → debe 450.
  ('b6000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000006', 'factura', '0006-00000004', current_date - 1, 'deuda', 600, 600, null, null);

insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva,
   comprobante_origen_id, nc_tipo)
values
  ('b6100000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000006', 'nota_credito', '0006-00000101', current_date, 'emitida', 300, 300, 'b6000000-0000-0000-0000-000000000001', 'devolucion_importe'),
  ('b6100000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000006', 'nota_credito', '0006-00000102', current_date, 'emitida', 400, 400, 'b6000000-0000-0000-0000-000000000002', 'devolucion_importe'),
  ('b6100000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000006', 'nota_credito', '0006-00000103', current_date, 'borrador', 999, 999, 'b6000000-0000-0000-0000-000000000003', 'devolucion_importe'),
  ('b6100000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000006', 'nota_credito', '0006-00000104', current_date, 'anulada', 888, 888, 'b6000000-0000-0000-0000-000000000003', 'devolucion_importe'),
  ('b6100000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000006', 'nota_credito', '0006-00000105', current_date, 'emitida', 100, 100, 'b6000000-0000-0000-0000-000000000004', 'descuento'),
  ('b6100000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000006', 'nota_credito', '0006-00000106', current_date, 'emitida', 50, 50, 'b6000000-0000-0000-0000-000000000004', 'descuento');

insert into dominio.cobros_comprobante
  (organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, origen, registrado_por, registrado_por_nombre)
values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000002', 200, 'f1000000-0000-0000-0000-000000000001', 'manual', 'd1000000-0000-0000-0000-000000000001', 'Admin Uno');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select results_eq(
  $$select numero, total_con_iva, cobrado, notas_credito, saldo from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000006') order by numero$$,
  $$values ('0006-00000001', 1000::numeric, 0::numeric, 300::numeric, 700::numeric),
           ('0006-00000003', 800::numeric, 0::numeric, 0::numeric, 800::numeric),
           ('0006-00000004', 600::numeric, 0::numeric, 150::numeric, 450::numeric)$$,
  'las notas de crédito emitidas restan de la factura; las de borrador o anuladas no cuentan');
select is(
  (select saldo_total from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000006') limit 1),
  1950::numeric, 'el saldo total descuenta las notas de crédito (700 + 800 + 450)');
select is(
  (select count(*) from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000006') where numero = '0006-00000002'),
  0::bigint, 'si cobros y notas superan el total la factura queda en 0 y no aparece (sin saldo a favor)');
select is(
  (select comprobantes from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000006') limit 1),
  3::bigint, 'cuenta 3 comprobantes con saldo');
select is(
  (select count(*) from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000006') where numero like '0006-001%'),
  0::bigint, 'las notas de crédito no figuran como filas de la cuenta');
select is(
  (select sum(saldo) from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000006')),
  (select saldo_total from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000006') limit 1),
  'el saldo total es la suma de los saldos listados también con notas de crédito (FR-004)');

-- Otra tienda a la que la persona no accede: sus notas tampoco se ven ni restan en lo ajeno.
select is(
  (select notas_credito from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000001') where id = 'a1000000-0000-0000-0000-000000000001'),
  0::numeric, 'la nota de la anulación (factura 06) no resta de otras facturas del cliente');
select is(
  (select saldo_total from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000001') limit 1),
  3310::numeric, 'la nota de crédito de una factura anulada no se descuenta dos veces');

-- Redondeo: el saldo sale con dos decimales.
select is(
  (select scale(saldo) <= 2 from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000004') limit 1),
  true, 'el saldo tiene como mucho 2 decimales');
select is(
  (select scale(saldo_total) <= 2 from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000004') limit 1),
  true, 'el saldo total tiene como mucho 2 decimales');

select pg_temp.como('d6000000-0000-0000-0000-000000000001');
select results_eq(
  $$select saldo_total, comprobantes, numero from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000001')$$,
  $$values (0::numeric, 0::bigint, null::text)$$,
  'una persona de la organización sin tiendas asignadas ve saldo 0 y sin documentos');

select pg_temp.como('d7000000-0000-0000-0000-000000000001');
select is(
  (select saldo_total from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000001') limit 1),
  3310::numeric, 'el superadmin con la organización activa ve la deuda de todas sus tiendas activas');
select is(
  (select saldo_total from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000005') limit 1),
  100::numeric, 'el superadmin tampoco suma la deuda de una tienda desactivada');

-- Ejecutabilidad: anon no; authenticated sí.
reset role;
select is(has_function_privilege('anon', 'public.cuenta_corriente_cliente(uuid)', 'EXECUTE'), false, 'anon no ejecuta cuenta_corriente_cliente');
select is(has_function_privilege('authenticated', 'public.cuenta_corriente_cliente(uuid)', 'EXECUTE'), true, 'authenticated ejecuta cuenta_corriente_cliente');

set local role anon;
select throws_ok($$select * from cuenta_corriente_cliente('c1000000-0000-0000-0000-000000000001')$$, '42501', null, '«anon» no puede llamar a cuenta_corriente_cliente');
reset role;

select * from finish();
rollback;
