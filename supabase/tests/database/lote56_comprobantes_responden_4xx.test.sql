-- Lote 56 (MSF-654, MSF-655): las RPC de comprobantes de venta contestan con códigos que PostgREST traduce a 4xx y no
-- cambian el mensaje de negocio. «No existe / de otra organización» = `PT404` (404); «otra persona lo modificó»
-- (bloqueo optimista) = `PT412` (412). Los rechazos de estado pasaron a `PT409` en el lote 67.
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

-- F_BOR: factura en borrador (editable). F_CONF: factura confirmada sin cobros ni entrega (se puede anular).
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, confirmado_en) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000001', '2026-12-01', 'borrador', 0, 0, null),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000002', '2026-12-01', 'confirmada', 500, 500, now());

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function pg_temp.como(uuid) to public;

-- ============================================================================
-- «No existe»: PT404 con el mismo mensaje, para quien es de otra organización
-- ============================================================================
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok($$select public.obtener_comprobante('f1000000-0000-0000-0000-000000000001')$$, 'PT404', 'El comprobante no existe', 'obtener_comprobante: otra organización recibe 404');
select throws_ok($$select public.historial_comprobante('f1000000-0000-0000-0000-000000000001')$$, 'PT404', 'El comprobante no existe', 'historial_comprobante: otra organización recibe 404');
select throws_ok($$select public.transiciones_permitidas_comprobante('f1000000-0000-0000-0000-000000000001')$$, 'PT404', 'El comprobante no existe', 'transiciones_permitidas_comprobante: otra organización recibe 404');
select throws_ok($$select * from public.saldo_comprobante('f1000000-0000-0000-0000-000000000002')$$, 'PT404', 'El comprobante no existe', 'saldo_comprobante: otra organización recibe 404');
select throws_ok($$select * from public.cobros_de_comprobante('f1000000-0000-0000-0000-000000000002')$$, 'PT404', 'El comprobante no existe', 'cobros_de_comprobante: otra organización recibe 404');
select throws_ok($$select public.confirmar_comprobante('f1000000-0000-0000-0000-000000000001')$$, 'PT404', 'El comprobante no existe', 'confirmar_comprobante: otra organización recibe 404');
select throws_ok($$select public.anular_comprobante('f1000000-0000-0000-0000-000000000002', 'Error de carga', now())$$, 'PT404', 'El comprobante no existe', 'anular_comprobante: otra organización recibe 404');
select throws_ok($$select public.cambiar_estado_comprobante('f1000000-0000-0000-0000-000000000002', 'cobrado', now())$$, 'PT404', 'El comprobante no existe', 'cambiar_estado_comprobante: otra organización recibe 404');
select throws_ok($$select public.guardar_lineas_comprobante('f1000000-0000-0000-0000-000000000001', '[]'::jsonb, now())$$, 'PT404', 'El comprobante no existe', 'guardar_lineas_comprobante: otra organización recibe 404');
select throws_ok($$select public.guardar_comprobante('f1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'mostrador', '2026-12-01', null, null, null, now())$$, 'PT404', 'El comprobante no existe', 'guardar_comprobante: otra organización recibe 404');

-- ============================================================================
-- Conflicto de edición: PT412 con el mensaje de siempre
-- ============================================================================
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok($$select public.guardar_comprobante('f1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'mostrador', '2026-12-01', null, null, null, '2000-01-01T00:00:00Z')$$, 'PT412', 'Otra persona modificó este comprobante. Recargalo para ver los cambios', 'guardar_comprobante: una versión vieja es un conflicto (412)');
select throws_ok($$select public.guardar_lineas_comprobante('f1000000-0000-0000-0000-000000000001', '[]'::jsonb, '2000-01-01T00:00:00Z')$$, 'PT412', 'Otra persona modificó este comprobante. Recargalo para ver los cambios', 'guardar_lineas_comprobante: una versión vieja es un conflicto (412)');
select throws_ok($$select public.anular_comprobante('f1000000-0000-0000-0000-000000000002', 'Error de carga', '2000-01-01T00:00:00Z')$$, 'PT412', 'Alguien modificó este comprobante mientras lo mirabas: recargalo y volvé a intentar', 'anular_comprobante: una versión vieja es un conflicto (412)');
select throws_ok($$select public.cambiar_estado_comprobante('f1000000-0000-0000-0000-000000000002', 'aceptado', '2000-01-01T00:00:00Z')$$, 'PT412', 'Alguien modificó este comprobante mientras lo mirabas: recargalo y volvé a intentar', 'cambiar_estado_comprobante: una versión vieja es un conflicto (412)');

-- El estado que no admite la acción sigue con su código (fuera de este lote).
select throws_ok($$select public.guardar_comprobante('f1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'mostrador', '2026-12-01', null, null, null, now())$$, 'PT409', 'El comprobante ya está cerrado y no se puede modificar', 'una factura confirmada responde PT409 (estado que no admite la acción)');

select * from finish();
rollback;
