-- MSF-145 (Ventas motos), decisiones de Nicolás del 2026-11-12:
--   (4) una factura anulada DESPUÉS de cargar el envío lo bloquea: no se edita ni se rinde y el listado muestra el motivo;
--   (5) la elegibilidad excluye el borrador (solo facturas emitidas);
--   (6) rendir registra el cobro en el libro (tope = saldo neto) y una nota de crédito posterior baja el abono de los envíos
--       pendientes (nunca el de los rendidos).
--
-- Cubre: borrador no elegible (selector y registro); anulada después bloquea editar, rendir (individual y en lote, todo o
-- nada), el listado y la tarjeta; rendir crea el cobro con origen `contrarreembolso`, forma de la factura o «Contrarreembolso» de
-- la tienda, tope por el saldo neto (abono mayor que el total, cobro previo, nota previa), sin cobro con abono 0, factura a
-- Cobrado, evento, idempotencia y errores sin forma de pago o con la factura en borrador; la nota de crédito que baja el abono
-- pendiente (a 0 incluso), no toca el rendido ni lo que ya cabe en el saldo y deja su evento; permisos y aislamiento por tienda
-- y por organización.
--
-- Fechas relativas (current_date - n): ninguna fecha absoluta. Prefijos hexadecimales: a empresas, b formas de envío, c clientes,
-- d usuarios, e envíos, f comprobantes, 9 formas de pago. Las filas del fixture las inserta postgres (RLS no aplica); las
-- verificaciones corren como «authenticated» vía request.jwt.claims, igual que PostgREST.
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
  ('d1000000-0000-0000-0000-000000000005', 'consulta-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000012', 'operador-a-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('d1000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- Consulta y el Operador trabajan en San Javucho (A). Mundo JC (B) no tiene forma «Contrarreembolso»: sirve para el error.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d1000000-0000-0000-0000-000000000012', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'operador');

insert into clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 20, 'Cliente Dos', 'minorista');

insert into dominio.formas_envio (id, organizacion_id, empresa_id, nombre, tipo) values
  ('b1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Moto', 'moto'),
  ('b1000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'Moto', 'moto'),
  ('b2000000-0000-0000-0000-00000000000d', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-00000000000c', 'Moto', 'moto');

-- Formas de pago: «Efectivo» y «Contrarreembolso» en A; «Contrarreembolso» en la otra organización; B no tiene ninguna.
insert into dominio.formas_pago (id, organizacion_id, empresa_id, nombre, tipo, exige_cuenta_cobro, genera_deuda, activo) values
  ('9a000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Efectivo', 'efectivo', false, false, true),
  ('9a000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Contrarreembolso', 'contrarreembolso', false, false, true),
  ('9a000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-00000000000c', 'Contrarreembolso', 'contrarreembolso', false, false, true),
  -- Una «Contrarreembolso» INACTIVA de A que ordena antes que la activa: si la rendición no filtra por `activo`, la elige.
  ('9a000000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'A Contrarreembolso vieja', 'contrarreembolso', false, false, false),
  -- Una forma que genera deuda (cobro parcial → la factura pasa a Deuda).
  ('9a000000-0000-0000-0000-00000000000e', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Cuenta corriente', 'otro', false, true, true);
update dominio.formas_pago set orden = 1 where id = '9a000000-0000-0000-0000-00000000000d';
update dominio.formas_pago set orden = 5 where id = '9a000000-0000-0000-0000-00000000000b';

-- Facturas (todas con forma de envío moto; fecha = hoy − n días). «n» es el número del comprobante: 0001-0000000n.
--   F1  confirmada A total 1000   cobro parcial          F7  confirmada A total 1000   cobro previo manual de 300 + abono 900
--   F2  borrador   A total  500   no elegible            F8  confirmada A total 1000   envío ya rendido (nota posterior)
--   F3  confirmada A total 1000   se anula después       F9  borrador   A total  500   envío ya cargado, abono 100
--   F4  confirmada A total 1000   abono 1500 > total     F10 confirmada A total 1000   con forma de pago «Efectivo»
--   F5  confirmada A total 1000   nota de crédito        F11 confirmada A total 1000   abono 100 (la nota no lo supera)
--   F6  confirmada B total  500   tienda sin forma       F12 org 2 confirmada total 700
--   F13 confirmada A total 1000   abono 0
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, confirmado_en, envio_id, forma_pago_id)
select ('f' || n.k || '000000-0000-0000-0000-0000000000' || lpad(n.i::text, 2, '0'))::uuid,
       n.org, n.emp, n.cli, 'factura', '0001-' || lpad(n.i::text, 8, '0'), current_date - n.i, n.estado,
       n.total, n.total, case when n.estado = 'borrador' then null else now() end, n.forma, n.pago
  from (values
    ('1',  1, '11111111-1111-1111-1111-111111111111'::uuid, 'a1000000-0000-0000-0000-00000000000a'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid, 'b1000000-0000-0000-0000-00000000000a'::uuid, 'confirmada', 1000, null::uuid),
    ('1',  2, '11111111-1111-1111-1111-111111111111'::uuid, 'a1000000-0000-0000-0000-00000000000a'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid, 'b1000000-0000-0000-0000-00000000000a'::uuid, 'borrador',    500, null),
    ('1',  3, '11111111-1111-1111-1111-111111111111'::uuid, 'a1000000-0000-0000-0000-00000000000a'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid, 'b1000000-0000-0000-0000-00000000000a'::uuid, 'confirmada', 1000, null),
    ('1',  4, '11111111-1111-1111-1111-111111111111'::uuid, 'a1000000-0000-0000-0000-00000000000a'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid, 'b1000000-0000-0000-0000-00000000000a'::uuid, 'confirmada', 1000, null),
    ('1',  5, '11111111-1111-1111-1111-111111111111'::uuid, 'a1000000-0000-0000-0000-00000000000a'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid, 'b1000000-0000-0000-0000-00000000000a'::uuid, 'confirmada', 1000, null),
    ('1',  6, '11111111-1111-1111-1111-111111111111'::uuid, 'a1000000-0000-0000-0000-00000000000b'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid, 'b1000000-0000-0000-0000-00000000000c'::uuid, 'confirmada',  500, null),
    ('1',  7, '11111111-1111-1111-1111-111111111111'::uuid, 'a1000000-0000-0000-0000-00000000000a'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid, 'b1000000-0000-0000-0000-00000000000a'::uuid, 'confirmada', 1000, null),
    ('1',  8, '11111111-1111-1111-1111-111111111111'::uuid, 'a1000000-0000-0000-0000-00000000000a'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid, 'b1000000-0000-0000-0000-00000000000a'::uuid, 'confirmada', 1000, null),
    ('1',  9, '11111111-1111-1111-1111-111111111111'::uuid, 'a1000000-0000-0000-0000-00000000000a'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid, 'b1000000-0000-0000-0000-00000000000a'::uuid, 'borrador',    500, null),
    ('1', 10, '11111111-1111-1111-1111-111111111111'::uuid, 'a1000000-0000-0000-0000-00000000000a'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid, 'b1000000-0000-0000-0000-00000000000a'::uuid, 'confirmada', 1000, '9a000000-0000-0000-0000-00000000000a'::uuid),
    ('1', 11, '11111111-1111-1111-1111-111111111111'::uuid, 'a1000000-0000-0000-0000-00000000000a'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid, 'b1000000-0000-0000-0000-00000000000a'::uuid, 'confirmada', 1000, null),
    ('2', 12, '22222222-2222-2222-2222-222222222222'::uuid, 'a2000000-0000-0000-0000-00000000000c'::uuid, 'c2000000-0000-0000-0000-000000000001'::uuid, 'b2000000-0000-0000-0000-00000000000d'::uuid, 'confirmada',  700, null),
    ('1', 13, '11111111-1111-1111-1111-111111111111'::uuid, 'a1000000-0000-0000-0000-00000000000a'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid, 'b1000000-0000-0000-0000-00000000000a'::uuid, 'confirmada', 1000, null)
  ) as n(k, i, org, emp, cli, forma, estado, total, pago);

-- Envíos (id e…NN = envío del comprobante f…NN). Todos enviados salvo aclaración; mensajeros distintos para poder rendir por fila.
insert into dominio.envios_moto
  (id, organizacion_id, comprobante_id, mensajero, costo_envio, abono, enviado, rendido, rendido_en)
values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000001', 'Juan',   10,  400, true, false, null),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000003', 'Ana',    10,  300, true, false, null),
  ('e1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000004', 'Beto',   10, 1500, true, false, null),
  ('e1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000005', 'Carla',  10,  800, true, false, null),
  ('e1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000006', 'Dario',  10,   50, true, false, null),
  ('e1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000007', 'Elena',  10,  900, true, false, null),
  ('e1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000008', 'Fabio',  10,  700, true, true, now() - interval '2 days'),
  ('e1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000009', 'Gabi',   10,  100, true, false, null),
  ('e1000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000010', 'Hugo',   10,  250, true, false, null),
  ('e1000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000011', 'Ines',   10,  100, true, false, null),
  ('e2000000-0000-0000-0000-000000000012', '22222222-2222-2222-2222-222222222222', 'f2000000-0000-0000-0000-000000000012', 'Julia',  10,  700, true, false, null),
  ('e1000000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000013', 'Karen',  10,    0, true, false, null);

-- F14 (confirmada) y F15 (borrador) con envío, para el superadmin sin membresía y para listar todos los borradores.
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, confirmado_en, envio_id)
values
  ('f1000000-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000014', current_date - 14, 'confirmada', 1000, 1000, now(), 'b1000000-0000-0000-0000-00000000000a'),
  ('f1000000-0000-0000-0000-000000000015', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000015', current_date - 15, 'borrador', 500, 500, null, 'b1000000-0000-0000-0000-00000000000a');
insert into dominio.envios_moto (id, organizacion_id, comprobante_id, mensajero, costo_envio, abono, enviado) values
  ('e1000000-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000014', 'Lola', 10, 200, true),
  ('e1000000-0000-0000-0000-000000000015', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000015', 'Gabi', 10, 50, true);

-- Un superadmin con organización activa pero SIN membresía en ella.
insert into auth.users (id, email) values ('d1000000-0000-0000-0000-000000000099', 'superadmin@example.com');
insert into superadmins (user_id) values ('d1000000-0000-0000-0000-000000000099');
insert into superadmin_organizacion_activa (user_id, organizacion_id) values
  ('d1000000-0000-0000-0000-000000000099', '11111111-1111-1111-1111-111111111111');

-- F7 ya tiene un cobro manual de 300 (el tope neto del envío es 700).
select private.registrar_cobro_interno(
  'f1000000-0000-0000-0000-000000000007', 300, '9a000000-0000-0000-0000-00000000000a', null, 'manual',
  'd1000000-0000-0000-0000-000000000001');

-- Verifica como «authenticated» (RLS y permisos), igual que PostgREST.
create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Saldo neto de una factura (cuenta interna, como postgres).
create function pg_temp.saldo(p_factura uuid) returns numeric language sql as $$
  select saldo from private.saldo_comprobante(p_factura) $$;
create function pg_temp.estado(p_factura uuid) returns text language sql as $$
  select estado from dominio.comprobantes_venta where id = p_factura $$;

-- La factura de F-n y su envío.
create function pg_temp.f(p_n int) returns uuid language sql as $$
  select ('f1000000-0000-0000-0000-0000000000' || lpad(p_n::text, 2, '0'))::uuid $$;
create function pg_temp.e(p_n int) returns uuid language sql as $$
  select ('e1000000-0000-0000-0000-0000000000' || lpad(p_n::text, 2, '0'))::uuid $$;

-- ============================================================================
-- (5) El borrador no es elegible
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000012');
select ok(
  not exists (select 1 from public.comprobantes_para_envio_moto() where numero in ('0001-00000002', '0001-00000009')),
  'el selector no ofrece facturas en borrador'
);
select ok(
  not exists (select 1 from public.comprobantes_para_envio_moto(null, 'borrador')),
  'el selector no ofrece borradores ni buscándolos'
);
select throws_ok(
  $$select public.registrar_envio_moto('f1000000-0000-0000-0000-000000000002', 'Juan')$$,
  '22023', null, 'registrar un envío sobre un borrador se rechaza (22023)'
);
select throws_like(
  $$select public.registrar_envio_moto('f1000000-0000-0000-0000-000000000002', 'Juan')$$,
  '%borrador%', 'el mensaje dice, en castellano, que la factura está en borrador'
);
select throws_like(
  $$select public.registrar_envio_moto('f1000000-0000-0000-0000-000000000002', 'Juan')$$,
  '%confirmala%', 'y que hay que confirmarla'
);
reset role;
select is(
  (select count(*)::int from dominio.envios_moto where comprobante_id = pg_temp.f(2)),
  0, 'el rechazo no dejó ningún envío sobre el borrador'
);

-- Antes de anular: editable y rendible por el listado.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select ok(
  (select puede_editar and puede_rendir and bloqueado_motivo is null
     from public.listar_envios_moto() where comprobante_id = pg_temp.f(3)),
  'antes de anular, el envío es editable y rendible y no tiene motivo de bloqueo'
);
select is(
  (select monto from public.resumen_motos_sin_rendir() ),
  (select sum(abono) from dominio.envios_moto
     where not rendido and abono > 0 and organizacion_id = '11111111-1111-1111-1111-111111111111'
       and comprobante_id in (select id from dominio.comprobantes_venta where estado <> 'anulada')),
  'la tarjeta suma el abono de lo no rendido de facturas no anuladas'
);
reset role;

-- La factura se anula después (como postgres, igual que el flujo de anulación: el estado cambia, el envío queda).
update dominio.comprobantes_venta set estado = 'anulada' where id = pg_temp.f(3);

select pg_temp.como('d1000000-0000-0000-0000-000000000012');
select throws_ok(
  format($$select public.actualizar_envio_moto(%L, 'Ana', null, 10, 300, true, %L)$$,
    pg_temp.e(3), (select updated_at from dominio.envios_moto where id = pg_temp.e(3))),
  '55000', null, 'editar el envío de una factura anulada se rechaza (55000)'
);
select throws_like(
  format($$select public.actualizar_envio_moto(%L, 'Ana', null, 10, 300, true, %L)$$,
    pg_temp.e(3), (select updated_at from dominio.envios_moto where id = pg_temp.e(3))),
  '%anulada%', 'el mensaje de la edición dice que la factura fue anulada'
);
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select ok(
  (select not puede_editar and not puede_rendir and bloqueado_motivo like '%0001-00000003%anulada%'
     from public.listar_envios_moto() where comprobante_id = pg_temp.f(3)),
  'el listado marca el envío como bloqueado, no editable ni rendible, con el motivo en castellano'
);
select ok(
  (select bloqueado_motivo is null from public.listar_envios_moto() where comprobante_id = pg_temp.f(8)),
  'un envío ya rendido no muestra motivo de bloqueo'
);
select is(
  (select monto from public.resumen_motos_sin_rendir()),
  (select sum(abono) from dominio.envios_moto
     where not rendido and abono > 0 and organizacion_id = '11111111-1111-1111-1111-111111111111'
       and comprobante_id in (select id from dominio.comprobantes_venta where estado <> 'anulada')),
  'la tarjeta «Motos sin rendir» ya no cuenta el envío de la factura anulada'
);
select throws_ok(
  format($$select public.rendir_envios_moto(array[%L]::uuid[])$$, pg_temp.e(3)),
  '55000', null, 'rendir el envío de una factura anulada se rechaza (55000)'
);
select throws_like(
  format($$select public.rendir_envios_moto(array[%L]::uuid[])$$, pg_temp.e(3)),
  '%0001-00000003%anulada%', 'el mensaje nombra la factura anulada'
);
-- En lote es todo o nada: el envío bueno de al lado tampoco se rinde. (Mensajeros distintos: la regla de anulada va primero.)
select throws_ok(
  format($$select public.rendir_envios_moto(array[%L, %L]::uuid[])$$, pg_temp.e(3), pg_temp.e(13)),
  '55000', null, 'un lote con un envío de factura anulada se rechaza entero'
);
reset role;
select is(
  (select count(*)::int from dominio.envios_moto where id in (pg_temp.e(3), pg_temp.e(13)) and rendido),
  0, 'ni el envío de la factura anulada ni el de al lado se rindieron'
);
select is(
  (select count(*)::int from dominio.cobros_comprobante where comprobante_id in (pg_temp.f(3), pg_temp.f(13))),
  0, 'y no se registró ningún cobro'
);
select is(
  (select count(*)::int from dominio.envios_moto where id = pg_temp.e(3)),
  1, 'el envío de la factura anulada sigue existiendo (queda como registro)'
);

-- ============================================================================
-- (6) Rendir registra el cobro en el libro, con tope en el saldo neto
-- ============================================================================

-- (c) Forma «Contrarreembolso» inactiva: la rendición la ignora y usa la activa. Con `lives_ok` y `is` para que la regla se vea
-- como un `not ok` concreto (y no como un aborto del archivo) si alguien quita el filtro por `activo`.
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, confirmado_en, envio_id)
values ('f1000000-0000-0000-0000-000000000020', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000020', current_date - 20, 'confirmada', 1000, 1000, now(), 'b1000000-0000-0000-0000-00000000000a');
insert into dominio.envios_moto (id, organizacion_id, comprobante_id, mensajero, costo_envio, abono, enviado) values
  ('e1000000-0000-0000-0000-000000000020', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000020', 'Quique', 10, 300, true);
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(format($$select public.rendir_envios_moto(array[%L]::uuid[])$$, pg_temp.e(20)),
  'rendir con una forma «Contrarreembolso» inactiva y otra activa en la tienda funciona');
reset role;
select is(
  (select forma_pago_id from dominio.cobros_comprobante where comprobante_id = pg_temp.f(20)),
  '9a000000-0000-0000-0000-00000000000b'::uuid, 'el cobro usa la «Contrarreembolso» ACTIVA, no la inactiva que ordena antes');

-- Abono menor que el saldo: cobro por el abono; la factura sigue con saldo.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select set_config('t.res', public.rendir_envios_moto(array[pg_temp.e(1)])::text, true);
reset role;
select is((current_setting('t.res')::jsonb ->> 'cantidad')::int, 1, 'rinde el envío de F1');
select is((current_setting('t.res')::jsonb ->> 'total_abono')::numeric, 400::numeric, 'devuelve el total a rendir (el abono)');
select is((current_setting('t.res')::jsonb ->> 'total_cobrado')::numeric, 400::numeric, 'devuelve lo cobrado en el libro');
select is(
  (select importe from dominio.cobros_comprobante where comprobante_id = pg_temp.f(1)),
  400::numeric, 'rendir crea un cobro por el abono en el libro de la factura'
);
select is(
  (select origen from dominio.cobros_comprobante where comprobante_id = pg_temp.f(1)),
  'contrarreembolso', 'el cobro tiene origen contrarreembolso (lo cobra y rinde el mensajero)'
);
select is(
  (select forma_pago_id from dominio.cobros_comprobante where comprobante_id = pg_temp.f(1)),
  '9a000000-0000-0000-0000-00000000000b'::uuid, 'sin forma de pago en la factura usa la «Contrarreembolso» de la tienda'
);
select is(
  (select empresa_id from dominio.cobros_comprobante where comprobante_id = pg_temp.f(1)),
  'a1000000-0000-0000-0000-00000000000a'::uuid, 'el cobro es de la tienda de la factura'
);
select is(
  (select registrado_por from dominio.cobros_comprobante where comprobante_id = pg_temp.f(1)),
  'd1000000-0000-0000-0000-000000000001'::uuid, 'el cobro lo registra quien rinde'
);
select is(
  (select cobro_id from dominio.envios_moto where id = pg_temp.e(1)),
  (select id from dominio.cobros_comprobante where comprobante_id = pg_temp.f(1)),
  'el envío guarda el cobro que dejó su rendición'
);
select is(pg_temp.saldo(pg_temp.f(1)), 600::numeric, 'la factura queda con el saldo que falta (1000 − 400)');
select is(pg_temp.estado(pg_temp.f(1)), 'confirmada', 'y no pasa a Cobrado mientras tiene saldo');
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'comprobante.cobro_registrado' and detalle like '%0001-00000001%'),
  1, 'el cobro deja su evento comprobante.cobro_registrado (lo hace el mecanismo de cobros)'
);
select ok(
  (select detalle like '%cobrado en el libro 400%' from public.registro_actividad where tipo = 'envio_moto.rendido' and detalle like '%0001-00000001%'),
  'el evento de la rendición dice lo cobrado en el libro'
);

-- Abono mayor que el total: el tope es el saldo neto.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select set_config('t.res', public.rendir_envios_moto(array[pg_temp.e(4)])::text, true);
reset role;
select is((current_setting('t.res')::jsonb ->> 'total_abono')::numeric, 1500::numeric, 'el total a rendir sigue siendo el abono cargado (1500)');
select is((current_setting('t.res')::jsonb ->> 'total_cobrado')::numeric, 1000::numeric, 'pero lo cobrado en el libro se topa en el saldo neto (1000)');
select is(
  (select sum(importe) from dominio.cobros_comprobante where comprobante_id = pg_temp.f(4)),
  1000::numeric, 'el libro no supera el total de la factura'
);
select is(pg_temp.saldo(pg_temp.f(4)), 0::numeric, 'la factura queda sin saldo');
select is(pg_temp.estado(pg_temp.f(4)), 'cobrado', 'y pasa a Cobrado por el mecanismo de cobros');

-- Cobro previo: el tope es lo que falta (1000 − 300 = 700) aunque el abono sea 900.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select set_config('t.res', public.rendir_envios_moto(array[pg_temp.e(7)])::text, true);
reset role;
select is((current_setting('t.res')::jsonb ->> 'total_cobrado')::numeric, 700::numeric, 'con un cobro previo de 300 se cobra solo lo que falta (700)');
select is(
  (select sum(importe) from dominio.cobros_comprobante where comprobante_id = pg_temp.f(7)),
  1000::numeric, 'el libro suma el total de la factura'
);

-- Con forma de pago en la factura se usa esa forma.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(format($$select public.rendir_envios_moto(array[%L]::uuid[])$$, pg_temp.e(10)), 'rinde el envío de F10');
reset role;
select is(
  (select forma_pago_id from dominio.cobros_comprobante where comprobante_id = pg_temp.f(10)),
  '9a000000-0000-0000-0000-00000000000a'::uuid, 'con forma de pago en la factura (Efectivo) el cobro usa esa forma'
);

-- Abono 0: se rinde sin cobro.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select set_config('t.res', public.rendir_envios_moto(array[pg_temp.e(13)])::text, true);
reset role;
select is((current_setting('t.res')::jsonb ->> 'cantidad')::int, 1, 'un envío con abono 0 se rinde');
select is((current_setting('t.res')::jsonb ->> 'sin_cobro')::int, 1, 'y se informa que quedó sin cobro');
select is(
  (select count(*)::int from dominio.cobros_comprobante where comprobante_id = pg_temp.f(13)),
  0, 'con abono 0 no se registra ningún cobro'
);
select ok(
  (select rendido and cobro_id is null from dominio.envios_moto where id = pg_temp.e(13)),
  'el envío queda rendido sin cobro asociado'
);

-- Idempotencia: reintentar no duplica el cobro ni el evento.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select set_config('t.res', public.rendir_envios_moto(array[pg_temp.e(1), pg_temp.e(4)])::text, true);
reset role;
select is((current_setting('t.res')::jsonb ->> 'cantidad')::int, 0, 'reintentar la rendición devuelve cantidad 0');
select is(
  (select count(*)::int from dominio.cobros_comprobante where comprobante_id in (pg_temp.f(1), pg_temp.f(4))),
  2, 'y no duplica los cobros');

-- Errores: borrador con abono, tienda sin forma «Contrarreembolso». Todo o nada.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  format($$select public.rendir_envios_moto(array[%L]::uuid[])$$, pg_temp.e(9)),
  '55000', null, 'rendir el envío de una factura en borrador con abono se rechaza (55000)'
);
select throws_like(
  format($$select public.rendir_envios_moto(array[%L]::uuid[])$$, pg_temp.e(9)),
  '%borrador%confirmala%', 'el mensaje pide confirmar la factura'
);
select throws_ok(
  format($$select public.rendir_envios_moto(array[%L]::uuid[])$$, pg_temp.e(6)),
  '22023', null, 'sin forma de pago en la factura ni «Contrarreembolso» en la tienda no se puede cobrar (22023)'
);
select throws_like(
  format($$select public.rendir_envios_moto(array[%L]::uuid[])$$, pg_temp.e(6)),
  '%Contrarreembolso%', 'el mensaje explica qué falta'
);
reset role;
select is(
  (select count(*)::int from dominio.envios_moto where id in (pg_temp.e(9), pg_temp.e(6)) and (rendido or cobro_id is not null)),
  0, 'los errores no rindieron ni cobraron nada'
);

-- ============================================================================
-- (6) Una nota de crédito posterior ajusta el abono de los envíos pendientes
-- ============================================================================

-- Una nota de crédito sobre F5 (total 1000, envío pendiente de abono 800): el saldo baja a 500 y el abono con él.
create function pg_temp.nota(p_factura uuid, p_numero text, p_total numeric, p_estado text default 'confirmada') returns void
language sql as $$
  insert into dominio.comprobantes_venta
    (organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, confirmado_en, comprobante_origen_id, nc_tipo)
  select f.organizacion_id, f.empresa_id, f.cliente_id, 'nota_credito', p_numero, current_date, p_estado, p_total, p_total, now(), f.id, 'devolucion_importe'
    from dominio.comprobantes_venta f where f.id = p_factura $$;

select ok(
  (select abono = 800 from dominio.envios_moto where id = pg_temp.e(5)),
  'antes de la nota, el envío pendiente de F5 abona 800'
);
create temp table antes_nota as
  select id, abono, updated_at from dominio.envios_moto where id in (pg_temp.e(5), pg_temp.e(8), pg_temp.e(11));

select pg_temp.nota(pg_temp.f(5), '0003-00000001', 500);
select is((select abono from dominio.envios_moto where id = pg_temp.e(5)), 500::numeric,
  'la nota de 500 baja el abono pendiente al saldo neto (500)');
select ok(
  (select e.updated_at > a.updated_at from dominio.envios_moto e join antes_nota a using (id) where e.id = pg_temp.e(5)),
  'avanza la versión del envío (el diálogo de edición abierto recibe un conflicto)'
);
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'envio_moto.abono_ajustado' and detalle like '%0001-00000005%'),
  1, 'deja el evento envio_moto.abono_ajustado'
);
select ok(
  (select detalle like '%Carla%800%500%' from public.registro_actividad where tipo = 'envio_moto.abono_ajustado' and detalle like '%0001-00000005%'),
  'el evento dice el mensajero, el abono anterior y el nuevo'
);

-- Un segundo evento no se dispara si nada cambia (idempotente): una nota anulada no altera el abono.
select pg_temp.nota(pg_temp.f(5), '0003-00000002', 100, 'anulada');
select is((select abono from dominio.envios_moto where id = pg_temp.e(5)), 500::numeric, 'una nota anulada no cambia el abono');

-- Otra nota deja el saldo en 0: el abono pasa a 0 (el abono admite 0).
select pg_temp.nota(pg_temp.f(5), '0003-00000003', 500);
select is((select abono from dominio.envios_moto where id = pg_temp.e(5)), 0::numeric, 'si el saldo llega a 0 el abono queda en 0');

-- El rendido no se toca.
select pg_temp.nota(pg_temp.f(8), '0003-00000004', 600);
select ok(
  (select e.abono = a.abono and e.updated_at = a.updated_at from dominio.envios_moto e join antes_nota a using (id) where e.id = pg_temp.e(8)),
  'una nota sobre una factura con el envío ya rendido no toca el envío (ni abono ni versión)'
);
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'envio_moto.abono_ajustado' and detalle like '%0001-00000008%'),
  0, 'ni deja evento'
);

-- Un abono que ya cabe en el saldo no cambia.
select pg_temp.nota(pg_temp.f(11), '0003-00000005', 200);
select ok(
  (select e.abono = a.abono and e.updated_at = a.updated_at from dominio.envios_moto e join antes_nota a using (id) where e.id = pg_temp.e(11)),
  'un abono (100) que cabe en el saldo (800) no cambia'
);

-- Rendir después de una nota: el cobro se topa en el saldo neto (F11: total 1000, nota 200 → saldo 800, abono 100).
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select set_config('t.res', public.rendir_envios_moto(array[pg_temp.e(11)])::text, true);
reset role;
select is((current_setting('t.res')::jsonb ->> 'total_cobrado')::numeric, 100::numeric, 'rendir tras una nota cobra el abono vigente');
select is(pg_temp.saldo(pg_temp.f(11)), 700::numeric, 'y el saldo neto de la factura es total − nota − cobro');

-- ============================================================================
-- Permisos y aislamiento (tienda y organización)
-- ============================================================================

-- El envío de F5 quedó con abono 0 y sin rendir; el Operador y Consulta no pueden rendir.
select pg_temp.como('d1000000-0000-0000-0000-000000000012');
select throws_ok(format($$select public.rendir_envios_moto(array[%L]::uuid[])$$, pg_temp.e(5)),
  '42501', null, 'el Operador no puede rendir (no se registra cobro)');
reset role;
select pg_temp.como('d1000000-0000-0000-0000-000000000005');
select throws_ok(format($$select public.rendir_envios_moto(array[%L]::uuid[])$$, pg_temp.e(5)),
  '42501', null, 'Consulta no puede rendir');
reset role;
select is(
  (select count(*)::int from dominio.cobros_comprobante where comprobante_id = pg_temp.f(5)),
  0, 'los rechazos por permiso no dejaron cobros');

-- El Operador de A no ve envíos de B ni de la otra organización.
select pg_temp.como('d1000000-0000-0000-0000-000000000012');
select is((select count(*)::int from public.listar_envios_moto() where empresa_id <> 'a1000000-0000-0000-0000-00000000000a'),
  0, 'el listado del Operador solo trae su tienda');
reset role;

-- La otra organización no puede rendir envíos ajenos ni ve sus cobros; y viceversa.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok(format($$select public.rendir_envios_moto(array[%L]::uuid[])$$, pg_temp.e(5)),
  '42501', null, 'otra organización no puede rendir un envío ajeno (mismo 42501: no revela existencia)');
select is((select count(*)::int from dominio.cobros_comprobante), 0, 'otra organización no ve los cobros de la primera');
select lives_ok(format($$select public.rendir_envios_moto(array[%L]::uuid[])$$, 'e2000000-0000-0000-0000-000000000012'),
  'la otra organización rinde su propio envío con su forma «Contrarreembolso»');
reset role;
select is(
  (select count(*)::int from dominio.cobros_comprobante where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  1, 'su cobro quedó en su organización');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(format($$select public.rendir_envios_moto(array[%L]::uuid[])$$, 'e2000000-0000-0000-0000-000000000012'),
  '42501', null, 'tampoco puede la primera rendir un envío de la segunda');
reset role;

-- ============================================================================
-- Revisión de seguridad: el permiso va antes de los locks y no revela la existencia
-- ============================================================================

create function pg_temp.mensaje(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'sin error';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- El Operador de A (sin permiso en B) recibe el MISMO error (código y mensaje) exista o no el comprobante o el envío.
select pg_temp.como('d1000000-0000-0000-0000-000000000012');
select is(
  pg_temp.mensaje($$select public.registrar_envio_moto('f1000000-0000-0000-0000-000000000006', 'Juan')$$),
  pg_temp.mensaje($$select public.registrar_envio_moto('f1999999-0000-0000-0000-000000000099', 'Juan')$$),
  'registrar: un comprobante de otra tienda y uno inexistente dan el mismo error');
select alike(
  pg_temp.mensaje($$select public.registrar_envio_moto('f1999999-0000-0000-0000-000000000099', 'Juan')$$),
  '42501:%', 'registrar: el error es 42501');
select is(
  pg_temp.mensaje(format($$select public.actualizar_envio_moto(%L, 'Dario', null, 10, 50, true, now())$$, pg_temp.e(6))),
  pg_temp.mensaje($$select public.actualizar_envio_moto('e1999999-0000-0000-0000-000000000099', 'Dario', null, 10, 50, true, now())$$),
  'actualizar: un envío de otra tienda y uno inexistente dan el mismo error');
select is(
  pg_temp.mensaje(format($$select public.rendir_envios_moto(array[%L]::uuid[])$$, pg_temp.e(6))),
  pg_temp.mensaje($$select public.rendir_envios_moto(array['e1999999-0000-0000-0000-000000000099']::uuid[])$$),
  'rendir: un envío de otra tienda y uno inexistente dan el mismo error');
select alike(
  pg_temp.mensaje(format($$select public.rendir_envios_moto(array[%L, %L]::uuid[])$$, pg_temp.e(14), pg_temp.e(6))),
  '42501:%', 'rendir: el Operador (no Administrador) recibe 42501 aunque mezcle un envío de otra tienda');
reset role;
select is(
  (select count(*)::int from dominio.envios_moto where rendido and id in (pg_temp.e(6), pg_temp.e(14))),
  0, 'los rechazos no rindieron nada');

-- Quien no tiene Ventas no pasa del primer control: el mismo 42501.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select alike(
  pg_temp.mensaje(format($$select public.rendir_envios_moto(array[%L]::uuid[])$$, pg_temp.e(14))),
  '42501:%Tu rol%', 'otra organización: 42501 «Tu rol…» sobre un envío ajeno');
reset role;

-- Superadmin con organización activa y sin membresía: se avisa antes de empezar, con un mensaje claro y sin rendir nada.
select pg_temp.como('d1000000-0000-0000-0000-000000000099');
select alike(
  pg_temp.mensaje(format($$select public.rendir_envios_moto(array[%L]::uuid[])$$, pg_temp.e(14))),
  '42501:%miembro de la organización%', 'un superadmin sin membresía recibe un 42501 claro (no el genérico de rol)');
reset role;
select ok(
  (select not rendido and cobro_id is null from dominio.envios_moto where id = pg_temp.e(14)),
  'y el envío no se rindió');

-- Un administrador con varios borradores con abono: el mensaje los lista todos.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select alike(
  pg_temp.mensaje(format($$select public.rendir_envios_moto(array[%L, %L]::uuid[])$$, pg_temp.e(9), pg_temp.e(15))),
  '55000:%0001-00000009, 0001-00000015%borrador%'::text, 'el mensaje de borradores lista todas las facturas en borrador');
reset role;

-- Los rechazos pasan antes de cualquier lock sobre las facturas: el Operador sin permiso no deja filas bloqueadas (no hay
-- locks pendientes de otra sesión; el orden envíos → facturas queda en la RPC y se cubre con la revisión de código).
-- ============================================================================
-- Menores del QA (2026-11-12)
-- ============================================================================

-- Fixture: F16 ya Cobrado (pagada en mostrador, sin cobros en el libro) con la forma que genera deuda; F17 confirmada con esa forma;
-- F18 confirmada cubierta entera por una nota (saldo 0) y con un envío con abono; F19 borrador con envío de abono 0.
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, confirmado_en, envio_id, forma_pago_id)
values
  ('f1000000-0000-0000-0000-000000000016', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000016', current_date - 16, 'cobrado',   1000, 1000, now(), 'b1000000-0000-0000-0000-00000000000a', '9a000000-0000-0000-0000-00000000000e'),
  ('f1000000-0000-0000-0000-000000000017', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000017', current_date - 17, 'confirmada', 1000, 1000, now(), 'b1000000-0000-0000-0000-00000000000a', '9a000000-0000-0000-0000-00000000000e'),
  ('f1000000-0000-0000-0000-000000000018', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000018', current_date - 18, 'confirmada', 1000, 1000, now(), 'b1000000-0000-0000-0000-00000000000a', null),
  ('f1000000-0000-0000-0000-000000000019', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000019', current_date - 19, 'borrador',     500,  500, null,  'b1000000-0000-0000-0000-00000000000a', null);
select pg_temp.nota(pg_temp.f(18), '0003-00000018', 1000);
insert into dominio.envios_moto (id, organizacion_id, comprobante_id, mensajero, costo_envio, abono, enviado) values
  ('e1000000-0000-0000-0000-000000000016', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000016', 'Mara', 10, 100, true),
  ('e1000000-0000-0000-0000-000000000017', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000017', 'Nico', 10, 400, true),
  ('e1000000-0000-0000-0000-000000000018', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000018', 'Olga', 10, 100, true),
  ('e1000000-0000-0000-0000-000000000019', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000019', 'Pablo', 10,   0, true);

-- (c) La forma «Contrarreembolso» elegida es la ACTIVA de la tienda, no la inactiva que ordena antes.
select is(
  (select forma_pago_id from dominio.cobros_comprobante where comprobante_id = pg_temp.f(1)),
  '9a000000-0000-0000-0000-00000000000b'::uuid, 'el cobro de la tienda usa la «Contrarreembolso» activa, no la inactiva');

-- Item 1: factura ya Cobrada (sin cobros en el libro): se rinde sin cobro y el estado queda intacto, aunque la forma genere deuda.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select set_config('t.res', public.rendir_envios_moto(array[pg_temp.e(16)])::text, true);
reset role;
select is((current_setting('t.res')::jsonb ->> 'cantidad')::int, 1, 'rinde el envío de la factura ya Cobrada');
select is((current_setting('t.res')::jsonb ->> 'sin_cobro')::int, 1, 'y lo cuenta como sin cobro');
select is((current_setting('t.res')::jsonb ->> 'total_cobrado')::numeric, 0::numeric, 'sin nada cobrado en el libro');
select is((select count(*)::int from dominio.cobros_comprobante where comprobante_id = pg_temp.f(16)), 0, 'no registra cobro sobre una factura Cobrada');
select is(pg_temp.estado(pg_temp.f(16)), 'cobrado', 'y el estado sigue Cobrado (no retrocede a Deuda)');
select ok((select rendido and cobro_id is null from dominio.envios_moto where id = pg_temp.e(16)), 'el envío queda rendido sin cobro');

-- (e) Rendición parcial con una forma que genera deuda: la factura queda en Deuda.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select set_config('t.res', public.rendir_envios_moto(array[pg_temp.e(17)])::text, true);
reset role;
select is((current_setting('t.res')::jsonb ->> 'total_cobrado')::numeric, 400::numeric, 'cobra el abono parcial (400)');
select is(
  (select forma_pago_id from dominio.cobros_comprobante where comprobante_id = pg_temp.f(17)),
  '9a000000-0000-0000-0000-00000000000e'::uuid, 'con la forma de pago de la factura');
select is(pg_temp.estado(pg_temp.f(17)), 'deuda', 'con una forma que genera deuda y saldo pendiente la factura queda en Deuda');

-- (d) Saldo 0 con abono > 0 (nota que cubre toda la factura): se rinde sin cobro.
select is(pg_temp.saldo(pg_temp.f(18)), 0::numeric, 'la factura F18 no tiene saldo');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select set_config('t.res', public.rendir_envios_moto(array[pg_temp.e(18)])::text, true);
reset role;
select is((current_setting('t.res')::jsonb ->> 'sin_cobro')::int, 1, 'abono > 0 con saldo 0: se rinde y cuenta como sin cobro');
select is((select count(*)::int from dominio.cobros_comprobante where comprobante_id = pg_temp.f(18)), 0, 'sin cobro en el libro');
select is(pg_temp.estado(pg_temp.f(18)), 'confirmada', 'y el estado no cambia');

-- Item 3 y (b): borrador. El listado marca «Confirmá la factura antes de rendir» solo con abono > 0 y el envío sigue editable.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select ok(
  (select not puede_rendir and puede_editar and bloqueado_motivo = 'Confirmá la factura antes de rendir'
     from public.listar_envios_moto() where comprobante_id = pg_temp.f(9)),
  'borrador con abono: no se puede rendir, sí editar y el motivo pide confirmar la factura');
select ok(
  (select puede_rendir and puede_editar and bloqueado_motivo is null
     from public.listar_envios_moto() where comprobante_id = pg_temp.f(19)),
  'borrador con abono 0: sigue rendible y sin motivo');
reset role;

-- (b) Editar el envío de un borrador funciona.
select pg_temp.como('d1000000-0000-0000-0000-000000000012');
select lives_ok(
  format($$select public.actualizar_envio_moto(%L, 'Gabi', 'G-1', 10, 100, true, %L)$$,
    pg_temp.e(9), (select updated_at from dominio.envios_moto where id = pg_temp.e(9))),
  'editar el envío de una factura en borrador funciona');
reset role;

-- (b) Rendir un borrador con abono 0 funciona.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(format($$select public.rendir_envios_moto(array[%L]::uuid[])$$, pg_temp.e(19)), 'rendir un borrador con abono 0 funciona');
reset role;
select is((select count(*)::int from dominio.cobros_comprobante where comprobante_id = pg_temp.f(19)), 0, 'y no registra cobro');

-- (b) Confirmar la factura deja el envío rendible y rendir cobra.
update dominio.comprobantes_venta set estado = 'confirmada', confirmado_en = now() where id = pg_temp.f(9);
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select ok(
  (select puede_rendir and bloqueado_motivo is null from public.listar_envios_moto() where comprobante_id = pg_temp.f(9)),
  'al confirmar la factura el envío queda rendible y sin motivo');
select lives_ok(format($$select public.rendir_envios_moto(array[%L]::uuid[])$$, pg_temp.e(9)), 'y se rinde');
reset role;
select is((select importe from dominio.cobros_comprobante where comprobante_id = pg_temp.f(9)), 100::numeric, 'cobrando el abono en el libro');

-- (a) Un envío YA RENDIDO de una factura anulada después: ni editable ni rendible y SIN motivo de bloqueo.
update dominio.comprobantes_venta set estado = 'anulada' where id = pg_temp.f(8);
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select ok(
  (select not puede_editar and not puede_rendir and bloqueado_motivo is null
     from public.listar_envios_moto() where comprobante_id = pg_temp.f(8)),
  'rendido con la factura anulada después: ni editable ni rendible y sin motivo de bloqueo');
reset role;

select * from finish();
rollback;
