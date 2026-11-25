-- Lote 57 (MSF-654, MSF-655): las RPC de despacho, envío y cobros de Ventas contestan `PT404` (HTTP 404) cuando el
-- dato no existe o es de otra organización y `PT412` (HTTP 412) ante un conflicto de edición, con el mismo mensaje de
-- negocio de siempre.
begin;

select plan(15);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into dominio.clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista');

insert into dominio.formas_pago (id, organizacion_id, empresa_id, nombre, tipo, exige_cuenta_cobro, genera_deuda, activo) values
  ('b1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Efectivo', 'efectivo', false, false, true);

insert into dominio.cuentas_cobro (id, organizacion_id, nombre, titular, banco, activa) values
  ('e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Banco Uno', 'Titular Uno', 'Galicia', true);

-- F_DESP: factura confirmada con despacho `sin_armar`. Un cobro de 100 sobre ella.
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, estado_despacho, total_sin_iva, total_con_iva, confirmado_en) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000001', '2026-12-01', 'confirmada', 'sin_armar', 500, 500, now());

insert into dominio.cobros_comprobante
  (id, organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, cuenta_cobro_id, origen, registrado_por, registrado_por_nombre) values
  ('c0b00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000001', 100, 'b1000000-0000-0000-0000-00000000000a', null, 'manual', 'd1000000-0000-0000-0000-000000000001', 'Admin');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function pg_temp.como(uuid) to public;

-- ============================================================================
-- «No existe»: PT404 con el mismo mensaje para quien es de otra organización
-- ============================================================================
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok($$select public.cambiar_estado_despacho('f1000000-0000-0000-0000-000000000001', 'armando', 'd2000000-0000-0000-0000-000000000001', now())$$, 'PT404', 'El comprobante no existe', 'cambiar_estado_despacho: otra organización recibe 404');
select throws_ok($$select public.registrar_faltantes_despacho('f1000000-0000-0000-0000-000000000001', '[{"linea_id": "f1000000-0000-0000-0000-0000000000aa", "cantidad": 1}]'::jsonb, now())$$, 'PT404', 'El comprobante no existe', 'registrar_faltantes_despacho: otra organización recibe 404');
select throws_ok($$select public.guardar_envio_comprobante('f1000000-0000-0000-0000-000000000001', null, null, null, now())$$, 'PT404', 'El comprobante no existe', 'guardar_envio_comprobante: otra organización recibe 404');
select throws_ok($$select public.obtener_despacho_comprobante('f1000000-0000-0000-0000-000000000001')$$, 'PT404', 'El comprobante no existe', 'obtener_despacho_comprobante: otra organización recibe 404');
select throws_ok($$select public.obtener_envio_comprobante('f1000000-0000-0000-0000-000000000001')$$, 'PT404', 'El comprobante no existe', 'obtener_envio_comprobante: otra organización recibe 404');
select throws_ok($$select * from public.listar_responsables_despacho('a1000000-0000-0000-0000-00000000000a', 'armar')$$, 'PT404', 'La tienda no existe', 'listar_responsables_despacho: otra organización recibe 404');
select throws_ok($$select public.registrar_cobro('f1000000-0000-0000-0000-000000000001', 50, 'b1000000-0000-0000-0000-00000000000a', null, null)$$, 'PT404', 'El comprobante no existe', 'registrar_cobro: otra organización recibe 404');
select throws_ok($$select public.revertir_cobro('c0b00000-0000-0000-0000-000000000001', 'Cobro mal cargado')$$, 'PT404', 'El cobro no existe', 'revertir_cobro: otra organización recibe 404');
select throws_ok($$select public.actualizar_forma_pago('b1000000-0000-0000-0000-00000000000a', now(), 'Otro', 'efectivo', false, false, 'cobrado', 3, true)$$, 'PT404', 'La forma de pago no existe', 'actualizar_forma_pago: otra organización recibe 404');
select throws_ok($$select public.actualizar_cuenta_cobro('e1000000-0000-0000-0000-00000000000a', now(), 'Banco', 'Titular', '30701234568', 'Banco', null, '0170099220000067797370', 'cuenta_corriente', 'ARS', 5, true, null, '{}')$$, 'PT404', 'La cuenta de cobro no existe', 'actualizar_cuenta_cobro: otra organización recibe 404');
select throws_ok($$select public.cambiar_estado_forma_pago('b1000000-0000-0000-0000-00000000000a', false)$$, 'PT404', 'La forma de pago no existe', 'cambiar_estado_forma_pago: otra organización recibe 404');
select throws_ok($$select public.cambiar_estado_cuenta_cobro('e1000000-0000-0000-0000-00000000000a', false)$$, 'PT404', 'La cuenta de cobro no existe', 'cambiar_estado_cuenta_cobro: otra organización recibe 404');

-- ============================================================================
-- Conflicto de edición: PT412 con el mensaje de siempre
-- ============================================================================
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok($$select public.guardar_envio_comprobante('f1000000-0000-0000-0000-000000000001', null, null, null, '2000-01-01T00:00:00Z')$$, 'PT412', 'Alguien modificó este comprobante mientras lo mirabas: recargalo y volvé a intentar', 'guardar_envio_comprobante: una versión vieja es un conflicto (412)');
select throws_ok($$select public.actualizar_forma_pago('b1000000-0000-0000-0000-00000000000a', '2000-01-01T00:00:00Z', 'Otro', 'efectivo', false, false, 'cobrado', 3, true)$$, 'PT412', 'La forma de pago fue modificada por otra persona', 'actualizar_forma_pago: una versión vieja es un conflicto (412)');
select throws_ok($$select public.actualizar_cuenta_cobro('e1000000-0000-0000-0000-00000000000a', '2000-01-01T00:00:00Z', 'Banco', 'Titular', '30701234568', 'Banco', null, '0170099220000067797370', 'cuenta_corriente', 'ARS', 5, true, null, '{}')$$, 'PT412', 'La cuenta de cobro fue modificada por otra persona', 'actualizar_cuenta_cobro: una versión vieja es un conflicto (412)');

select * from finish();
rollback;
