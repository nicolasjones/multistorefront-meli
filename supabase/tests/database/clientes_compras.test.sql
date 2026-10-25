-- F-CLI-10 (MSF-269, épica MSF-126): `public.compras_de_cliente` (FR-012, SC-005):
-- total del año en curso con el predicado único, listado ordenado y paginado,
-- anuladas/presupuestos listados pero fuera del total, cliente sin compras → $ 0,
-- cliente ajeno o inexistente, niveles de sección, validaciones y `anon` sin ejecución.
begin;

select plan(24);

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

insert into clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 101, 'Alfa', 'mayorista'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 102, 'Sin compras', 'minorista'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 201, 'Ajeno', 'minorista');

-- Fechas relativas a hoy: el total del año depende del año en curso.
-- Alfa: factura de hoy 1.000 + factura de hoy 3.000 cuentan; la del año pasado, el
-- presupuesto y la anulada se listan pero no suman.
insert into dominio.comprobantes_venta
  (organizacion_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva)
values
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000001', (now() at time zone (select zona_horaria from public.organizaciones where id = '11111111-1111-1111-1111-111111111111'))::date, 'emitida', 1000, 1210),
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000002', (now() at time zone (select zona_horaria from public.organizaciones where id = '11111111-1111-1111-1111-111111111111'))::date, 'cobrada', 3000, 3630),
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000003', (date_trunc('year', (now() at time zone (select zona_horaria from public.organizaciones where id = '11111111-1111-1111-1111-111111111111'))::date) - interval '1 day')::date, 'cobrada', 5000, 6050),
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'presupuesto', '0001-00000004', (now() at time zone (select zona_horaria from public.organizaciones where id = '11111111-1111-1111-1111-111111111111'))::date, 'emitida', 9999, 12099),
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000005', (now() at time zone (select zona_horaria from public.organizaciones where id = '11111111-1111-1111-1111-111111111111'))::date, 'anulada', 8000, 9680),
  ('22222222-2222-2222-2222-222222222222', 'c2000000-0000-0000-0000-000000000001', 'factura', '0001-00000001', (now() at time zone (select zona_horaria from public.organizaciones where id = '11111111-1111-1111-1111-111111111111'))::date, 'emitida', 77777, 94110);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- Total del año: solo facturas no anuladas del año en curso, sin IVA (SC-005).
select is(
  (select facturado_anio from compras_de_cliente('c1000000-0000-0000-0000-000000000001') limit 1),
  4000::numeric, 'el total del año suma solo facturas no anuladas del año en curso, sin IVA');
select is(
  (select count(*) from compras_de_cliente('c1000000-0000-0000-0000-000000000001')),
  5::bigint, 'el listado incluye todos los comprobantes, con su estado');
select is(
  (select total_filas from compras_de_cliente('c1000000-0000-0000-0000-000000000001') limit 1),
  5::bigint, 'total_filas es el total de comprobantes');
select results_eq(
  $$select numero from compras_de_cliente('c1000000-0000-0000-0000-000000000001')$$,
  $$values ('0001-00000005'), ('0001-00000004'), ('0001-00000002'), ('0001-00000001'), ('0001-00000003')$$,
  'orden: fecha desc y número desc');
select results_eq(
  $$select estado from compras_de_cliente('c1000000-0000-0000-0000-000000000001') where numero in ('0001-00000005', '0001-00000004') order by numero desc$$,
  $$values ('anulada'), ('emitida')$$,
  'anuladas y presupuestos se listan con su estado');

-- Paginación en el servidor.
select is(
  (select count(*) from compras_de_cliente('c1000000-0000-0000-0000-000000000001', 1, 2)),
  2::bigint, 'página 1 de tamaño 2 devuelve 2 filas');
select results_eq(
  $$select numero from compras_de_cliente('c1000000-0000-0000-0000-000000000001', 3, 2)$$,
  $$values ('0001-00000003')$$,
  'la página 3 de tamaño 2 devuelve el último comprobante');
select is(
  (select facturado_anio from compras_de_cliente('c1000000-0000-0000-0000-000000000001', 3, 2) limit 1),
  4000::numeric, 'el total del año no depende de la página');

-- Página más allá del final: centinela con el total del año y la cantidad real.
select results_eq(
  $$select facturado_anio, numero, total_filas from compras_de_cliente('c1000000-0000-0000-0000-000000000001', 9, 2)$$,
  $$values (4000::numeric, null::text, 5::bigint)$$,
  'página pasada del final: centinela con total del año y cantidad real');

-- Cliente sin compras: fila centinela con $ 0.
select results_eq(
  $$select facturado_anio, numero, total_filas from compras_de_cliente('c1000000-0000-0000-0000-000000000002')$$,
  $$values (0::numeric, null::text, 0::bigint)$$,
  'cliente sin compras: una fila centinela con total 0 y sin número');

-- Cliente de otra organización o inexistente: sin filas.
select is((select count(*) from compras_de_cliente('c2000000-0000-0000-0000-000000000001')), 0::bigint,
  'un cliente de otra organización no devuelve filas');
select is((select count(*) from compras_de_cliente('c9000000-0000-0000-0000-000000000009')), 0::bigint,
  'un cliente inexistente no devuelve filas');

-- Validaciones.
select throws_ok($$select * from compras_de_cliente(null)$$, '22023', null, 'cliente nulo se rechaza');
select throws_ok($$select * from compras_de_cliente('c1000000-0000-0000-0000-000000000001', 0)$$, '22023', null, 'página 0 se rechaza');
select throws_ok($$select * from compras_de_cliente('c1000000-0000-0000-0000-000000000001', 1, 0)$$, '22023', null, 'tamaño 0 se rechaza');
select throws_ok($$select * from compras_de_cliente('c1000000-0000-0000-0000-000000000001', 1, 101)$$, '22023', null, 'tamaño mayor a 100 se rechaza');

-- Niveles de la sección Clientes: lectura y edición ven; ninguno y sin membresía, no.
select pg_temp.como('d4000000-0000-0000-0000-000000000001');
select is((select count(*) from compras_de_cliente('c1000000-0000-0000-0000-000000000001')), 5::bigint,
  'con lectura en Clientes (rol consulta) se ve el historial');

select pg_temp.como('d5000000-0000-0000-0000-000000000001');
select throws_ok($$select * from compras_de_cliente('c1000000-0000-0000-0000-000000000001')$$, '42501', null,
  'depósito (Clientes en «ninguno»): sin permiso, también llamando directo');

select pg_temp.como('d3000000-0000-0000-0000-000000000001');
select throws_ok($$select * from compras_de_cliente('c1000000-0000-0000-0000-000000000001')$$, '42501', null,
  'sin membresía no se ve el historial');

-- Otra organización no ve el cliente de la primera.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select count(*) from compras_de_cliente('c1000000-0000-0000-0000-000000000001')), 0::bigint,
  'el administrador de otra organización no ve las compras del cliente ajeno');
select is((select facturado_anio from compras_de_cliente('c2000000-0000-0000-0000-000000000001') limit 1), 77777::numeric,
  'cada organización ve solo lo suyo');

-- Ejecutabilidad: anon no; authenticated sí.
reset role;
select is(has_function_privilege('anon', 'public.compras_de_cliente(uuid, integer, integer)', 'EXECUTE'), false, 'anon no ejecuta compras_de_cliente');
select is(has_function_privilege('authenticated', 'public.compras_de_cliente(uuid, integer, integer)', 'EXECUTE'), true, 'authenticated ejecuta compras_de_cliente');

set local role anon;
select throws_ok($$select * from compras_de_cliente('c1000000-0000-0000-0000-000000000001')$$, '42501', null, '«anon» no puede llamar a compras_de_cliente');
reset role;

select * from finish();
rollback;
