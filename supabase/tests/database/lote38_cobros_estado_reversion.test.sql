-- Lote 38: `public.cobros_de_comprobante` informa `estado_reversion` ('revertido' / 'reversion' / nulo) y `motivo_reversion`
-- para que la pantalla ofrezca «Revertir cobro» solo donde corresponde. Aislamiento: otra organización y anon.
begin;

select plan(11);


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

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
create temp table rev as select public.revertir_cobro('c0b00000-0000-0000-0000-000000000002', 'Cobro mal cargado') as id;
grant select on rev to authenticated;

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.cobros_de_comprobante('f1000000-0000-0000-0000-000000000001')), 3, 'el comprobante tiene 3 filas: dos cobros y el contra-asiento');
select is((select estado_reversion from public.cobros_de_comprobante('f1000000-0000-0000-0000-000000000001') where id = 'c0b00000-0000-0000-0000-000000000001'), null, 'un cobro normal no tiene estado de reversión');
select is((select estado_reversion from public.cobros_de_comprobante('f1000000-0000-0000-0000-000000000001') where id = 'c0b00000-0000-0000-0000-000000000002'), 'revertido', 'el cobro revertido figura «revertido»');
select is((select motivo_reversion from public.cobros_de_comprobante('f1000000-0000-0000-0000-000000000001') where id = 'c0b00000-0000-0000-0000-000000000002'), 'Cobro mal cargado', 'el cobro revertido trae el motivo del contra-asiento');
select is((select estado_reversion from public.cobros_de_comprobante('f1000000-0000-0000-0000-000000000001') where id = (select id from rev)), 'reversion', 'el contra-asiento figura «reversion»');
select is((select importe from public.cobros_de_comprobante('f1000000-0000-0000-0000-000000000001') where id = (select id from rev)), -600::numeric, 'el contra-asiento es negativo');
select is((select count(*)::int from public.cobros_de_comprobante('f1000000-0000-0000-0000-000000000006') where estado_reversion is not null), 0, 'otro comprobante sin reversiones queda sin estado');

-- Otra organización no lee los cobros ajenos.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok($$select * from public.cobros_de_comprobante('f1000000-0000-0000-0000-000000000001')$$, 'PT404', 'El comprobante no existe', 'otra organización no ve los cobros');

reset role;
select is(has_function_privilege('anon', 'public.cobros_de_comprobante(uuid)', 'execute'), false, 'anon no ejecuta cobros_de_comprobante');
select is(has_function_privilege('authenticated', 'public.cobros_de_comprobante(uuid)', 'execute'), true, 'authenticated ejecuta cobros_de_comprobante');
select is((select prosecdef from pg_proc where oid = 'public.cobros_de_comprobante(uuid)'::regprocedure), false, 'sigue siendo security invoker (rige la RLS)');

select * from finish();
rollback;
