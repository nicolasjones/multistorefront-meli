-- Lote 67 (MSF-599, novena ola): las RPC de comprobantes de venta, despacho, cobros, contrarreembolsos y envíos en moto
-- contestan `PT409` (HTTP 409) cuando el estado o la regla de negocio no admite la acción (antes `55000`, HTTP 500), con el
-- mismo mensaje de negocio de siempre. Un assert por cada rechazo convertido (código y mensaje).
-- Fixture como postgres; verificaciones como «authenticated» con request.jwt.claims, igual que PostgREST.
begin;

select plan(29);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'San Javucho');

insert into dominio.clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista');

insert into dominio.formas_pago (id, organizacion_id, empresa_id, nombre, tipo, exige_cuenta_cobro, genera_deuda, activo) values
  ('b1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Efectivo', 'efectivo', false, false, true),
  ('b1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Transferencia', 'transferencia', true, false, true);

insert into dominio.cuentas_cobro (id, organizacion_id, nombre, titular, banco, activa) values
  ('e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Banco Uno', 'Titular Uno', 'Galicia', true);
insert into dominio.cuentas_cobro_empresas (cuenta_id, empresa_id, organizacion_id) values
  ('e1000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111');

insert into dominio.transportes (id, organizacion_id, nombre, tipo, cobra_contrarreembolso) values
  ('e1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Expreso Uno', 'expreso', true);

-- Facturas de San Javucho:
--   F_BORR   borrador
--   F_ANU    anulada, con un cobro viejo, un contrarreembolso pendiente y un envío en moto sin rendir
--   F_COBRADA cobrada (estado `cobrado`)
--   F_ENT    confirmada ya entregada
--   F_CCOB   confirmada con un cobro de 300
--   F_NC     confirmada con una nota de crédito
--   F_CONF   confirmada en `sin_armar`
--   F_SIND   confirmada sin estado de despacho
--   F_REV    cobrada con cobros de 400 y 600 (el de 600 ya revertido)
--   F_CRE    cobrada con un cobro de origen contrarreembolso
--   F_CONC   cobrada con un cobro conciliado
--   F_MOTO   confirmada con un envío en moto ya rendido
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, estado_despacho, total_sin_iva, total_con_iva, confirmado_en) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000001', '2026-12-01', 'borrador', null, 500, 500, null),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000002', '2026-12-01', 'anulada', null, 500, 500, now()),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000003', '2026-12-01', 'cobrado', null, 500, 500, now()),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000004', '2026-12-01', 'confirmada', 'entregado', 500, 500, now()),
  ('f1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000005', '2026-12-01', 'confirmada', null, 1000, 1000, now()),
  ('f1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000006', '2026-12-01', 'confirmada', null, 500, 500, now()),
  ('f1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000007', '2026-12-01', 'confirmada', 'sin_armar', 500, 500, now()),
  ('f1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000008', '2026-12-01', 'confirmada', null, 500, 500, now()),
  ('f1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000009', '2026-12-01', 'cobrado', null, 1000, 1000, now()),
  ('f1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000010', '2026-12-01', 'cobrado', null, 500, 500, now()),
  ('f1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000011', '2026-12-01', 'cobrado', null, 500, 500, now()),
  ('f1000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000012', '2026-12-01', 'confirmada', 'sin_armar', 500, 500, now());

-- La nota de crédito de F_NC (el motivo de la anulación que se rechaza).
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva, confirmado_en, comprobante_origen_id, nc_tipo, nc_concepto) values
  ('f1000000-0000-0000-0000-0000000000a6', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'nota_credito', '00000001', 1, '2026-12-02', 'confirmada', 0, 0, now(),
   'f1000000-0000-0000-0000-000000000006', 'devolucion_importe', 'Ajuste comercial');

insert into dominio.cobros_comprobante
  (id, organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, cuenta_cobro_id, origen, registrado_por, registrado_por_nombre, aprobado_por, aprobado_por_nombre, aprobado_en, revierte_cobro_id, motivo_reversion) values
  ('c0b00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000009', 400, 'b1000000-0000-0000-0000-00000000000a', null, 'manual', 'd1000000-0000-0000-0000-000000000001', 'Admin', null, null, null, null, null),
  ('c0b00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000009', 600, 'b1000000-0000-0000-0000-00000000000a', null, 'manual', 'd1000000-0000-0000-0000-000000000001', 'Admin', null, null, null, null, null),
  ('c0b00000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-00000000000b', 500, 'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a', 'manual', 'd1000000-0000-0000-0000-000000000001', 'Admin', 'd1000000-0000-0000-0000-000000000001', 'Admin', now(), null, null),
  ('c0b00000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-00000000000a', 500, 'b1000000-0000-0000-0000-00000000000a', null, 'contrarreembolso', 'd1000000-0000-0000-0000-000000000001', 'Admin', null, null, null, null, null),
  ('c0b00000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000002', 500, 'b1000000-0000-0000-0000-00000000000a', null, 'manual', 'd1000000-0000-0000-0000-000000000001', 'Admin', null, null, null, null, null),
  ('c0b00000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000005', 300, 'b1000000-0000-0000-0000-00000000000a', null, 'manual', 'd1000000-0000-0000-0000-000000000001', 'Admin', null, null, null, null, null);
-- El contra-asiento del cobro de 600 de F_REV (el cobro ya fue revertido).
insert into dominio.cobros_comprobante
  (id, organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, cuenta_cobro_id, origen, registrado_por, registrado_por_nombre, revierte_cobro_id, motivo_reversion) values
  ('c0b00000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000009', -600, 'b1000000-0000-0000-0000-00000000000a', null, 'reversion', 'd1000000-0000-0000-0000-000000000001', 'Admin', 'c0b00000-0000-0000-0000-000000000002', 'Cobro mal cargado');

insert into dominio.contrarreembolsos
  (id, organizacion_id, empresa_id, comprobante_id, transporte_id, guia, importe) values
  ('c4000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000b', 'G-0001', 500);

insert into dominio.envios_moto (id, organizacion_id, comprobante_id, mensajero, costo_envio, abono, enviado, rendido, rendido_en) values
  ('e3000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000002', 'Ana', 10, 0, false, false, null),
  ('e3000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-00000000000c', 'Beto', 10, 0, true, true, now());

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function pg_temp.como(uuid) to public;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- ============================================================================
-- Comprobantes: confirmar, anular, cambiar estado, guardar cabecera y líneas
-- ============================================================================
select throws_ok($$select public.confirmar_comprobante('f1000000-0000-0000-0000-000000000002')$$,
  'PT409', 'La factura ya está cerrada y no se puede confirmar', 'confirmar_comprobante: una factura anulada no se confirma (409)');

select throws_ok($$select public.anular_comprobante('f1000000-0000-0000-0000-000000000001', 'Error de carga', now())$$,
  'PT409', 'La factura está en borrador: no movió stock, no hace falta anularla', 'anular_comprobante: un borrador no se anula (409)');
select throws_ok($$select public.anular_comprobante('f1000000-0000-0000-0000-000000000003', 'Error de carga', now())$$,
  'PT409', 'La factura ya está cobrada: corregila con una nota de crédito', 'anular_comprobante: una factura cobrada no se anula (409)');
select throws_ok($$select public.anular_comprobante('f1000000-0000-0000-0000-000000000004', 'Error de carga', now())$$,
  'PT409', 'La factura ya fue entregada: corregí con nota de crédito o RMA', 'anular_comprobante: una factura entregada no se anula (409)');
select throws_ok($$select public.anular_comprobante('f1000000-0000-0000-0000-000000000005', 'Error de carga', now())$$,
  'PT409', 'La factura tiene cobros registrados: revertí el cobro o corregila con una nota de crédito', 'anular_comprobante: con cobros no se anula (409)');
select throws_ok($$select public.anular_comprobante('f1000000-0000-0000-0000-000000000006', 'Error de carga', now())$$,
  'PT409', 'La factura ya tiene una nota de crédito: corregila con otra nota de crédito', 'anular_comprobante: con nota de crédito no se anula (409)');

select throws_ok($$select public.cambiar_estado_comprobante('f1000000-0000-0000-0000-000000000001', 'aceptado', now())$$,
  'PT409', 'La factura está en borrador: confirmala antes de cambiar su estado', 'cambiar_estado_comprobante: un borrador no cambia de estado (409)');
select throws_ok($$select public.cambiar_estado_comprobante('f1000000-0000-0000-0000-000000000002', 'aceptado', now())$$,
  'PT409', 'La factura está anulada y ya no admite cambios de estado', 'cambiar_estado_comprobante: una anulada no cambia de estado (409)');

select throws_ok($$select public.guardar_comprobante('f1000000-0000-0000-0000-000000000007', 'c1000000-0000-0000-0000-000000000001', 'mostrador', '2026-12-01', null, null, null, now())$$,
  'PT409', 'El comprobante ya está cerrado y no se puede modificar', 'guardar_comprobante: una factura confirmada no se edita (409)');
select throws_ok($$select public.guardar_lineas_comprobante('f1000000-0000-0000-0000-000000000007', '[]'::jsonb, now())$$,
  'PT409', 'El comprobante ya está cerrado y no se puede modificar', 'guardar_lineas_comprobante: una factura confirmada no admite cambios de líneas (409)');

-- ============================================================================
-- Despacho: cambiar estado, faltantes y envío
-- ============================================================================
select throws_ok($$select public.cambiar_estado_despacho('f1000000-0000-0000-0000-000000000002', 'armando', 'd1000000-0000-0000-0000-000000000001', now())$$,
  'PT409', 'Solo las facturas vigentes (no anuladas ni sin confirmar) se despachan', 'cambiar_estado_despacho: una anulada no se despacha (409)');
select throws_ok($$select public.cambiar_estado_despacho('f1000000-0000-0000-0000-000000000008', 'armando', 'd1000000-0000-0000-0000-000000000001', now())$$,
  'PT409', 'Esta factura todavía no tiene estado de despacho', 'cambiar_estado_despacho: sin estado de despacho no se avanza (409)');
select throws_ok($$select public.cambiar_estado_despacho('f1000000-0000-0000-0000-000000000007', 'entregado', 'd1000000-0000-0000-0000-000000000001', now())$$,
  'PT409', 'Una factura Sin armar no puede pasar a Entregado', 'cambiar_estado_despacho: una transición inválida se rechaza (409)');

select throws_ok($$select public.registrar_faltantes_despacho('f1000000-0000-0000-0000-000000000002', '[{"linea_orden": 1, "cantidad": 1}]'::jsonb, now())$$,
  'PT409', 'Solo las facturas vigentes (no anuladas ni sin confirmar) registran faltantes', 'registrar_faltantes_despacho: una anulada no registra faltantes (409)');
select throws_ok($$select public.registrar_faltantes_despacho('f1000000-0000-0000-0000-000000000008', '[{"linea_orden": 1, "cantidad": 1}]'::jsonb, now())$$,
  'PT409', 'Esta factura todavía no tiene estado de despacho', 'registrar_faltantes_despacho: sin estado de despacho no registra faltantes (409)');
select throws_ok($$select public.registrar_faltantes_despacho('f1000000-0000-0000-0000-000000000007', '[{"linea_orden": 1, "cantidad": 1}]'::jsonb, now())$$,
  'PT409', 'Los faltantes se registran con la factura en Armando o Incompleto: ahora está en Sin armar', 'registrar_faltantes_despacho: fuera de Armando o Incompleto se rechaza (409)');

select throws_ok($$select public.guardar_envio_comprobante('f1000000-0000-0000-0000-000000000002', null, 'X', null, now())$$,
  'PT409', 'Solo las facturas vigentes (no anuladas ni sin confirmar) registran el envío', 'guardar_envio_comprobante: una anulada no registra envío (409)');
select throws_ok($$select public.guardar_envio_comprobante('f1000000-0000-0000-0000-000000000008', null, 'X', null, now())$$,
  'PT409', 'Esta factura todavía no tiene estado de despacho', 'guardar_envio_comprobante: sin estado de despacho no registra envío (409)');
select throws_ok($$select public.guardar_envio_comprobante('f1000000-0000-0000-0000-000000000004', null, 'X', null, now())$$,
  'PT409', 'Esta factura ya fue entregada: no se puede cambiar el envío', 'guardar_envio_comprobante: una entregada no cambia su envío (409)');

-- ============================================================================
-- Cobros: registrar y revertir
-- ============================================================================
select throws_ok($$select public.registrar_cobro('f1000000-0000-0000-0000-000000000001', 100, 'b1000000-0000-0000-0000-00000000000a', null, null)$$,
  'PT409', 'La factura está en borrador: confirmala antes de registrar cobros', 'registrar_cobro: un borrador no admite cobros (409)');
select throws_ok($$select public.registrar_cobro('f1000000-0000-0000-0000-000000000002', 100, 'b1000000-0000-0000-0000-00000000000a', null, null)$$,
  'PT409', 'La factura está anulada: no admite cobros', 'registrar_cobro: una anulada no admite cobros (409)');

select throws_ok($$select public.revertir_cobro('c0b00000-0000-0000-0000-000000000007', 'm')$$,
  'PT409', 'Un contra-asiento no se revierte', 'revertir_cobro: un contra-asiento no se revierte (409)');
select throws_ok($$select public.revertir_cobro('c0b00000-0000-0000-0000-000000000004', 'm')$$,
  'PT409', 'El cobro de un contrarreembolso se corrige desde el contrarreembolso', 'revertir_cobro: el cobro de un contrarreembolso no se revierte (409)');
select throws_ok($$select public.revertir_cobro('c0b00000-0000-0000-0000-000000000002', 'otra vez')$$,
  'PT409', 'El cobro ya fue revertido', 'revertir_cobro: un cobro se revierte una sola vez (409)');
select throws_ok($$select public.revertir_cobro('c0b00000-0000-0000-0000-000000000003', 'm')$$,
  'PT409', 'El cobro está conciliado: revertí primero la conciliación', 'revertir_cobro: un cobro conciliado no se revierte (409)');
select throws_ok($$select public.revertir_cobro('c0b00000-0000-0000-0000-000000000005', 'm')$$,
  'PT409', 'La factura no está en un estado operativo: no admite revertir cobros', 'revertir_cobro: sobre una anulada no se revierte (409)');

-- ============================================================================
-- Contrarreembolsos y envíos en moto
-- ============================================================================
select throws_ok($$select public.marcar_contrarreembolso_cobrado('c4000000-0000-0000-0000-000000000001', (select actualizado_en from dominio.contrarreembolsos where id = 'c4000000-0000-0000-0000-000000000001'))$$,
  'PT409', 'La factura está anulada: el contrarreembolso no se puede cobrar', 'marcar_contrarreembolso_cobrado: una factura anulada no se cobra (409)');

select throws_ok($$select public.actualizar_envio_moto('e3000000-0000-0000-0000-000000000002', 'Nuevo', null, 9, 9, true, now())$$,
  'PT409', 'El envío ya está rendido: no se puede editar', 'actualizar_envio_moto: un envío rendido no se edita (409)');
select throws_ok($$select public.actualizar_envio_moto('e3000000-0000-0000-0000-000000000001', 'Nuevo', null, 9, 9, true, now())$$,
  'PT409', 'La factura 0001-00000002 fue anulada: el envío en moto ya no se puede editar', 'actualizar_envio_moto: una factura anulada bloquea el envío (409)');

select * from finish();
rollback;
