-- F-VTA-12 (MSF-389, épica MSF-195, spec 20261024-150000-ventas-cobros-y-conciliacion,
-- FR-001, FR-003, FR-004, FR-005, FR-006, FR-010, SC-001): cobros por comprobante.
--
-- Cubre: tabla en `dominio` con RLS y sin escritura directa; saldo (total, cobrado, saldo);
-- lectura de los cobros del comprobante; registro del cobro (parcial, tope, serie, tipos de
-- documento), evento de actividad y aislamiento entre organizaciones.
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

-- Formas de pago: efectivo (sin cuenta), transferencia (exige cuenta, no genera deuda) y
-- cuenta corriente (genera deuda).
insert into dominio.formas_pago (id, organizacion_id, empresa_id, nombre, tipo, exige_cuenta_cobro, genera_deuda) values
  ('b1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Efectivo', 'efectivo', false, false),
  ('b1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Transferencia', 'transferencia', true, false),
  ('b1000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Cuenta corriente', 'otro', true, true),
  ('b1000000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'Efectivo', 'efectivo', false, false),
  ('b2000000-0000-0000-0000-00000000000e', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-00000000000c', 'Efectivo', 'efectivo', false, false);

-- Cuentas de cobro: una activa en San Javucho, una marcada «No usar» y una de la otra organización.
insert into dominio.cuentas_cobro (id, organizacion_id, nombre, titular, banco, activa) values
  ('e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Banco Uno', 'Titular Uno', 'Galicia', true),
  ('e1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Banco No usar', 'Titular Dos', 'Santander', false),
  ('e2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Banco Dos', 'Titular Tres', 'BBVA', true);

insert into dominio.cuentas_cobro_empresas (cuenta_id, empresa_id, organizacion_id) values
  ('e1000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111'),
  ('e1000000-0000-0000-0000-00000000000b', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111'),
  ('e2000000-0000-0000-0000-00000000000c', 'a2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222');

-- Comprobantes: F1 es la factura que se cobra (1.000); F2 es de otra tienda de la misma
-- organización; FB está en borrador; FP es un presupuesto; FA está anulada; FD es la de deuda;
-- FO es de la otra organización.
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, confirmado_en) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000001', '2026-12-01', 'confirmada', 1000, 1000, now()),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000002', '2026-12-01', 'confirmada', 1000, 1000, now()),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000003', '2026-12-01', 'borrador', 1000, 1000, null),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'presupuesto', '0001-00000004', '2026-12-01', 'pendiente', 1000, 1000, null),
  ('f1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000005', '2026-12-01', 'anulada', 1000, 1000, now()),
  ('f1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000006', '2026-12-01', 'confirmada', 500, 500, now()),
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

-- Las cuatro FK compuestas están en la base (organización y empresa, no solo el id).
select is(
  (select count(*)::int from pg_constraint c
     join pg_class t on t.oid = c.conrelid
     join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'dominio' and t.relname = 'cobros_comprobante' and c.contype = 'f'),
  4, 'el cobro tiene FK a comprobante, empresa, forma de pago y cuenta de cobro'
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
  (not (detalle ~ '[0-9]{11}') and detalle not like '%CBU%' and detalle not like '%CUIT%'
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

select * from finish();

rollback;
