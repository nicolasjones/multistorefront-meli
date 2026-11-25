-- MSF-661, MSF-600 y MSF-667 (lote 32): `anular_comprobante` rechaza la factura entregada y la que tiene cobros, y
-- `revertir_cobro` revierte un cobro con un contra-asiento auditado (solo administrador, motivo obligatorio).
-- Fixture como postgres; verificaciones como «authenticated» con request.jwt.claims, igual que PostgREST.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'mostrador-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000004', 'administracion-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'mostrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('d1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'administracion', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'mostrador'),
  ('d1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'administracion');

insert into dominio.clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista');

insert into dominio.formas_pago (id, organizacion_id, empresa_id, nombre, tipo, exige_cuenta_cobro, genera_deuda, activo) values
  ('b1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Efectivo', 'efectivo', false, false, true),
  ('b1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Transferencia', 'transferencia', true, false, true);

insert into dominio.cuentas_cobro (id, organizacion_id, nombre, titular, banco, activa) values
  ('e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Banco Uno', 'Titular Uno', 'Galicia', true);
insert into dominio.cuentas_cobro_empresas (cuenta_id, empresa_id, organizacion_id) values
  ('e1000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111');

-- Facturas (todas de San Javucho salvo F_OTRA):
--   F_COB   cobrado, 1000, cobros de 400 y 600 (efectivo)
--   F_CONC  cobrado, 500, un cobro conciliado con cuenta
--   F_CRE   cobrado, 500, cobro de origen contrarreembolso
--   F_ANU   anulada, 500, con un cobro viejo
--   F_ENT   confirmada ya entregada (estado_despacho = entregado)
--   F_PARC  deuda, 1000, cobro parcial de 300
--   F_OK    confirmada, sin cobros ni entrega (control: se anula)
--   F_CTA   cobrado, 700, un cobro con cuenta SIN conciliar
--   F_OTRA  de la otra organización
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, estado_despacho, total_sin_iva, total_con_iva, confirmado_en) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000001', '2026-12-01', 'cobrado', null, 1000, 1000, now()),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000002', '2026-12-01', 'cobrado', null, 500, 500, now()),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000003', '2026-12-01', 'cobrado', null, 500, 500, now()),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000004', '2026-12-01', 'anulada', null, 500, 500, now()),
  ('f1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000005', '2026-12-01', 'confirmada', 'entregado', 500, 500, now()),
  ('f1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000006', '2026-12-01', 'deuda', null, 1000, 1000, now()),
  ('f1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000007', '2026-12-01', 'confirmada', null, 500, 500, now()),
  ('f1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000008', '2026-12-01', 'cobrado', null, 700, 700, now()),
  ('f1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000009', '2026-12-01', 'confirmada', null, 500, 500, now());

insert into dominio.cobros_comprobante
  (id, organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, cuenta_cobro_id, origen, registrado_por, registrado_por_nombre, aprobado_por, aprobado_por_nombre, aprobado_en) values
  ('c0b00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000001', 400, 'b1000000-0000-0000-0000-00000000000a', null, 'manual', 'd1000000-0000-0000-0000-000000000002', 'Mostrador', null, null, null),
  ('c0b00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000001', 600, 'b1000000-0000-0000-0000-00000000000a', null, 'manual', 'd1000000-0000-0000-0000-000000000002', 'Mostrador', null, null, null),
  ('c0b00000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000002', 500, 'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a', 'manual', 'd1000000-0000-0000-0000-000000000002', 'Mostrador', 'd1000000-0000-0000-0000-000000000001', 'Admin', now()),
  ('c0b00000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000003', 500, 'b1000000-0000-0000-0000-00000000000a', null, 'contrarreembolso', 'd1000000-0000-0000-0000-000000000002', 'Mostrador', null, null, null),
  ('c0b00000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000004', 500, 'b1000000-0000-0000-0000-00000000000a', null, 'manual', 'd1000000-0000-0000-0000-000000000002', 'Mostrador', null, null, null),
  ('c0b00000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000006', 300, 'b1000000-0000-0000-0000-00000000000a', null, 'manual', 'd1000000-0000-0000-0000-000000000002', 'Mostrador', null, null, null),
  ('c0b00000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000008', 700, 'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a', 'manual', 'd1000000-0000-0000-0000-000000000002', 'Mostrador', null, null, null);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.upd(p_id uuid) returns timestamptz language sql security definer as $$
  select updated_at from dominio.comprobantes_venta where id = p_id $$;
create function pg_temp.est(p_id uuid) returns text language sql security definer as $$
  select estado from dominio.comprobantes_venta where id = p_id $$;
create function pg_temp.neto(p_id uuid) returns numeric language sql security definer as $$
  select coalesce(sum(importe), 0) from dominio.cobros_comprobante where comprobante_id = p_id $$;
create function pg_temp.upd_cobro(p_id uuid) returns timestamptz language sql security definer as $$
  select actualizado_en from dominio.cobros_comprobante where id = p_id $$;
grant execute on function pg_temp.upd(uuid), pg_temp.est(uuid), pg_temp.neto(uuid), pg_temp.upd_cobro(uuid), pg_temp.como(uuid) to public;

-- ============================================================================
-- Privilegios
-- ============================================================================
select is(has_function_privilege('anon', 'public.revertir_cobro(uuid,text)', 'execute'), false, 'anon no ejecuta revertir_cobro');
select is(has_function_privilege('authenticated', 'public.revertir_cobro(uuid,text)', 'execute'), true, 'authenticated ejecuta revertir_cobro');
select is(has_function_privilege('authenticated', 'private.aplicar_conciliacion(uuid,timestamptz,boolean)', 'execute'), false, 'authenticated no ejecuta la conciliación interna');
select is(has_function_privilege('authenticated', 'private.validar_cobro_comprobante()', 'execute'), false, 'authenticated no ejecuta el validador del libro');

-- ============================================================================
-- MSF-661: anular una factura entregada
-- ============================================================================
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  format($$select public.anular_comprobante(%L, 'Error de carga', pg_temp.upd(%L))$$, 'f1000000-0000-0000-0000-000000000005', 'f1000000-0000-0000-0000-000000000005'),
  '55000', 'La factura ya fue entregada: corregí con nota de crédito o RMA', 'una factura entregada no se anula');
select is(pg_temp.est('f1000000-0000-0000-0000-000000000005'), 'confirmada', 'la entregada sigue confirmada');

-- ============================================================================
-- MSF-600: anular una factura con cobros parciales
-- ============================================================================
select throws_ok(
  format($$select public.anular_comprobante(%L, 'Error de carga', pg_temp.upd(%L))$$, 'f1000000-0000-0000-0000-000000000006', 'f1000000-0000-0000-0000-000000000006'),
  '55000', 'La factura tiene cobros registrados: revertí el cobro o corregila con una nota de crédito', 'con un cobro parcial no se anula');
select is(pg_temp.est('f1000000-0000-0000-0000-000000000006'), 'deuda', 'la factura con cobro parcial sigue en deuda');

-- Control: sin cobros ni entrega se anula
select lives_ok(
  format($$select public.anular_comprobante(%L, 'Error de carga', pg_temp.upd(%L))$$, 'f1000000-0000-0000-0000-000000000009', 'f1000000-0000-0000-0000-000000000009'),
  'una factura sin cobros ni entrega se anula');
select is(pg_temp.est('f1000000-0000-0000-0000-000000000009'), 'anulada', 'quedó anulada');

-- Otra organización: no ve la factura ajena (sin oráculo)
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok(
  format($$select public.anular_comprobante(%L, 'x', pg_temp.upd(%L))$$, 'f1000000-0000-0000-0000-000000000006', 'f1000000-0000-0000-0000-000000000006'),
  'PT404', 'El comprobante no existe', 'otra organización no anula la factura ajena');

-- ============================================================================
-- MSF-667: revertir_cobro, permisos y validaciones
-- ============================================================================
select throws_ok(format($$select public.revertir_cobro(%L, 'Cobro mal cargado')$$, 'c0b00000-0000-0000-0000-000000000001'),
  'P0002', 'El cobro no existe', 'el administrador de OTRA organización no revierte un cobro ajeno (responde como si no existiera)');
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(format($$select public.revertir_cobro(%L, 'Cobro mal cargado')$$, 'c0b00000-0000-0000-0000-000000000001'),
  '42501', 'Solo el administrador puede revertir un cobro', 'Mostrador (aunque cobre) no revierte');
select pg_temp.como('d1000000-0000-0000-0000-000000000004');
select throws_ok(format($$select public.revertir_cobro(%L, 'Cobro mal cargado')$$, 'c0b00000-0000-0000-0000-000000000001'),
  '42501', 'Solo el administrador puede revertir un cobro', 'Administración (aunque anule) no revierte');
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok(format($$select public.revertir_cobro(%L, 'Cobro mal cargado')$$, 'c0b00000-0000-0000-0000-000000000001'),
  '42501', 'Solo el administrador puede revertir un cobro', 'Consulta no revierte');
reset role;
set local role anon;
select throws_ok(format($$select public.revertir_cobro(%L, 'Cobro mal cargado')$$, 'c0b00000-0000-0000-0000-000000000001'),
  '42501', 'permission denied for function revertir_cobro', 'anon no revierte');
reset role;
select is(pg_temp.neto('f1000000-0000-0000-0000-000000000001'), 1000::numeric, 'sin permiso el libro no cambió');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(format($$select public.revertir_cobro(%L, '   ')$$, 'c0b00000-0000-0000-0000-000000000001'),
  '22023', 'Escribí el motivo de la reversión', 'el motivo es obligatorio (en blanco)');
select throws_ok(format($$select public.revertir_cobro(%L, null)$$, 'c0b00000-0000-0000-0000-000000000001'),
  '22023', 'Escribí el motivo de la reversión', 'el motivo es obligatorio (nulo)');
select throws_ok(format($$select public.revertir_cobro(%L, %L)$$, 'c0b00000-0000-0000-0000-000000000001', repeat('x', 301)),
  '22023', 'El motivo de la reversión no puede superar los 300 caracteres', 'el motivo no supera 300');
select throws_ok(format($$select public.revertir_cobro(%L, 'm')$$, '00000000-0000-0000-0000-0000000000ff'),
  'P0002', 'El cobro no existe', 'un cobro inexistente');
select throws_ok(format($$select public.revertir_cobro(%L, 'm')$$, 'c0b00000-0000-0000-0000-000000000003'),
  '55000', 'El cobro está conciliado: revertí primero la conciliación', 'un cobro conciliado no se revierte');
select throws_ok(format($$select public.revertir_cobro(%L, 'm')$$, 'c0b00000-0000-0000-0000-000000000004'),
  '55000', 'El cobro de un contrarreembolso se corrige desde el contrarreembolso', 'el cobro de un contrarreembolso no se revierte');
select throws_ok(format($$select public.revertir_cobro(%L, 'm')$$, 'c0b00000-0000-0000-0000-000000000005'),
  '55000', 'La factura no está en un estado operativo: no admite revertir cobros', 'sobre una factura anulada no se revierte');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- ============================================================================
-- MSF-667: la reversión (F_COB: 400 + 600 → se revierte el de 600)
-- ============================================================================
select is(pg_temp.est('f1000000-0000-0000-0000-000000000001'), 'cobrado', 'F_COB parte cobrada');
select lives_ok(format($$create temp table rev1 as select public.revertir_cobro(%L, 'Cobro mal cargado') as id$$, 'c0b00000-0000-0000-0000-000000000002'),
  'el administrador revierte el cobro de 600');
grant select on rev1 to public;
select is(pg_temp.neto('f1000000-0000-0000-0000-000000000001'), 400::numeric, 'el neto cobrado baja a 400');
select is(pg_temp.est('f1000000-0000-0000-0000-000000000001'), 'deuda', 'cobrado → deuda al reabrir el saldo');
select is((select saldo from public.saldo_comprobante('f1000000-0000-0000-0000-000000000001')), 600::numeric, 'el saldo vuelve a 600');
reset role;
select is((select importe::text || '/' || origen || '/' || motivo_reversion from dominio.cobros_comprobante where id = (select id from rev1)),
  '-600.00/reversion/Cobro mal cargado', 'el contra-asiento es negativo, de origen reversion y con motivo');
select is((select revierte_cobro_id from dominio.cobros_comprobante where id = (select id from rev1)), 'c0b00000-0000-0000-0000-000000000002'::uuid, 'apunta al cobro revertido');
select is((select registrado_por from dominio.cobros_comprobante where id = (select id from rev1)), 'd1000000-0000-0000-0000-000000000001'::uuid, 'queda quién lo revirtió');
select is((select count(*)::int from dominio.cobros_comprobante where id = 'c0b00000-0000-0000-0000-000000000002' and importe = 600), 1, 'el cobro original no se tocó');
select is((select count(*)::int from public.registro_actividad where tipo = 'comprobante.cobro_revertido' and detalle like '%0001-00000001%Cobro mal cargado%'), 1,
  'la Actividad deja la reversión con la factura y el motivo');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(format($$select public.revertir_cobro(%L, 'otra vez')$$, 'c0b00000-0000-0000-0000-000000000002'),
  '55000', 'El cobro ya fue revertido', 'un cobro se revierte una sola vez');
select throws_ok(format($$select public.revertir_cobro(%L, 'm')$$, (select id from rev1)),
  '55000', 'Un contra-asiento no se revierte', 'el contra-asiento no se revierte');

-- Se puede cobrar de nuevo: el saldo reabierto vuelve a Cobrado
select lives_ok(format($$select public.registrar_cobro(%L, 600, %L, null, null)$$, 'f1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000a'),
  'se registra el cobro correcto de 600');
select is(pg_temp.est('f1000000-0000-0000-0000-000000000001'), 'cobrado', 'saldo 0 ⇒ cobrado otra vez');

-- ============================================================================
-- MSF-600 + MSF-667: revertir el cobro parcial deja anular
-- ============================================================================
select lives_ok(format($$select public.revertir_cobro(%L, 'Se cargó en la factura equivocada')$$, 'c0b00000-0000-0000-0000-000000000006'),
  'se revierte el cobro parcial de F_PARC');
select is(pg_temp.est('f1000000-0000-0000-0000-000000000006'), 'deuda', 'F_PARC sigue en deuda (saldo total)');
select lives_ok(
  format($$select public.anular_comprobante(%L, 'Error de carga', pg_temp.upd(%L))$$, 'f1000000-0000-0000-0000-000000000006', 'f1000000-0000-0000-0000-000000000006'),
  'con el cobro revertido (neto 0) la factura se anula');
select is(pg_temp.est('f1000000-0000-0000-0000-000000000006'), 'anulada', 'F_PARC anulada');

-- ============================================================================
-- Conciliación: ni el contra-asiento ni el original revertido
-- ============================================================================
-- Pagos: antes de revertir hay un cobro de 700 por conciliar (y el de 500 ya conciliado)
select is((select por_conciliar_cantidad::int || '/' || conciliado_cantidad::int || '/' || por_conciliar_importe from public.resumen_pagos()), '1/1/700.00', 'antes de revertir: 1 por conciliar (700) y 1 conciliado');
select is((select usos::int from public.cuentas_cobro_mas_usadas() where nombre = 'Banco Uno'), 2, 'antes de revertir: la cuenta tiene 2 usos');
select lives_ok(format($$create temp table rev2 as select public.revertir_cobro(%L, 'Cuenta equivocada') as id$$, 'c0b00000-0000-0000-0000-000000000008'),
  'se revierte el cobro con cuenta sin conciliar');
grant select on rev2 to public;
-- MSF-667 (QA): el cobro revertido y su contra-asiento se netean en los lectores de pagos
select is((select por_conciliar_cantidad::int || '/' || conciliado_cantidad::int || '/' || por_conciliar_importe from public.resumen_pagos()), '0/1/0', 'tras revertir: nada por conciliar por ese cobro (queda como antes de cobrar)');
select is((select usos::int from public.cuentas_cobro_mas_usadas() where nombre = 'Banco Uno'), 1, 'la cuenta vuelve a 1 uso: ni el cobro revertido ni el contra-asiento cuentan');
select is((select array_agg(coalesce(estado_reversion, 'normal') order by importe) from public.listar_pagos(null, null, false, 1, 50) where comprobante_id = 'f1000000-0000-0000-0000-000000000008'),
  array['reversion', 'revertido']::text[], 'listar_pagos muestra el contra-asiento como «reversion» y el cobro como «revertido»');
select is((select estado_reversion from public.listar_pagos(null, null, false, 1, 50) where comprobante_id = 'f1000000-0000-0000-0000-000000000002'), null::text, 'el cobro normal no tiene estado de reversión');
select is((select count(*)::int from public.listar_pagos(null, null, false, 1, 50) where not conciliado and estado_reversion is null), 0, 'ningún pago «por conciliar» sin revertir queda pendiente (nada que conciliar masivamente)');
select throws_ok(format($$select public.conciliar_pago(%L, pg_temp.upd_cobro(%L))$$, 'c0b00000-0000-0000-0000-000000000008', 'c0b00000-0000-0000-0000-000000000008'),
  '55000', 'Este cobro fue revertido: no se puede conciliar', 'el cobro revertido no se concilia');
select throws_ok(format($$select public.conciliar_pago(%L, pg_temp.upd_cobro(%L))$$, (select id from rev2), (select id from rev2)),
  '55000', 'Este movimiento es una reversión de cobro: no se concilia contra el banco', 'el contra-asiento no se concilia');

-- ============================================================================
-- Integridad del libro
-- ============================================================================
select throws_ok(
  $$insert into dominio.cobros_comprobante (organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, origen, registrado_por, registrado_por_nombre)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000001', 100, 'b1000000-0000-0000-0000-00000000000a', 'reversion', 'd1000000-0000-0000-0000-000000000001', 'Admin')$$,
  '42501', 'permission denied for table cobros_comprobante', 'authenticated no escribe en el libro directamente');
reset role;
select throws_ok(
  $$insert into dominio.cobros_comprobante (organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, origen, registrado_por, registrado_por_nombre, revierte_cobro_id, motivo_reversion)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000001', 100, 'b1000000-0000-0000-0000-00000000000a', 'reversion', 'd1000000-0000-0000-0000-000000000001', 'Admin', 'c0b00000-0000-0000-0000-000000000001', 'x')$$,
  '23514', 'new row for relation "cobros_comprobante" violates check constraint "cobros_comprobante_reversion_ck"', 'un contra-asiento con importe positivo viola el check del libro');
select throws_ok(
  $$insert into dominio.cobros_comprobante (organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, origen, registrado_por, registrado_por_nombre)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000001', -100, 'b1000000-0000-0000-0000-00000000000a', 'manual', 'd1000000-0000-0000-0000-000000000001', 'Admin')$$,
  '23514', 'new row for relation "cobros_comprobante" violates check constraint "cobros_comprobante_reversion_ck"', 'un cobro manual negativo viola el check del libro');
select throws_ok(
  format($$insert into dominio.cobros_comprobante (organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, origen, registrado_por, registrado_por_nombre, revierte_cobro_id, motivo_reversion)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000001', -600, 'b1000000-0000-0000-0000-00000000000a', 'reversion', 'd1000000-0000-0000-0000-000000000001', 'Admin', 'c0b00000-0000-0000-0000-000000000002', 'otra')$$),
  '23505', 'duplicate key value violates unique constraint "cobros_comprobante_revierte_uq"', 'dos contra-asientos del mismo cobro violan el único');

select * from finish();
rollback;
