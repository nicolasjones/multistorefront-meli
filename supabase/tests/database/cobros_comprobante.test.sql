-- F-VTA-12 (MSF-389, épica MSF-195, spec 20261024-150000-ventas-cobros-y-conciliacion,
-- FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-010, SC-001): cobros por comprobante.
--
-- Cubre: tabla en `dominio` con RLS y sin escritura directa; saldo (total, cobrado, saldo);
-- lectura de los cobros del comprobante; registro del cobro (parcial, tope, serie, tipos de
-- documento), evento de actividad y aislamiento entre organizaciones.
--
-- Cubre también la RPC pública `registrar_cobro` (FR-002): permiso por rol (Mostrador y
-- Administración cobran; Operador sin la acción, Depósito y Consulta no), la acción sembrada en
-- `permisos_rol_accion`, la cuenta de cobro exigida / ajena / inactiva / no habilitada para la
-- tienda, la forma de pago desactivada o de otra tienda, los documentos que no admiten cobros y
-- el `hint` que le dice a la pantalla qué campo marcar.
--
-- Y la lectura del permiso para la pantalla (FR-007): `public.puede_registrar_cobro` dice si la
-- persona puede registrar cobros en una empresa (la acción `registrar_cobro` de Ventas con
-- Ventas en edición, resueltas con su rol en esa empresa): `anon` no la ejecuta y una tienda de
-- otra organización no habilita nada.
--
-- `rls_en_toda_tabla` (archivo aparte) recorre `public` y `dominio` y cubre la tabla nueva sin
-- tocarla; acá se afirma además que la tabla de cobros tiene RLS y ninguna política de escritura.
--
-- El paso a Cobrado/Deuda lo hace `private.marcar_estado_cobro_comprobante`, que llega con la
-- épica MSF-177 (PR #343). Mientras no esté mergeada, esos escenarios se OMITEN (skip): no se dan
-- por buenos. El resto se prueba igual.
--
-- El fixture corre como postgres (RLS no aplica) y las verificaciones como «authenticated»
-- vía request.jwt.claims, igual que PostgREST.
begin;

select no_plan();

-- ============================================================================
-- Fixture
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'mostrador-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'mostrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- El mostrador trabaja en San Javucho; la persona de consulta, en Mundo JC.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'mostrador'),
  ('d1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'consulta');

insert into clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 20, 'Cliente Dos', 'minorista');

-- Formas de pago: efectivo (sin cuenta), transferencia (exige cuenta, no genera deuda),
-- cuenta corriente (genera deuda) y una transferencia desactivada.
insert into dominio.formas_pago (id, organizacion_id, empresa_id, nombre, tipo, exige_cuenta_cobro, genera_deuda, activo) values
  ('b1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Efectivo', 'efectivo', false, false, true),
  ('b1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Transferencia', 'transferencia', true, false, true),
  ('b1000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Cuenta corriente', 'otro', true, true, true),
  ('b1000000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'Efectivo', 'efectivo', false, false, true),
  ('b1000000-0000-0000-0000-00000000000f', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Transferencia vieja', 'transferencia', true, false, false),
  ('b2000000-0000-0000-0000-00000000000e', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-00000000000c', 'Efectivo', 'efectivo', false, false, true);

-- Cuentas de cobro: una activa en San Javucho, una marcada «No usar», una habilitada solo en otra
-- tienda de la misma organización y una de la otra organización.
insert into dominio.cuentas_cobro (id, organizacion_id, nombre, titular, banco, activa) values
  ('e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Banco Uno', 'Titular Uno', 'Galicia', true),
  ('e1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Banco No usar', 'Titular Dos', 'Santander', false),
  ('e1000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Banco Mundo', 'Titular Cuatro', 'HSBC', true),
  ('e2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Banco Dos', 'Titular Tres', 'BBVA', true);

insert into dominio.cuentas_cobro_empresas (cuenta_id, empresa_id, organizacion_id) values
  ('e1000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111'),
  ('e1000000-0000-0000-0000-00000000000b', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111'),
  ('e1000000-0000-0000-0000-00000000000c', 'a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111'),
  ('e2000000-0000-0000-0000-00000000000c', 'a2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222');

-- Comprobantes: F1 es la factura que se cobra (1.000); F2 es de otra tienda de la misma
-- organización; FB está en borrador; FP es un presupuesto; FA está anulada; FD es la de deuda;
-- FO es de la otra organización.
-- Roles para el permiso por rol de la RPC: Operador (Ventas en edición, pero SIN la acción
-- `registrar_cobro`) y Depósito (Ventas en solo lectura). Los dos trabajan en San Javucho.
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000004', 'operador-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000005', 'deposito-uno@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('d1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'deposito');

insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, confirmado_en) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000001', '2026-12-01', 'confirmada', 1000, 1000, now()),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000002', '2026-12-01', 'confirmada', 1000, 1000, now()),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000003', '2026-12-01', 'borrador', 1000, 1000, null),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'presupuesto', '0001-00000004', '2026-12-01', 'pendiente', 1000, 1000, null),
  ('f1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000005', '2026-12-01', 'anulada', 1000, 1000, now()),
  ('f1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000006', '2026-12-01', 'confirmada', 500, 500, now()),
  ('f1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000007', '2026-12-01', 'confirmada', 500, 500, now()),
  ('f1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000008', '2026-12-01', 'confirmada', 500, 500, now()),
  ('f1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000009', '2026-12-01', 'confirmada', 500, 500, now()),
  ('f2000000-0000-0000-0000-000000000007', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-00000000000c', 'c2000000-0000-0000-0000-000000000001', 'factura', '0001-00000007', '2026-12-01', 'confirmada', 1000, 1000, now());

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ¿Está mergeada la función de MSF-177 que pasa la factura a Cobrado o Deuda?
create function pg_temp.hay_estado_cobro() returns boolean language sql as $$
  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname = 'marcar_estado_cobro_comprobante'
  )
$$;

-- ============================================================================
-- Esquema y RLS (FR-001)
-- ============================================================================

select ok(
  exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'dominio' and c.relname = 'cobros_comprobante' and c.relrowsecurity),
  'cobros_comprobante vive en «dominio» y tiene RLS activada'
);
select ok(
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relname = 'cobros_comprobante'),
  'no existe una copia en «public»'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'dominio' and tablename = 'cobros_comprobante' and cmd <> 'SELECT'),
  0, 'la tabla no tiene políticas de escritura (solo lectura)'
);

-- El importe tiene que ser mayor a cero.
select throws_ok(
  $$insert into dominio.cobros_comprobante
      (organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, origen, registrado_por, registrado_por_nombre)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a',
            'f1000000-0000-0000-0000-000000000001', 0,
            'b1000000-0000-0000-0000-00000000000a', 'manual',
            'd1000000-0000-0000-0000-000000000001', 'Mostrador Uno')$$,
  '23514', null, 'un importe de 0 se rechaza (el cobro siempre vale algo)'
);

-- El origen solo puede ser 'manual' o 'contrarreembolso'.
select throws_ok(
  $$insert into dominio.cobros_comprobante
      (organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, origen, registrado_por, registrado_por_nombre)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a',
            'f1000000-0000-0000-0000-000000000001', 100,
            'b1000000-0000-0000-0000-00000000000a', 'inventado',
            'd1000000-0000-0000-0000-000000000001', 'Mostrador Uno')$$,
  '23514', null, 'un origen fuera de lista se rechaza'
);

-- FK compuesta: el cobro no puede apuntar a un comprobante de otra organización. Lo rechaza
-- primero el disparador de integridad (el cobro no es de esa empresa ni de esa organización).
select throws_ok(
  $$insert into dominio.cobros_comprobante
      (organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, origen, registrado_por, registrado_por_nombre)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a',
            'f2000000-0000-0000-0000-000000000007', 100,
            'b1000000-0000-0000-0000-00000000000a', 'manual',
            'd1000000-0000-0000-0000-000000000001', 'Mostrador Uno')$$,
  '23514', null, 'no se puede cobrar un comprobante de otra organización'
);

-- La cuenta de cobro es de la misma organización (FK compuesta).
select throws_ok(
  $$insert into dominio.cobros_comprobante
      (organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, cuenta_cobro_id, origen, registrado_por, registrado_por_nombre)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a',
            'f1000000-0000-0000-0000-000000000001', 100,
            'b1000000-0000-0000-0000-00000000000b', 'e2000000-0000-0000-0000-00000000000c', 'manual',
            'd1000000-0000-0000-0000-000000000001', 'Mostrador Uno')$$,
  '23514', null, 'no se puede cobrar a una cuenta de cobro de otra organización'
);

-- Las cuatro FK compuestas están en la base (organización y empresa, no solo el id), y además
-- la FK directa a la organización: cinco en total.
select is(
  (select count(*)::int from pg_constraint c
     join pg_class t on t.oid = c.conrelid
     join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'dominio' and t.relname = 'cobros_comprobante' and c.contype = 'f'),
  5, 'el cobro tiene FK a organización, comprobante, empresa, forma de pago y cuenta de cobro'
);

-- La cuenta «No usar» (activa = false) no se ofrece para un cobro nuevo.
select throws_ok(
  $$insert into dominio.cobros_comprobante
      (organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, cuenta_cobro_id, origen, registrado_por, registrado_por_nombre)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a',
            'f1000000-0000-0000-0000-000000000001', 100,
            'b1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000b', 'manual',
            'd1000000-0000-0000-0000-000000000001', 'Mostrador Uno')$$,
  '23514', null, 'una cuenta de cobro marcada «No usar» no recibe cobros nuevos'
);

-- La forma de pago tiene que ser de la empresa del cobro.
select throws_ok(
  $$insert into dominio.cobros_comprobante
      (organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, origen, registrado_por, registrado_por_nombre)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a',
            'f1000000-0000-0000-0000-000000000001', 100,
            'b1000000-0000-0000-0000-00000000000d', 'manual',
            'd1000000-0000-0000-0000-000000000001', 'Mostrador Uno')$$,
  '23514', null, 'una forma de pago de otra tienda no se puede usar'
);

-- Sin escritura directa ni borrado.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$insert into dominio.cobros_comprobante
      (organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, origen, registrado_por, registrado_por_nombre)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a',
            'f1000000-0000-0000-0000-000000000001', 100,
            'b1000000-0000-0000-0000-00000000000a', 'manual',
            'd1000000-0000-0000-0000-000000000001', 'Mostrador Uno')$$,
  '42501', null, 'nadie inserta cobros por escrito: solo la RPC'
);
select throws_ok(
  $$update dominio.cobros_comprobante set importe = 1
     where comprobante_id = 'f1000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'nadie edita un cobro por escrito'
);
select throws_ok(
  $$delete from dominio.cobros_comprobante$$,
  '42501', null, 'no existe el borrado de un cobro'
);
reset role;

select ok(
  not has_table_privilege('anon', 'dominio.cobros_comprobante', 'select')
  and not has_table_privilege('anon', 'dominio.cobros_comprobante', 'insert')
  and not has_table_privilege('authenticated', 'dominio.cobros_comprobante', 'insert')
  and not has_table_privilege('authenticated', 'dominio.cobros_comprobante', 'update')
  and not has_table_privilege('authenticated', 'dominio.cobros_comprobante', 'delete'),
  'anon sin privilegios y authenticated solo lectura'
);

-- ============================================================================
-- Saldo y lectura (FR-005, FR-010)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  (select total from public.saldo_comprobante('f1000000-0000-0000-0000-000000000001')),
  1000.00::numeric, 'sin cobros, el total es el del comprobante'
);
select is(
  (select cobrado from public.saldo_comprobante('f1000000-0000-0000-0000-000000000001')),
  0.00::numeric, 'sin cobros, lo cobrado es 0'
);
select is(
  (select saldo from public.saldo_comprobante('f1000000-0000-0000-0000-000000000001')),
  1000.00::numeric, 'sin cobros, el saldo es el total'
);
select is(
  (select count(*)::int from public.cobros_de_comprobante('f1000000-0000-0000-0000-000000000001')),
  0, 'una factura sin cobros no lista cobros'
);

-- Otra organización no ve el comprobante ni su saldo.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.saldo_comprobante('f1000000-0000-0000-0000-000000000001')$$,
  'P0002', null, 'otra organización no ve el saldo de la factura ajena'
);
select throws_ok(
  $$select * from public.cobros_de_comprobante('f1000000-0000-0000-0000-000000000001')$$,
  'P0002', null, 'otra organización no ve los cobros de la factura ajena'
);
reset role;

-- El mostrador solo ve su empresa: la factura de Mundo JC no es suya.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select * from public.saldo_comprobante('f1000000-0000-0000-0000-000000000002')$$,
  'P0002', null, 'una factura de otra tienda de la misma organización tampoco se ve'
);
reset role;

-- Sin Ventas no hay saldo.
update permisos_rol set nivel = 'ninguno'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta' and seccion = 'ventas';
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select * from public.saldo_comprobante('f1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'sin Ventas no se lee el saldo'
);
select throws_ok(
  $$select * from public.cobros_de_comprobante('f1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'sin Ventas no se leen los cobros'
);
reset role;
update permisos_rol set nivel = 'lectura'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta' and seccion = 'ventas';

-- `anon` no ejecuta ninguna de las dos RPC.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('saldo_comprobante', 'cobros_de_comprobante')
      and has_function_privilege('anon', p.oid, 'execute')),
  0, 'anon no ejecuta las RPC de cobros'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('saldo_comprobante', 'cobros_de_comprobante')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  2, 'authenticated ejecuta las RPC de cobros'
);

-- ============================================================================
-- Registro del cobro (FR-003, FR-006)
-- ============================================================================

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'registrar_cobro_interno'
      and (has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute'))),
  0, 'la función interna de cobro no la ejecuta ni anon ni authenticated'
);

-- El bloqueo de fila sobre el comprobante: es lo que serializa dos cobros simultáneos.
select ok(
  (select prosrc like '%for update%' from pg_proc
    where oid = 'private.registrar_cobro_interno(uuid,numeric,uuid,uuid,text,uuid)'::regprocedure),
  'el comprobante se toma con bloqueo de fila antes de calcular el saldo'
);

-- Un cobro parcial válido (FR-003, FR-005, FR-006).
select lives_ok(
  $$select private.registrar_cobro_interno(
      'f1000000-0000-0000-0000-000000000001', 400,
      'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a',
      'manual', 'd1000000-0000-0000-0000-000000000002')$$,
  'se registra un cobro parcial de 400 por transferencia con cuenta de cobro'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(
  (select cobrado from public.saldo_comprobante('f1000000-0000-0000-0000-000000000001')),
  400.00::numeric, 'lo cobrado sube a 400'
);
select is(
  (select saldo from public.saldo_comprobante('f1000000-0000-0000-0000-000000000001')),
  600.00::numeric, 'el saldo baja a 600'
);
select is(
  (select count(*)::int from public.cobros_de_comprobante('f1000000-0000-0000-0000-000000000001')),
  1, 'el detalle lista el cobro'
);
select is(
  (select forma_pago from public.cobros_de_comprobante('f1000000-0000-0000-0000-000000000001')),
  'Transferencia', 'el cobro muestra la forma de pago'
);
select is(
  (select forma_pago_tipo from public.cobros_de_comprobante('f1000000-0000-0000-0000-000000000001')),
  'transferencia', 'el cobro muestra el tipo de la forma de pago (FR-008: distingue el contrarreembolso)'
);
select is(
  (select cuenta_cobro_banco from public.cobros_de_comprobante('f1000000-0000-0000-0000-000000000001')),
  'Galicia', 'el cobro muestra el banco de la cuenta de cobro (FR-008: «Banco · Titular»)'
);
select is(
  (select cuenta_cobro_titular from public.cobros_de_comprobante('f1000000-0000-0000-0000-000000000001')),
  'Titular Uno', 'el cobro muestra el titular de la cuenta de cobro (FR-008)'
);
select is(
  (select cuenta_cobro from public.cobros_de_comprobante('f1000000-0000-0000-0000-000000000001')),
  'Banco Uno', 'el cobro muestra la cuenta de cobro'
);
select is(
  (select importe from public.cobros_de_comprobante('f1000000-0000-0000-0000-000000000001')),
  400.00::numeric, 'el cobro muestra el importe'
);
select is(
  (select conciliado from public.cobros_de_comprobante('f1000000-0000-0000-0000-000000000001')),
  false, 'el cobro todavía no está conciliado'
);
select is(
  (select registrado_por from public.cobros_de_comprobante('f1000000-0000-0000-0000-000000000001')),
  'mostrador-uno@example.com', 'el cobro muestra quién lo registró'
);
select is(
  (select origen from public.cobros_de_comprobante('f1000000-0000-0000-0000-000000000001')),
  'manual', 'el cobro muestra su origen'
);
reset role;

select is(
  (select estado from dominio.comprobantes_venta where id = 'f1000000-0000-0000-0000-000000000001'),
  'confirmada', 'con saldo y sin forma que genere deuda, el estado no cambia (FR-005)'
);

-- El evento (FR-006): actor, tienda, importe y forma; sin datos bancarios completos.
select is(
  (select actor_id from public.registro_actividad
    where tipo = 'comprobante.cobro_registrado' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'd1000000-0000-0000-0000-000000000002'::uuid, 'el evento guarda quién registró el cobro'
);
select is(
  (select empresa_id from public.registro_actividad
    where tipo = 'comprobante.cobro_registrado' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'a1000000-0000-0000-0000-00000000000a'::uuid, 'el evento guarda la tienda del cobro'
);
select ok(
  (select detalle like '%400%' and detalle like '%Transferencia%'
     from public.registro_actividad
    where tipo = 'comprobante.cobro_registrado' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'el evento nombra el importe y la forma de pago'
);
select ok(
  (select (not (detalle ~ '[0-9]{11}') and detalle not like '%CBU%' and detalle not like '%CUIT%')
     from public.registro_actividad
    where tipo = 'comprobante.cobro_registrado' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'el evento no lleva datos bancarios completos'
);

-- El importe tiene que ser mayor a cero (FR-003) y el mensaje nombra el campo.
select throws_ok(
  $$select private.registrar_cobro_interno(
      'f1000000-0000-0000-0000-000000000001', 0,
      'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a',
      'manual', 'd1000000-0000-0000-0000-000000000002')$$,
  '22023', null, 'un importe de 0 se rechaza'
);
select throws_ok(
  $$select private.registrar_cobro_interno(
      'f1000000-0000-0000-0000-000000000001', -50,
      'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a',
      'manual', 'd1000000-0000-0000-0000-000000000002')$$,
  '22023', null, 'un importe negativo se rechaza'
);
select throws_ok(
  $$select private.registrar_cobro_interno(
      'f1000000-0000-0000-0000-000000000001', 10.555,
      'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a',
      'manual', 'd1000000-0000-0000-0000-000000000002')$$,
  '22023', null, 'un importe con más de dos decimales se rechaza'
);

do $$
begin
  perform private.registrar_cobro_interno(
    'f1000000-0000-0000-0000-000000000001', 10.555,
    'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a',
    'manual', 'd1000000-0000-0000-0000-000000000002');
exception when others then
  perform set_config('test.mensaje', sqlerrm, true);
end $$;
select ok(current_setting('test.mensaje') like '%importe%', 'el mensaje del importe lo nombra');

-- El tope: el importe no puede superar el saldo (FR-003).
select throws_ok(
  $$select private.registrar_cobro_interno(
      'f1000000-0000-0000-0000-000000000001', 700,
      'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a',
      'manual', 'd1000000-0000-0000-0000-000000000002')$$,
  'P0001', null, 'un importe mayor al saldo se rechaza'
);

do $$
begin
  perform private.registrar_cobro_interno(
    'f1000000-0000-0000-0000-000000000001', 700,
    'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a',
    'manual', 'd1000000-0000-0000-0000-000000000002');
exception when others then
  perform set_config('test.mensaje_tope', sqlerrm, true);
end $$;
select ok(current_setting('test.mensaje_tope') like '%importe%' and current_setting('test.mensaje_tope') like '%saldo%',
  'el mensaje del tope nombra el importe y el saldo');
select is(
  (select count(*)::int from dominio.cobros_comprobante where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  1, 'el cobro rechazado no se guardó (sigue solo el de 400)'
);
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'comprobante.cobro_registrado'),
  1, 'el cobro rechazado no dejó evento'
);

-- Los documentos que no admiten cobros (escenario 5).
select throws_ok(
  $$select private.registrar_cobro_interno(
      'f1000000-0000-0000-0000-000000000003', 100,
      'b1000000-0000-0000-0000-00000000000a', null,
      'manual', 'd1000000-0000-0000-0000-000000000002')$$,
  '55000', null, 'una factura en borrador no admite cobros'
);
select throws_ok(
  $$select private.registrar_cobro_interno(
      'f1000000-0000-0000-0000-000000000005', 100,
      'b1000000-0000-0000-0000-00000000000a', null,
      'manual', 'd1000000-0000-0000-0000-000000000002')$$,
  '55000', null, 'una factura anulada no admite cobros'
);
select throws_ok(
  $$select private.registrar_cobro_interno(
      'f1000000-0000-0000-0000-000000000004', 100,
      'b1000000-0000-0000-0000-00000000000a', null,
      'manual', 'd1000000-0000-0000-0000-000000000002')$$,
  '22023', null, 'un presupuesto no admite cobros'
);
select throws_ok(
  $$select private.registrar_cobro_interno(
      'f2000000-0000-0000-0000-000000000007', 100,
      'b2000000-0000-0000-0000-00000000000e', null,
      'manual', 'd1000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'una factura de otra organización no se puede cobrar desde esta organización'
);

-- Aislamiento: los cobros de la organización Uno no se ven desde la Dos.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from dominio.cobros_comprobante),
  0, 'la otra organización no ve ningún cobro'
);
reset role;

-- ============================================================================
-- Cobrado y Deuda (FR-004): dependen de MSF-177
-- ============================================================================

select ok(
  (select prosrc like '%marcar_estado_cobro_comprobante%'
     from pg_proc where oid = 'private.registrar_cobro_interno(uuid,numeric,uuid,uuid,text,uuid)'::regprocedure),
  'el cobro pasa a Cobrado o Deuda por la función private de MSF-177 (nunca a mano)'
);

select case
  when pg_temp.hay_estado_cobro() then lives_ok(
    $$select private.registrar_cobro_interno(
        'f1000000-0000-0000-0000-000000000001', 600,
        'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a',
        'manual', 'd1000000-0000-0000-0000-000000000002')$$,
    'un segundo cobro de 600 (el saldo que quedaba) se registra')
  else skip('MSF-177 sin mergear: private.marcar_estado_cobro_comprobante todavía no existe')
end;

select case
  when pg_temp.hay_estado_cobro() then is(
    (select saldo from private.saldo_comprobante('f1000000-0000-0000-0000-000000000001')),
    0.00::numeric, 'el saldo quedó en 0 (1.000 − 400 − 600)')
  else skip('MSF-177 sin mergear: private.marcar_estado_cobro_comprobante todavía no existe')
end;

select case
  when pg_temp.hay_estado_cobro() then is(
    (select estado from dominio.comprobantes_venta where id = 'f1000000-0000-0000-0000-000000000001'),
    'cobrado', 'el saldo en 0 pasa la factura a Cobrado')
  else skip('MSF-177 sin mergear: private.marcar_estado_cobro_comprobante todavía no existe')
end;

select case
  when pg_temp.hay_estado_cobro() then throws_ok(
    $$select private.registrar_cobro_interno(
        'f1000000-0000-0000-0000-000000000001', 1,
        'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a',
        'manual', 'd1000000-0000-0000-0000-000000000002')$$,
    'P0001', null, 'un cobro más ya no entra: los dos cobros juntos no superan el saldo')
  else skip('MSF-177 sin mergear: private.marcar_estado_cobro_comprobante todavía no existe')
end;

select case
  when pg_temp.hay_estado_cobro() then lives_ok(
    $$select private.registrar_cobro_interno(
        'f1000000-0000-0000-0000-000000000006', 200,
        'b1000000-0000-0000-0000-00000000000c', 'e1000000-0000-0000-0000-00000000000a',
        'manual', 'd1000000-0000-0000-0000-000000000002')$$,
    'un cobro con forma que genera deuda y saldo restante deja la factura en Deuda')
  else skip('MSF-177 sin mergear: private.marcar_estado_cobro_comprobante todavía no existe')
end;

select case
  when pg_temp.hay_estado_cobro() then is(
    (select estado from dominio.comprobantes_venta where id = 'f1000000-0000-0000-0000-000000000006'),
    'deuda', 'la factura con saldo y forma que genera deuda queda en Deuda')
  else skip('MSF-177 sin mergear: private.marcar_estado_cobro_comprobante todavía no existe')
end;

-- ============================================================================
-- La RPC pública registrar_cobro (FR-002): permiso por rol, cuenta y documento
-- ============================================================================

-- `anon` no ejecuta la RPC; `authenticated` sí.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'registrar_cobro'
      and has_function_privilege('anon', p.oid, 'execute')),
  0, 'anon no ejecuta la RPC de registrar cobro'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'registrar_cobro'
      and has_function_privilege('authenticated', p.oid, 'execute')),
  1, 'authenticated ejecuta la RPC de registrar cobro'
);

-- ============================================================================
-- La lectura del permiso para la pantalla (FR-007): `public.puede_registrar_cobro`
-- ============================================================================

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'puede_registrar_cobro'
      and has_function_privilege('anon', p.oid, 'execute')),
  0, 'anon no ejecuta la RPC de permiso de cobro'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'puede_registrar_cobro'
      and has_function_privilege('authenticated', p.oid, 'execute')),
  1, 'authenticated ejecuta la RPC de permiso de cobro'
);

-- El Mostrador puede registrar cobros en su tienda y no en las demás.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(
  public.puede_registrar_cobro('a1000000-0000-0000-0000-00000000000a'),
  true, 'el Mostrador puede registrar cobros en su tienda'
);
select is(
  public.puede_registrar_cobro('a1000000-0000-0000-0000-00000000000b'),
  false, 'el Mostrador no puede registrar cobros en una tienda donde no tiene el rol'
);
reset role;

-- El Administrador de la organización (admin global, sin fila en `usuarios_empresas`) también
-- cobra en cualquier tienda de su organización: `rol_en_empresa` le devuelve 'administrador'.
-- Mismo criterio que `registrar_cobro`, que usa esta misma función.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  public.puede_registrar_cobro('a1000000-0000-0000-0000-00000000000a'),
  true, 'el Administrador global puede registrar cobros en una tienda de su organización'
);
select is(
  public.puede_registrar_cobro('a1000000-0000-0000-0000-00000000000b'),
  true, 'el Administrador global puede registrar cobros en otra tienda de su organización'
);
reset role;

-- Operador: Ventas en edición pero SIN la acción registrar_cobro (escenario 4 de la US1).
select pg_temp.como('d1000000-0000-0000-0000-000000000004');
select is(
  public.puede_registrar_cobro('a1000000-0000-0000-0000-00000000000a'),
  false, 'sin la acción registrar_cobro la pantalla no ofrece el botón'
);
reset role;

-- Depósito: Ventas en lectura, tampoco puede cobrar.
select pg_temp.como('d1000000-0000-0000-0000-000000000005');
select is(
  public.puede_registrar_cobro('a1000000-0000-0000-0000-00000000000a'),
  false, 'Depósito no puede registrar cobros'
);
reset role;

-- Otra organización: una tienda ajena no habilita el cobro.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(
  public.puede_registrar_cobro('a1000000-0000-0000-0000-00000000000a'),
  false, 'una tienda de otra organización no habilita el cobro'
);
reset role;

-- La acción queda sembrada en la matriz de permisos (FR-002).
select is(
  (select permitido from public.permisos_rol_accion
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'mostrador'
      and seccion = 'ventas' and accion = 'registrar_cobro'),
  true, 'la acción registrar_cobro está sembrada para Mostrador'
);
select is(
  (select permitido from public.permisos_rol_accion
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'administracion'
      and seccion = 'ventas' and accion = 'registrar_cobro'),
  true, 'la acción registrar_cobro está sembrada para Administración'
);
select is(
  (select permitido from public.permisos_rol_accion
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'operador'
      and seccion = 'ventas' and accion = 'registrar_cobro'),
  false, 'Operador no tiene la acción registrar_cobro (aunque Ventas esté en edición)'
);
select is(
  (select permitido from public.permisos_rol_accion
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'deposito'
      and seccion = 'ventas' and accion = 'registrar_cobro'),
  false, 'Depósito no tiene la acción registrar_cobro'
);
select is(
  (select count(*)::int from public.permisos_rol_accion where accion = 'registrar_cobro' and seccion <> 'ventas'),
  0, 'la acción registrar_cobro existe solo en Ventas'
);

-- El permiso se resuelve con el rol del usuario en la EMPRESA del comprobante (FR-002).
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select lives_ok(
  $$select public.registrar_cobro(
      'f1000000-0000-0000-0000-000000000001', 100,
      'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a',
      null)$$,
  'el Mostrador registra un cobro parcial por transferencia con cuenta de cobro'
);
select is(
  (select cobrado from public.saldo_comprobante('f1000000-0000-0000-0000-000000000001')),
  500.00::numeric, 'lo cobrado sube a 500 (400 por la función interna + 100 por la RPC)'
);
select is(
  (select saldo from public.saldo_comprobante('f1000000-0000-0000-0000-000000000001')),
  500.00::numeric, 'el saldo baja a 500'
);
select is(
  (select count(*)::int from public.cobros_de_comprobante('f1000000-0000-0000-0000-000000000001')),
  2, 'el detalle lista los dos cobros'
);
select is(
  (select cuenta_cobro from public.cobros_de_comprobante('f1000000-0000-0000-0000-000000000001')
    order by importe desc limit 1),
  'Banco Uno', 'el cobro de la RPC muestra su cuenta de cobro'
);

-- Un rol sin la acción no cobra: el botón no se le muestra y la RPC lo rechaza (escenario 4).
select pg_temp.como('d1000000-0000-0000-0000-000000000004');
select throws_ok(
  $$select public.registrar_cobro(
      'f1000000-0000-0000-0000-000000000001', 100,
      'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a',
      null)$$,
  '42501', null, 'un rol sin la acción registrar_cobro no puede cobrar'
);

-- Depósito y Consulta: solo lectura, tampoco pueden cobrar.
select pg_temp.como('d1000000-0000-0000-0000-000000000005');
select throws_ok(
  $$select public.registrar_cobro(
      'f1000000-0000-0000-0000-000000000001', 100,
      'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a',
      null)$$,
  '42501', null, 'Depósito no puede registrar cobros'
);
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.registrar_cobro(
      'f1000000-0000-0000-0000-000000000001', 100,
      'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a',
      null)$$,
  '42501', null, 'Consulta no puede registrar cobros'
);

-- Otra organización: la factura ajena ni existe para ella.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.registrar_cobro(
      'f1000000-0000-0000-0000-000000000001', 100,
      'b2000000-0000-0000-0000-00000000000e', null,
      null)$$,
  'P0002', null, 'otra organización no puede cobrar una factura ajena'
);
reset role;

-- La cuenta de cobro: la exige la forma, tiene que estar activa y habilitada para la empresa.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.registrar_cobro(
      'f1000000-0000-0000-0000-000000000001', 100,
      'b1000000-0000-0000-0000-00000000000b', null,
      null)$$,
  '22023', null, 'una forma de pago que exige cuenta de cobro no acepta el cobro sin cuenta'
);
select throws_ok(
  $$select public.registrar_cobro(
      'f1000000-0000-0000-0000-000000000001', 100,
      'b1000000-0000-0000-0000-00000000000b', 'e2000000-0000-0000-0000-00000000000c',
      null)$$,
  '22023', null, 'no se puede cobrar a una cuenta de cobro de otra organización'
);
select throws_ok(
  $$select public.registrar_cobro(
      'f1000000-0000-0000-0000-000000000001', 100,
      'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000b',
      null)$$,
  '22023', null, 'una cuenta de cobro marcada «No usar» no recibe cobros nuevos'
);
select throws_ok(
  $$select public.registrar_cobro(
      'f1000000-0000-0000-0000-000000000001', 100,
      'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000c',
      null)$$,
  '22023', null, 'una cuenta de cobro no habilitada en la tienda de la factura no alcanza'
);
select throws_ok(
  $$select public.registrar_cobro(
      'f1000000-0000-0000-0000-000000000001', 100,
      'b1000000-0000-0000-0000-00000000000f', 'e1000000-0000-0000-0000-00000000000a',
      null)$$,
  '22023', null, 'una forma de pago desactivada no admite cobros'
);
select throws_ok(
  $$select public.registrar_cobro(
      'f1000000-0000-0000-0000-000000000001', 100,
      'b1000000-0000-0000-0000-00000000000d', null,
      null)$$,
  '22023', null, 'no se puede cobrar con una forma de pago de otra tienda'
);

-- El error dice QUÉ campo es: la pantalla marca el campo, no un error general (FR-007).
select set_config('test.hint_cuenta', '', true);
do $$
declare v text;
begin
  perform public.registrar_cobro('f1000000-0000-0000-0000-000000000001', 100,
    'b1000000-0000-0000-0000-00000000000b', null, null);
exception when others then
  get stacked diagnostics v = PG_EXCEPTION_HINT;
  perform set_config('test.hint_cuenta', coalesce(v, ''), true);
end $$;
select is(current_setting('test.hint_cuenta'), 'cuenta_cobro_id',
  'el error de la cuenta de cobro dice que el campo es la cuenta de cobro');

select set_config('test.hint_forma', '', true);
do $$
declare v text;
begin
  perform public.registrar_cobro('f1000000-0000-0000-0000-000000000001', 100,
    'b1000000-0000-0000-0000-00000000000d', null, null);
exception when others then
  get stacked diagnostics v = PG_EXCEPTION_HINT;
  perform set_config('test.hint_forma', coalesce(v, ''), true);
end $$;
select is(current_setting('test.hint_forma'), 'forma_pago_id',
  'el error de la forma de pago dice que el campo es la forma de pago');

-- El importe: mayor a cero, con dos decimales como máximo y nunca mayor al saldo (FR-003).
select throws_ok(
  $$select public.registrar_cobro(
      'f1000000-0000-0000-0000-000000000001', 0,
      'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a',
      null)$$,
  '22023', null, 'un importe de 0 se rechaza'
);
select throws_ok(
  $$select public.registrar_cobro(
      'f1000000-0000-0000-0000-000000000001', -50,
      'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a',
      null)$$,
  '22023', null, 'un importe negativo se rechaza'
);
select throws_ok(
  $$select public.registrar_cobro(
      'f1000000-0000-0000-0000-000000000001', 10.555,
      'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a',
      null)$$,
  '22023', null, 'un importe con más de dos decimales se rechaza'
);
select throws_ok(
  $$select public.registrar_cobro(
      'f1000000-0000-0000-0000-000000000001', 501,
      'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a',
      null)$$,
  'P0001', null, 'un importe mayor al saldo se rechaza'
);

select set_config('test.mensaje_tope_rpc', '', true);
select set_config('test.hint_tope_rpc', '', true);
do $$
declare v_mensaje text; v_hint text;
begin
  perform public.registrar_cobro('f1000000-0000-0000-0000-000000000001', 501,
    'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a', null);
exception when others then
  get stacked diagnostics v_mensaje = MESSAGE_TEXT, v_hint = PG_EXCEPTION_HINT;
  perform set_config('test.mensaje_tope_rpc', coalesce(v_mensaje, ''), true);
  perform set_config('test.hint_tope_rpc', coalesce(v_hint, ''), true);
end $$;
select ok(
  current_setting('test.mensaje_tope_rpc') like '%importe%' and current_setting('test.mensaje_tope_rpc') like '%saldo%',
  'el mensaje del tope nombra el importe y el saldo'
);
select is(current_setting('test.hint_tope_rpc'), 'importe',
  'el error del tope dice que el campo es el importe');

-- Los documentos que no admiten cobros (escenario 5).
select throws_ok(
  $$select public.registrar_cobro(
      'f1000000-0000-0000-0000-000000000004', 100,
      'b1000000-0000-0000-0000-00000000000a', null,
      null)$$,
  '22023', null, 'un presupuesto no admite cobros'
);
select throws_ok(
  $$select public.registrar_cobro(
      'f1000000-0000-0000-0000-000000000003', 100,
      'b1000000-0000-0000-0000-00000000000a', null,
      null)$$,
  '55000', null, 'una factura en borrador no admite cobros'
);
select throws_ok(
  $$select public.registrar_cobro(
      'f1000000-0000-0000-0000-000000000005', 100,
      'b1000000-0000-0000-0000-00000000000a', null,
      null)$$,
  '55000', null, 'una factura anulada no admite cobros'
);
select is(
  (select count(*)::int from dominio.cobros_comprobante where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  2, 'ningún cobro rechazado se guardó (siguen solo el de 400 y el de 100)'
);

-- Dos cobros que juntos exceden el saldo: solo entra el primero (FR-003, escenario 6).
-- Un backend de pgTAP no puede simular dos transacciones simultáneas: se prueba el contrato
-- observable (el segundo ve el saldo que dejó el primero) y, más arriba, que el comprobante se
-- toma con bloqueo de fila (es lo que serializa a las dos sesiones reales).
select lives_ok(
  $$select public.registrar_cobro(
      'f1000000-0000-0000-0000-000000000008', 300,
      'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a',
      null)$$,
  'el primer cobro de los dos entra'
);
select throws_ok(
  $$select public.registrar_cobro(
      'f1000000-0000-0000-0000-000000000008', 300,
      'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a',
      null)$$,
  'P0001', null, 'el segundo cobro no entra: los dos juntos superarían el saldo'
);
select is(
  (select count(*)::int from dominio.cobros_comprobante where comprobante_id = 'f1000000-0000-0000-0000-000000000008'),
  1, 'solo quedó el primer cobro'
);

-- Cobrado y Deuda los pone la función `private`, nunca una persona (FR-004).
select throws_ok(
  $$update dominio.comprobantes_venta set estado = 'cobrado'
     where id = 'f1000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'nadie pasa una factura a Cobrado a mano: solo la función private'
);
reset role;

-- El evento de cada cobro (FR-006): actor, tienda, importe y forma; sin datos bancarios.
-- El conteo se acota a la factura 0001-00000001: más arriba se cobra también otra factura.
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'comprobante.cobro_registrado' and organizacion_id = '11111111-1111-1111-1111-111111111111'
      and detalle like '%de la factura 0001-00000001%'),
  2, 'cada cobro deja su evento (los dos cobros de la factura)'
);
select is(
  (select actor_id from public.registro_actividad
    where tipo = 'comprobante.cobro_registrado' and organizacion_id = '11111111-1111-1111-1111-111111111111'
      and detalle like 'Cobro de 100%'),
  'd1000000-0000-0000-0000-000000000002'::uuid, 'el evento del cobro por la RPC guarda quién lo registró'
);
select is(
  (select empresa_id from public.registro_actividad
    where tipo = 'comprobante.cobro_registrado' and organizacion_id = '11111111-1111-1111-1111-111111111111'
      and detalle like 'Cobro de 100%'),
  'a1000000-0000-0000-0000-00000000000a'::uuid, 'el evento del cobro guarda la tienda'
);
select ok(
  not exists (
    select 1 from public.registro_actividad
     where tipo = 'comprobante.cobro_registrado' and organizacion_id = '11111111-1111-1111-1111-111111111111'
       and (detalle ~ '[0-9]{11}' or detalle like '%CBU%' or detalle like '%CUIT%')),
  'ningún evento de cobro lleva datos bancarios completos'
);

-- ============================================================================
-- Cobro total y Cobrado/Deuda por la RPC (FR-004): dependen de MSF-177
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select case
  when pg_temp.hay_estado_cobro() then lives_ok(
    $$select public.registrar_cobro(
        'f1000000-0000-0000-0000-000000000007', 500,
        'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a',
        null)$$,
    'un cobro total (500 de 500) se registra')
  else skip('MSF-177 sin mergear: private.marcar_estado_cobro_comprobante todavía no existe')
end;

select case
  when pg_temp.hay_estado_cobro() then is(
    (select saldo from public.saldo_comprobante('f1000000-0000-0000-0000-000000000007')),
    0.00::numeric, 'el cobro total deja el saldo en 0')
  else skip('MSF-177 sin mergear: private.marcar_estado_cobro_comprobante todavía no existe')
end;

select case
  when pg_temp.hay_estado_cobro() then is(
    (select estado from dominio.comprobantes_venta where id = 'f1000000-0000-0000-0000-000000000007'),
    'cobrado', 'el comprobante pasa a Cobrado (por la función private, no a mano)')
  else skip('MSF-177 sin mergear: private.marcar_estado_cobro_comprobante todavía no existe')
end;

select case
  when pg_temp.hay_estado_cobro() then throws_ok(
    $$select public.registrar_cobro(
        'f1000000-0000-0000-0000-000000000007', 1,
        'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a',
        null)$$,
    'P0001', null, 'un cobro más ya no entra: el saldo quedó en 0')
  else skip('MSF-177 sin mergear: private.marcar_estado_cobro_comprobante todavía no existe')
end;

select case
  when pg_temp.hay_estado_cobro() then lives_ok(
    $$select public.registrar_cobro(
        'f1000000-0000-0000-0000-000000000009', 200,
        'b1000000-0000-0000-0000-00000000000c', 'e1000000-0000-0000-0000-00000000000a',
        null)$$,
    'un cobro con forma que genera deuda y saldo restante se registra')
  else skip('MSF-177 sin mergear: private.marcar_estado_cobro_comprobante todavía no existe')
end;

select case
  when pg_temp.hay_estado_cobro() then is(
    (select estado from dominio.comprobantes_venta where id = 'f1000000-0000-0000-0000-000000000009'),
    'deuda', 'la factura con saldo y forma que genera deuda queda en Deuda')
  else skip('MSF-177 sin mergear: private.marcar_estado_cobro_comprobante todavía no existe')
end;

reset role;

select * from finish();

rollback;
