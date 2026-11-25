-- Lote 73 (MSF-599, MSF-654 y MSF-655, décima ola): las RPC de gastos, devoluciones (RMA), contactos, consultas, rendición de
-- envíos en moto, notas de crédito y facturación de presupuestos contestan `PT404` (HTTP 404) cuando el dato no existe,
-- `PT412` (HTTP 412) ante un conflicto de edición y `PT409` (HTTP 409) cuando el estado o la regla de negocio no admite la acción
-- (antes `P0002`, `40001` y `55000`, HTTP 500), con el mismo mensaje de negocio de siempre. Cada afirmación comprueba código y mensaje.
-- Fixture como postgres; verificaciones como «authenticated» con request.jwt.claims, igual que PostgREST.
begin;

select plan(30);

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

-- Comprobantes de San Javucho:
--   F_BORR  factura en borrador
--   F_ANU   factura anulada (con un envío en moto sin rendir)
--   F_CONF  factura confirmada (la nota de crédito de un RMA la cita)
--   F_BORM  factura en borrador con un envío en moto con abono
--   P_PEND  presupuesto pendiente · P_VENC presupuesto aceptado y vencido · P_RECH presupuesto rechazado
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, confirmado_en, valido_hasta) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000001', '2026-12-01', 'borrador', 500, 500, null, null),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000002', '2026-12-01', 'anulada', 500, 500, now(), null),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000003', '2026-12-01', 'confirmada', 500, 500, now(), null),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000004', '2026-12-01', 'borrador', 500, 500, null, null),
  ('f1000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'presupuesto', '0001-00000011', '2026-12-01', 'pendiente', 500, 500, null, null),
  ('f1000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'presupuesto', '0001-00000012', '2019-12-01', 'aceptado', 500, 500, null, '2020-01-01'),
  ('f1000000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'presupuesto', '0001-00000013', '2026-12-01', 'rechazado', 500, 500, null, null);

-- La nota de crédito que resuelve el RMA de R_NC.
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva, confirmado_en, comprobante_origen_id, nc_tipo, nc_concepto) values
  ('f1000000-0000-0000-0000-0000000000b3', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'nota_credito', '00000001', 1, '2026-12-02', 'confirmada', 0, 0, now(),
   'f1000000-0000-0000-0000-000000000003', 'devolucion_importe', 'Ajuste comercial');

-- Devoluciones: R_NC resuelta con nota de crédito, R_STOCK resuelta con reingreso de stock, R_ABI abierta.
insert into dominio.rma (id, organizacion_id, empresa_id, comprobante_id, numero, forma_rma, motivo, estado, nota_credito_id, stock_reingresado_en) values
  ('a3000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000003', 'RMA-0001', 'devolucion_importe', 'Falla', 'cerrado', 'f1000000-0000-0000-0000-0000000000b3', null),
  ('a3000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000003', 'RMA-0002', 'cambio_directo', 'Falla', 'cerrado', null, now()),
  ('a3000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000003', 'RMA-0003', 'cambio_directo', 'Falla', 'abierto', null, null);

insert into dominio.envios_moto (id, organizacion_id, comprobante_id, mensajero, costo_envio, abono, enviado, rendido, rendido_en) values
  ('e3000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000002', 'Ana', 10, 0, true, false, null),
  ('e3000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000004', 'Beto', 10, 100, true, false, null);

-- Contacto y consulta de San Javucho, y la dirección de avisos ya guardada.
insert into dominio.contactos (id, organizacion_id, empresa_id, nombre, correo, consentimiento_texto) values
  ('c7000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Ana Pérez', 'ana@example.com', 'Acepta que la contactemos');
insert into dominio.consultas (id, organizacion_id, empresa_id, origen, nombre, contacto, mensaje) values
  ('c8000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'formulario', 'Luis', 'luis@example.com', 'Hola');
insert into dominio.consultas_configuracion (empresa_id, organizacion_id, correo_avisos) values
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'avisos@example.com');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function pg_temp.como(uuid) to public;
create temp table ids (clave text primary key, id uuid);
grant all on ids to public;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
insert into ids select 'gasto', public.guardar_gasto(null, 'a1000000-0000-0000-0000-00000000000a', '2026-03-06', 'Servicios', 'fijo', 'Internet', 36800, 'ARS', false, null);

-- ============================================================================
-- Gastos
-- ============================================================================
select throws_ok($$select public.guardar_gasto(null, 'ffffffff-0000-0000-0000-000000000000', '2026-03-06', 'Servicios', 'fijo', null, 100, 'ARS', false, null)$$,
  'PT404', 'La empresa no existe', 'guardar_gasto: una empresa inexistente responde 404');
select throws_ok($$select public.guardar_gasto('ffffffff-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-00000000000a', '2026-03-06', 'Servicios', 'fijo', null, 100, 'ARS', false, now())$$,
  'PT404', 'El gasto no existe', 'guardar_gasto: un gasto inexistente responde 404');
select throws_ok(format($$select public.guardar_gasto(%L, 'a1000000-0000-0000-0000-00000000000a', '2026-03-06', 'Servicios', 'fijo', 'Otro detalle', 36800, 'ARS', false, '2000-01-01T00:00:00Z')$$, (select id from ids where clave = 'gasto')),
  'PT412', 'El gasto cambió mientras lo editabas: recargá la lista', 'guardar_gasto: una versión vieja es un conflicto (412)');
select throws_ok($$select public.anular_gasto('ffffffff-0000-0000-0000-000000000000', 'Error de carga', now())$$,
  'PT404', 'El gasto no existe', 'anular_gasto: un gasto inexistente responde 404');
select throws_ok(format($$select public.anular_gasto(%L, 'Error de carga', '2000-01-01T00:00:00Z')$$, (select id from ids where clave = 'gasto')),
  'PT412', 'El gasto cambió mientras lo editabas: recargá la lista', 'anular_gasto: una versión vieja es un conflicto (412)');

-- ============================================================================
-- Devoluciones (RMA)
-- ============================================================================
select throws_ok($$select public.registrar_rma('ffffffff-0000-0000-0000-000000000000', '[{"linea_id": "ffffffff-0000-0000-0000-000000000001", "cantidad": 1}]'::jsonb, 'cambio_directo', 'Falla', null)$$,
  'PT404', 'El comprobante no existe', 'registrar_rma: un comprobante inexistente responde 404');
select throws_ok($$select public.registrar_rma('f1000000-0000-0000-0000-000000000001', '[{"linea_id": "ffffffff-0000-0000-0000-000000000001", "cantidad": 1}]'::jsonb, 'cambio_directo', 'Falla', null)$$,
  'PT409', 'La factura está en borrador: confirmala antes de registrar una devolución', 'registrar_rma: una factura en borrador no admite devoluciones (409)');
select throws_ok($$select public.registrar_rma('f1000000-0000-0000-0000-000000000002', '[{"linea_id": "ffffffff-0000-0000-0000-000000000001", "cantidad": 1}]'::jsonb, 'cambio_directo', 'Falla', null)$$,
  'PT409', 'La factura está anulada: no admite devoluciones', 'registrar_rma: una factura anulada no admite devoluciones (409)');

select throws_ok($$select public.cambiar_estado_rma('ffffffff-0000-0000-0000-000000000000', 'en_gestion', now())$$,
  'PT404', 'La devolución no existe', 'cambiar_estado_rma: una devolución inexistente responde 404');
select throws_ok($$select public.cambiar_estado_rma('a3000000-0000-0000-0000-000000000003', 'en_gestion', '2000-01-01T00:00:00Z')$$,
  'PT412', 'La devolución fue modificada por otra persona', 'cambiar_estado_rma: un sello viejo es un conflicto (412)');

select throws_ok($$select public.reingresar_stock_rma('ffffffff-0000-0000-0000-000000000000', null)$$,
  'PT404', 'La devolución no existe', 'reingresar_stock_rma: una devolución inexistente responde 404');
select throws_ok($$select public.reingresar_stock_rma('a3000000-0000-0000-0000-000000000001', null)$$,
  'PT409', 'La devolución ya se resolvió con una nota de crédito', 'reingresar_stock_rma: una devolución con nota de crédito no reingresa stock (409)');

select throws_ok($$select public.vincular_nota_credito_rma('ffffffff-0000-0000-0000-000000000000', 'devolucion_importe', null, 'Ajuste')$$,
  'PT404', 'La devolución no existe', 'vincular_nota_credito_rma: una devolución inexistente responde 404');
select throws_ok($$select public.vincular_nota_credito_rma('a3000000-0000-0000-0000-000000000002', 'devolucion_importe', null, 'Ajuste')$$,
  'PT409', 'La devolución ya se resolvió con reingreso de stock', 'vincular_nota_credito_rma: una devolución con reingreso no admite nota de crédito (409)');

-- ============================================================================
-- Notas de crédito, rendición de envíos en moto y facturación de presupuestos (solo estado)
-- ============================================================================
select throws_ok($$select public.emitir_nota_credito('f1000000-0000-0000-0000-000000000001', 'devolucion_importe', '[{"importe_sin_iva": 100}]'::jsonb, 'Ajuste')$$,
  'PT409', 'La factura está en borrador: confirmala antes de emitir una nota de crédito', 'emitir_nota_credito: una factura en borrador no admite notas (409)');
select throws_ok($$select public.emitir_nota_credito('f1000000-0000-0000-0000-000000000002', 'devolucion_importe', '[{"importe_sin_iva": 100}]'::jsonb, 'Ajuste')$$,
  'PT409', 'La factura está anulada: no admite notas de crédito', 'emitir_nota_credito: una factura anulada no admite notas (409)');
select throws_ok($$select public.emitir_nota_credito('ffffffff-0000-0000-0000-000000000000', 'devolucion_importe', '[{"importe_sin_iva": 100}]'::jsonb, 'Ajuste')$$,
  'PT404', 'La factura no existe', 'emitir_nota_credito: una factura inexistente responde 404');

select throws_ok($$select public.rendir_envios_moto(array['e3000000-0000-0000-0000-000000000001']::uuid[])$$,
  'PT409', 'La factura 0001-00000002 fue anulada: su envío en moto no se puede rendir, no se rindió ninguno', 'rendir_envios_moto: el envío de una factura anulada no se rinde (409)');
select throws_ok($$select public.rendir_envios_moto(array['e3000000-0000-0000-0000-000000000002']::uuid[])$$,
  'PT409', 'La factura 0001-00000004 está en borrador: confirmala antes de rendir su envío en moto, no se rindió ninguno', 'rendir_envios_moto: el envío de una factura en borrador con abono no se rinde (409)');

select throws_ok($$select public.facturar_presupuesto('f1000000-0000-0000-0000-0000000000a1')$$,
  'PT409', 'Aceptá el presupuesto antes de facturarlo', 'facturar_presupuesto: un presupuesto pendiente no se factura (409)');
select throws_ok($$select public.facturar_presupuesto('f1000000-0000-0000-0000-0000000000a3')$$,
  'PT409', 'Este presupuesto ya no se puede facturar', 'facturar_presupuesto: un presupuesto en otro estado no se factura (409)');
select throws_ok($$select public.facturar_presupuesto('f1000000-0000-0000-0000-0000000000a2')$$,
  'PT409', 'El presupuesto está vencido y no se puede facturar', 'facturar_presupuesto: un presupuesto vencido no se factura (409)');
select throws_ok($$select public.facturar_presupuesto('ffffffff-0000-0000-0000-000000000000')$$,
  'PT404', 'El presupuesto no existe', 'facturar_presupuesto: un presupuesto inexistente responde 404');

-- ============================================================================
-- Contactos y consultas
-- ============================================================================
select throws_ok($$select public.actualizar_contacto('c7000000-0000-0000-0000-000000000001', 'Ana María Pérez', 'ana@example.com', null, '2000-01-01T00:00:00Z')$$,
  'PT412', 'El contacto fue modificado por otra persona', 'actualizar_contacto: un sello viejo es un conflicto (412)');
select throws_ok($$select public.anonimizar_contacto('c7000000-0000-0000-0000-000000000001', '2000-01-01T00:00:00Z')$$,
  'PT412', 'El contacto fue modificado por otra persona', 'anonimizar_contacto: un sello viejo es un conflicto (412)');
select throws_ok($$select public.actualizar_consulta('c8000000-0000-0000-0000-000000000001', 'en_curso', null, null, '2000-01-01T00:00:00Z')$$,
  'PT412', 'La consulta fue modificada por otra persona', 'actualizar_consulta: un sello viejo es un conflicto (412)');
select throws_ok($$select public.guardar_correo_avisos_consultas('a1000000-0000-0000-0000-00000000000a', 'otro@example.com', '2000-01-01T00:00:00Z')$$,
  'PT412', 'La dirección de avisos fue modificada por otra persona', 'guardar_correo_avisos_consultas: un sello viejo es un conflicto (412)');
select throws_ok($$select * from public.cambiar_estado_estado_consulta('ffffffff-0000-0000-0000-000000000000', true)$$,
  'PT404', 'El estado no existe', 'cambiar_estado_estado_consulta: un estado inexistente responde 404');
select throws_ok($$select * from public.renombrar_estado_consulta('ffffffff-0000-0000-0000-000000000000', 'Otro')$$,
  'PT404', 'El estado no existe', 'renombrar_estado_consulta: un estado inexistente responde 404');

-- Lo que esta ola no convierte sigue con su código: el rechazo de datos sigue siendo 22023.
select throws_ok($$select public.anular_gasto((select id from ids where clave = 'gasto'), '', now())$$,
  '22023', 'El motivo es obligatorio y admite hasta 200 caracteres', 'anular_gasto: un motivo vacío sigue siendo un error de validación (22023)');

select * from finish();
rollback;
