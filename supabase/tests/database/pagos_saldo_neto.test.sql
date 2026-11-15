-- MSF-450 (decisión 8, 2026-11-12): las pantallas Pagos usan el MISMO saldo neto que la cuenta corriente:
-- saldo = round(max(total − cobrado − notas de crédito, 0), 2), con las notas que cuentan según
-- `private.comprobante_cuenta_como_facturado` (ni borrador ni anulada). Cubre `public.listar_pagos` (columna `saldo` y
-- «Solo con saldo») y `public.resumen_pagos` (`saldo_pendiente`): nota parcial, nota que cubre todo, nota en borrador o
-- anulada que no resta, nota mayor al saldo (sin saldo a favor), aislamiento por tienda y por organización, y que el
-- resultado coincide con `public.saldo_comprobante`. Fechas relativas (current_date - n).
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000002', 'administracion-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000006', 'consulta-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'administracion', 'activo'),
  ('d1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('d1000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'consulta');

insert into clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 20, 'Cliente Dos', 'minorista');

insert into dominio.formas_pago (id, organizacion_id, empresa_id, nombre, tipo, exige_cuenta_cobro, genera_deuda, activo) values
  ('b1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Transferencia', 'transferencia', true, false, true),
  ('b1000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'Transferencia', 'transferencia', true, false, true),
  ('b2000000-0000-0000-0000-00000000000e', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-00000000000c', 'Transferencia', 'transferencia', true, false, true);

insert into dominio.cuentas_cobro (id, organizacion_id, nombre, titular, banco, activa) values
  ('e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Banco Uno', 'Titular Uno', 'Galicia', true),
  ('e2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Banco Dos', 'Titular Tres', 'BBVA', true);

insert into dominio.cuentas_cobro_empresas (cuenta_id, empresa_id, organizacion_id) values
  ('e1000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111'),
  ('e1000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111'),
  ('e2000000-0000-0000-0000-00000000000c', 'a2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222');

-- Facturas de 1.000: F1 con nota de 300; F2 con nota de 600; F3 con una nota en borrador y otra anulada (no restan);
-- F4 con una nota de 900 (mayor al saldo: sin saldo a favor); F5 de OTRA tienda (Mundo JC) con nota de 300;
-- F6 de otra organización con una nota que la cubre.
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, confirmado_en) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000001', current_date - 10, 'confirmada', 1000, 1000, now()),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000002', current_date - 10, 'confirmada', 1000, 1000, now()),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000003', current_date - 10, 'confirmada', 1000, 1000, now()),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000004', current_date - 10, 'confirmada', 1000, 1000, now()),
  ('f1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000005', current_date - 10, 'confirmada', 1000, 1000, now()),
  ('f2000000-0000-0000-0000-000000000006', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-00000000000c', 'c2000000-0000-0000-0000-000000000001', 'factura', '0001-00000006', current_date - 10, 'confirmada', 1000, 1000, now());

insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, comprobante_origen_id, nc_tipo) values
  ('f1100000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'nota_credito', '0001-00000101', current_date - 2, 'emitida', 300, 300, 'f1000000-0000-0000-0000-000000000001', 'devolucion_importe'),
  ('f1100000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'nota_credito', '0001-00000102', current_date - 2, 'emitida', 600, 600, 'f1000000-0000-0000-0000-000000000002', 'devolucion_importe'),
  ('f1100000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'nota_credito', '0001-00000103', current_date - 2, 'borrador', 500, 500, 'f1000000-0000-0000-0000-000000000003', 'devolucion_importe'),
  ('f1100000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'nota_credito', '0001-00000104', current_date - 2, 'anulada', 500, 500, 'f1000000-0000-0000-0000-000000000003', 'devolucion_importe'),
  ('f1100000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'nota_credito', '0001-00000105', current_date - 2, 'emitida', 900, 900, 'f1000000-0000-0000-0000-000000000004', 'devolucion_importe'),
  ('f1100000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-000000000001', 'nota_credito', '0001-00000106', current_date - 2, 'emitida', 300, 300, 'f1000000-0000-0000-0000-000000000005', 'devolucion_importe'),
  ('f2100000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-00000000000c', 'c2000000-0000-0000-0000-000000000001', 'nota_credito', '0001-00000107', current_date - 2, 'emitida', 1000, 1000, 'f2000000-0000-0000-0000-000000000006', 'devolucion_importe');

insert into dominio.cobros_comprobante
  (id, organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, cuenta_cobro_id, origen,
   registrado_por, registrado_por_nombre, registrado_en, actualizado_en) values
  ('b1000000-0000-0000-0000-000000000101', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000001', 400, 'b1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'manual', 'd1000000-0000-0000-0000-000000000002', 'Administración', now() - interval '1 days', now() - interval '1 days'),
  ('b1000000-0000-0000-0000-000000000102', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000002', 400, 'b1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'manual', 'd1000000-0000-0000-0000-000000000002', 'Administración', now() - interval '2 days', now() - interval '2 days'),
  ('b1000000-0000-0000-0000-000000000103', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000003', 400, 'b1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'manual', 'd1000000-0000-0000-0000-000000000002', 'Administración', now() - interval '3 days', now() - interval '3 days'),
  ('b1000000-0000-0000-0000-000000000104', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000004', 400, 'b1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'manual', 'd1000000-0000-0000-0000-000000000002', 'Administración', now() - interval '4 days', now() - interval '4 days'),
  ('b1000000-0000-0000-0000-000000000105', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'f1000000-0000-0000-0000-000000000005', 400, 'b1000000-0000-0000-0000-00000000000c', 'e1000000-0000-0000-0000-00000000000a', 'manual', 'd1000000-0000-0000-0000-000000000002', 'Administración', now() - interval '5 days', now() - interval '5 days'),
  ('b2000000-0000-0000-0000-000000000106', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-00000000000c', 'f2000000-0000-0000-0000-000000000006', 100, 'b2000000-0000-0000-0000-00000000000e', 'e2000000-0000-0000-0000-00000000000c', 'manual', 'd2000000-0000-0000-0000-000000000001', 'Admin Dos', now() - interval '6 days', now() - interval '6 days');

-- Extras: F7 con una nota de OTRO cliente (no resta) y una nota de la tienda NO accesible Mundo JC (no resta);
-- F8 anulada con cobro; F9 confirmada SIN cobros; F10 en borrador con cobro.
insert into clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 11, 'Cliente Otro', 'minorista');

insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, confirmado_en) values
  ('f1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000008', current_date - 10, 'confirmada', 1000, 1000, now()),
  ('f1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000009', current_date - 10, 'anulada', 1000, 1000, now()),
  ('f1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000010', current_date - 10, 'confirmada', 1000, 1000, now()),
  ('f1000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000011', current_date - 10, 'borrador', 1000, 1000, null);

insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, comprobante_origen_id, nc_tipo) values
  ('f1100000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000002', 'nota_credito', '0001-00000111', current_date - 2, 'emitida', 200, 200, 'f1000000-0000-0000-0000-000000000007', 'devolucion_importe'),
  ('f1100000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-000000000001', 'nota_credito', '0001-00000112', current_date - 2, 'emitida', 150, 150, 'f1000000-0000-0000-0000-000000000007', 'devolucion_importe');

insert into dominio.cobros_comprobante
  (id, organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, cuenta_cobro_id, origen,
   registrado_por, registrado_por_nombre, registrado_en, actualizado_en) values
  ('b1000000-0000-0000-0000-000000000107', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000007', 400, 'b1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'manual', 'd1000000-0000-0000-0000-000000000002', 'Administración', now() - interval '7 days', now() - interval '7 days'),
  ('b1000000-0000-0000-0000-000000000108', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000008', 400, 'b1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'manual', 'd1000000-0000-0000-0000-000000000002', 'Administración', now() - interval '8 days', now() - interval '8 days'),
  ('b1000000-0000-0000-0000-000000000110', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000010', 400, 'b1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'manual', 'd1000000-0000-0000-0000-000000000002', 'Administración', now() - interval '9 days', now() - interval '9 days');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Administración de San Javucho (F1 a F4)
-- ============================================================================
select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select is((select saldo from public.listar_pagos() where comprobante_id = 'f1000000-0000-0000-0000-000000000001'), 300::numeric,
  'listar_pagos: factura 1000, cobro 400 y nota 300 -> saldo 300');
select is((select saldo from public.listar_pagos() where comprobante_id = 'f1000000-0000-0000-0000-000000000002'), 0::numeric,
  'listar_pagos: nota 600 que cubre lo que falta -> saldo 0');
select is((select saldo from public.listar_pagos() where comprobante_id = 'f1000000-0000-0000-0000-000000000003'), 600::numeric,
  'listar_pagos: una nota en borrador y otra anulada NO restan -> saldo 600');
select is((select saldo from public.listar_pagos() where comprobante_id = 'f1000000-0000-0000-0000-000000000004'), 0::numeric,
  'listar_pagos: una nota mayor al saldo deja 0 (no hay saldo a favor)');
select is((select count(*)::int from public.listar_pagos(null, null, false, 1, 50)), 7,
  'sin filtro: los 7 pagos de la tienda (F1 a F4, F7, la anulada F8 y la borrador F10)');
select is((select array_agg(comprobante_id order by numero) from public.listar_pagos(null, null, true, 1, 50)),
  array['f1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000007']::uuid[],
  '«Solo con saldo» incluye las de saldo 300, 600 y 600 (F7), y NO las de saldo 0 ni la anulada F8 ni la borrador F10');
select is((select filas from public.listar_pagos(null, null, true, 1, 50) limit 1), 3::bigint,
  '«Solo con saldo»: el total de filas del servidor es 3');
-- Paginación de «Solo con saldo» (3 filas): página 2 de tamaño 2 trae la 3.ª fila y `filas` sigue siendo 3.
select is((select count(*)::int from public.listar_pagos(null, null, true, 2, 2)), 1,
  '«Solo con saldo» página 2 (tamaño 2): una fila');
select is((select filas from public.listar_pagos(null, null, true, 2, 2) limit 1), 3::bigint,
  '«Solo con saldo» página 2: `filas` es el total del filtro (3)');
select is((select count(*)::int from public.listar_pagos(null, null, true, 3, 2)), 0,
  '«Solo con saldo» página 3: sin filas');
-- Estado de la factura: la anulada (F8) y la borrador (F10) con cobro se listan pero con saldo 0.
select is((select saldo from public.listar_pagos() where comprobante_id = 'f1000000-0000-0000-0000-000000000008'), 0::numeric,
  'factura anulada con cobro: saldo 0');
select is((select saldo from public.listar_pagos() where comprobante_id = 'f1000000-0000-0000-0000-000000000010'), 0::numeric,
  'factura en borrador con cobro: saldo 0');
select is((select count(*)::int from public.listar_pagos(null, null, true, 1, 50)
            where comprobante_id in ('f1000000-0000-0000-0000-000000000008', 'f1000000-0000-0000-0000-000000000010')), 0,
  'la anulada y la borrador NO entran en «Solo con saldo»');
-- F7: la nota de OTRO cliente (200) y la de la tienda NO accesible (150) no restan: 1000 - 400 = 600.
select is((select saldo from public.listar_pagos() where comprobante_id = 'f1000000-0000-0000-0000-000000000007'), 600::numeric,
  'una nota de otro cliente y una de una tienda no accesible NO restan');
-- resumen_pagos: 300 + 0 + 600 + 0 + 600 (F7); la anulada F8 no cuenta y F9 (sin cobros) no entra.
select is((select saldo_pendiente from public.resumen_pagos()), 1500::numeric,
  'resumen_pagos: 300 + 0 + 600 + 0 + 600; la anulada y la factura sin cobros no cuentan');
select is((select count(*)::int from public.listar_pagos() where comprobante_id = 'f1000000-0000-0000-0000-000000000009'), 0,
  'una factura sin cobros no aparece en Pagos');
select is((select saldo from public.listar_pagos() where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
          (select saldo from public.saldo_comprobante('f1000000-0000-0000-0000-000000000001')),
  'Pagos y el detalle del comprobante muestran el mismo saldo (F1)');
select is((select saldo from public.listar_pagos() where comprobante_id = 'f1000000-0000-0000-0000-000000000003'),
          (select saldo from public.saldo_comprobante('f1000000-0000-0000-0000-000000000003')),
  'Pagos y el detalle del comprobante muestran el mismo saldo (F3)');
select is((select min(saldo) from public.listar_pagos(null, null, false, 1, 50)) >= 0, true,
  'ningún saldo es negativo (sin saldo a favor)');

-- Aislamiento por tienda: Mundo JC no es accesible para Administración de San Javucho.
select is((select count(*)::int from public.listar_pagos('a1000000-0000-0000-0000-00000000000b', null, false, 1, 50)), 0,
  'una tienda ajena devuelve cero filas');
select is((select saldo_pendiente from public.resumen_pagos('a1000000-0000-0000-0000-00000000000b')), 0::numeric,
  'una tienda ajena no suma saldo');

-- ============================================================================
-- Consulta de Mundo JC (F5)
-- ============================================================================
select pg_temp.como('d1000000-0000-0000-0000-000000000006');

select is((select saldo from public.listar_pagos() where comprobante_id = 'f1000000-0000-0000-0000-000000000005'), 300::numeric,
  'Mundo JC: factura 1000, cobro 400 y nota 300 -> saldo 300');
select is((select count(*)::int from public.listar_pagos(null, null, true, 1, 50)), 1,
  'Mundo JC: «Solo con saldo» incluye solo su pago');
select is((select saldo_pendiente from public.resumen_pagos()), 300::numeric,
  'Mundo JC: el saldo pendiente no suma las facturas de San Javucho');

-- ============================================================================
-- Otra organización (F6, cubierta por su nota)
-- ============================================================================
select pg_temp.como('d2000000-0000-0000-0000-000000000001');

select is((select count(*)::int from public.listar_pagos(null, null, false, 1, 50)), 1,
  'otra organización: ve solo su pago');
select is((select saldo from public.listar_pagos()), 0::numeric,
  'otra organización: cobro 100 + nota 1000 sobre factura 1000 -> saldo 0');
select is((select count(*)::int from public.listar_pagos(null, null, true, 1, 50)), 0,
  'otra organización: «Solo con saldo» no la incluye');
select is((select saldo_pendiente from public.resumen_pagos()), 0::numeric,
  'otra organización: saldo pendiente 0');

select * from finish();

rollback;
