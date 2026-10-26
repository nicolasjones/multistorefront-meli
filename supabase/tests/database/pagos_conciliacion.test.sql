-- F-VTA-13 (MSF-401, épica MSF-195, spec 20261024-150000-ventas-cobros-y-conciliacion,
-- FR-020, FR-021, FR-022, FR-023, FR-024, SC-003): conciliación de pagos por cuenta de cobro.
--
-- Cubre:
-- · La acción `conciliar_pago` en la matriz de permisos (Administración y Administrador sí;
--   Mostrador, Operador, Depósito y Consulta no) y el permiso por EMPRESA del pago (FR-020).
-- · `public.conciliar_pago` y `public.revertir_conciliacion_pago`: idempotentes, con bloqueo
--   optimista, solo con cobros que tienen cuenta de cobro, con evento de actividad y SIN tocar
--   el estado del comprobante ni el saldo (FR-021, FR-022).
-- · `public.listar_pagos`: solo pagos con cuenta de cobro, filtros por empresa y por cuenta,
--   «Solo con saldo», paginación y `filas` en el servidor, y las columnas de la pantalla
--   (FR-023).
-- · `public.resumen_pagos` y `public.cuentas_cobro_mas_usadas`: los totales de las tarjetas y
--   las cuentas más usadas (FR-024).
-- · El aislamiento entre organizaciones y entre tiendas, y los privilegios: `anon` no ejecuta
--   nada, `authenticated` sí, y las funciones internas no las ejecuta ni `service_role`.
-- · `public.puede_conciliar_pago`: la lectura del permiso por empresa que la pantalla usa para
--   habilitar (o no) el interruptor «Cobrado» de cada fila (FR-026).
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
  ('d1000000-0000-0000-0000-000000000002', 'administracion-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'mostrador-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000004', 'operador-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000005', 'deposito-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000006', 'consulta-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

-- Perfil de Administración: la conciliación guarda una foto del nombre (no el id).
insert into perfiles_usuario (user_id, nombre, apellido) values
  ('d1000000-0000-0000-0000-000000000002', 'Rita', 'Ramírez');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'administracion', 'activo'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'mostrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('d1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo'),
  ('d1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- Administración, Mostrador, Operador y Depósito trabajan en San Javucho; Consulta, solo en
-- Mundo JC (para probar el aislamiento entre tiendas de la misma organización).
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('d1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'mostrador'),
  ('d1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('d1000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'consulta');

insert into clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 20, 'Cliente Dos', 'minorista');

-- Formas de pago: transferencia (exige cuenta de cobro) y efectivo (no).
insert into dominio.formas_pago (id, organizacion_id, empresa_id, nombre, tipo, exige_cuenta_cobro, genera_deuda, activo) values
  ('b1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Transferencia', 'transferencia', true, false, true),
  ('b1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Efectivo', 'efectivo', false, false, true),
  ('b1000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'Transferencia', 'transferencia', true, false, true),
  ('b2000000-0000-0000-0000-00000000000e', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-00000000000c', 'Transferencia', 'transferencia', true, false, true);

-- Cuentas de cobro: dos de San Javucho (una se marca «No usar» después de su pago), una de Mundo
-- JC y una de la otra organización.
insert into dominio.cuentas_cobro (id, organizacion_id, nombre, titular, banco, activa) values
  ('e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Banco Uno', 'Titular Uno', 'Galicia', true),
  ('e1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Banco No usar', 'Titular Dos', 'Santander', true),
  ('e1000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Banco Mundo', 'Titular Cuatro', 'HSBC', true),
  ('e2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Banco Dos', 'Titular Tres', 'BBVA', true);

insert into dominio.cuentas_cobro_empresas (cuenta_id, empresa_id, organizacion_id) values
  ('e1000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111'),
  ('e1000000-0000-0000-0000-00000000000b', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111'),
  ('e1000000-0000-0000-0000-00000000000c', 'a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111'),
  ('e2000000-0000-0000-0000-00000000000c', 'a2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222');

-- Comprobantes: F1 y F2 confirmadas de 1.000, F3 de 500, F4 de otra tienda, F5 anulada,
-- F6 en borrador y F7 de la otra organización.
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, confirmado_en) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000001', '2026-12-01', 'confirmada', 1000, 1000, now()),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000002', '2026-12-01', 'confirmada', 1000, 1000, now()),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000003', '2026-12-01', 'confirmada', 500, 500, now()),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000004', '2026-12-01', 'confirmada', 1000, 1000, now()),
  ('f1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000005', '2026-12-01', 'anulada', 1000, 1000, now()),
  ('f1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000006', '2026-12-01', 'borrador', 1000, 1000, null),
  ('f1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000007', '2026-12-01', 'confirmada', 1000, 1000, now()),
  ('f2000000-0000-0000-0000-000000000007', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-00000000000c', 'c2000000-0000-0000-0000-000000000001', 'factura', '0001-00000007', '2026-12-01', 'confirmada', 1000, 1000, now());

-- El libro de cobros (F-VTA-12). Cada pago tiene su versión (`actualizado_en`) para el bloqueo
-- optimista. P1 es de San Javucho con «Banco Uno», P2 tapa la factura, P3 usa la cuenta que
-- después se marca «No usar», P4 es de Mundo JC, P5 es de una factura anulada, P6 de una en
-- borrador, P7 es en efectivo (sin cuenta: no hay nada que conciliar) y P8 es de la otra
-- organización.
insert into dominio.cobros_comprobante
  (id, organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, cuenta_cobro_id, origen,
   registrado_por, registrado_por_nombre, registrado_en, actualizado_en) values
  ('b1000000-0000-0000-0000-000000000101', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000001', 400, 'b1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'manual', 'd1000000-0000-0000-0000-000000000003', 'Mostrador Uno', '2026-12-01 10:00:00+00', '2026-12-01 10:00:00+00'),
  ('b1000000-0000-0000-0000-000000000102', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000002', 1000, 'b1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'manual', 'd1000000-0000-0000-0000-000000000003', 'Mostrador Uno', '2026-12-02 10:00:00+00', '2026-12-02 10:00:00+00'),
  ('b1000000-0000-0000-0000-000000000103', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000003', 200, 'b1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000b', 'manual', 'd1000000-0000-0000-0000-000000000003', 'Mostrador Uno', '2026-12-03 10:00:00+00', '2026-12-03 10:00:00+00'),
  ('b1000000-0000-0000-0000-000000000104', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'f1000000-0000-0000-0000-000000000004', 300, 'b1000000-0000-0000-0000-00000000000c', 'e1000000-0000-0000-0000-00000000000c', 'manual', 'd1000000-0000-0000-0000-000000000003', 'Mostrador Uno', '2026-12-04 10:00:00+00', '2026-12-04 10:00:00+00'),
  ('b1000000-0000-0000-0000-000000000105', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000005', 100, 'b1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'manual', 'd1000000-0000-0000-0000-000000000003', 'Mostrador Uno', '2026-12-05 10:00:00+00', '2026-12-05 10:00:00+00'),
  ('b1000000-0000-0000-0000-000000000106', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000006', 100, 'b1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'manual', 'd1000000-0000-0000-0000-000000000003', 'Mostrador Uno', '2026-12-06 10:00:00+00', '2026-12-06 10:00:00+00'),
  ('b1000000-0000-0000-0000-000000000107', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000007', 100, 'b1000000-0000-0000-0000-00000000000b', null, 'manual', 'd1000000-0000-0000-0000-000000000003', 'Mostrador Uno', '2026-12-07 10:00:00+00', '2026-12-07 10:00:00+00'),
  ('b2000000-0000-0000-0000-000000000108', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-00000000000c', 'f2000000-0000-0000-0000-000000000007', 700, 'b2000000-0000-0000-0000-00000000000e', 'e2000000-0000-0000-0000-00000000000c', 'manual', 'd2000000-0000-0000-0000-000000000001', 'Admin Dos', '2026-12-08 10:00:00+00', '2026-12-08 10:00:00+00');

-- La cuenta de P3 se marca «No usar» DESPUÉS de su pago: conserva el historial y la tarjeta
-- de cuentas la muestra con esa marca.
update dominio.cuentas_cobro set activa = false
 where id = 'e1000000-0000-0000-0000-00000000000b';

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- La acción `conciliar_pago` y los privilegios (FR-020)
-- ============================================================================

-- La acción queda sembrada en la matriz de permisos: Administración y Administrador sí; los
-- demás roles, no (aunque tengan Ventas en edición).
select is(
  (select permitido from public.permisos_rol_accion
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'administracion'
      and seccion = 'ventas' and accion = 'conciliar_pago'),
  true, 'la acción conciliar_pago está sembrada para Administración'
);
select is(
  (select permitido from public.permisos_rol_accion
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'administrador'
      and seccion = 'ventas' and accion = 'conciliar_pago'),
  true, 'la acción conciliar_pago está sembrada para Administrador'
);
select is(
  (select permitido from public.permisos_rol_accion
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'mostrador'
      and seccion = 'ventas' and accion = 'conciliar_pago'),
  false, 'Mostrador no tiene la acción conciliar_pago'
);
select is(
  (select permitido from public.permisos_rol_accion
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'operador'
      and seccion = 'ventas' and accion = 'conciliar_pago'),
  false, 'Operador no tiene la acción conciliar_pago (aunque Ventas esté en edición)'
);
select is(
  (select permitido from public.permisos_rol_accion
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'deposito'
      and seccion = 'ventas' and accion = 'conciliar_pago'),
  false, 'Depósito no tiene la acción conciliar_pago'
);
select is(
  (select count(*)::int from public.permisos_rol_accion
    where accion = 'conciliar_pago' and seccion <> 'ventas'),
  0, 'la acción conciliar_pago existe solo en Ventas'
);
select is(
  (select count(*)::int from public.permisos_rol_accion
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and accion = 'conciliar_pago'),
  8, 'la acción conciliar_pago se siembra para los 8 roles de Ventas (2 con permiso)'
);
select is(
  (select count(*)::int from public.permisos_rol_accion
    where organizacion_id = '11111111-1111-1111-1111-111111111111'
      and accion = 'conciliar_pago' and permitido),
  2, 'solo Administración y Administrador quedan con la acción permitida'
);

-- `anon` no ejecuta ninguna de las cinco RPC de la historia; `authenticated` sí.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('conciliar_pago', 'revertir_conciliacion_pago', 'listar_pagos', 'resumen_pagos', 'cuentas_cobro_mas_usadas')
      and has_function_privilege('anon', p.oid, 'execute')),
  0, 'anon no ejecuta las RPC de conciliación'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('conciliar_pago', 'revertir_conciliacion_pago', 'listar_pagos', 'resumen_pagos', 'cuentas_cobro_mas_usadas')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  5, 'authenticated ejecuta las RPC de conciliación'
);

-- Las funciones internas no las ejecuta nadie desde el navegador: su permiso vive en las RPC
-- públicas.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('aplicar_conciliacion', 'puede_conciliar_pago_en_empresa')
      and (has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute'))),
  0, 'las funciones internas de conciliación no las ejecuta ni anon ni authenticated'
);
select ok(
  not has_function_privilege('service_role', 'private.aplicar_conciliacion(uuid,timestamptz,boolean)', 'execute'),
  'service_role no ejecuta la función interna de conciliación'
);
select ok(
  not has_function_privilege('service_role', 'private.puede_conciliar_pago_en_empresa(uuid)', 'execute'),
  'service_role no ejecuta el permiso interno de conciliación'
);

-- ============================================================================
-- La lectura del permiso para la pantalla (FR-026): `public.puede_conciliar_pago`
-- ============================================================================

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'puede_conciliar_pago'
      and has_function_privilege('anon', p.oid, 'execute')),
  0, 'anon no ejecuta la RPC de permiso de conciliación'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'puede_conciliar_pago'
      and has_function_privilege('authenticated', p.oid, 'execute')),
  1, 'authenticated ejecuta la RPC de permiso de conciliación'
);

-- Administración concilia en su tienda y no en las demás.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(
  public.puede_conciliar_pago('a1000000-0000-0000-0000-00000000000a'),
  true, 'Administración puede conciliar pagos en su tienda'
);
select is(
  public.puede_conciliar_pago('a1000000-0000-0000-0000-00000000000b'),
  false, 'Administración no concilia en una tienda donde no tiene el rol'
);
reset role;

-- El Administrador de la organización (admin global, sin fila en `usuarios_empresas`) concilia en
-- cualquier tienda de su organización: `rol_en_empresa` le devuelve 'administrador'.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  public.puede_conciliar_pago('a1000000-0000-0000-0000-00000000000a'),
  true, 'el Administrador global puede conciliar pagos en una tienda de su organización'
);
select is(
  public.puede_conciliar_pago('a1000000-0000-0000-0000-00000000000b'),
  true, 'el Administrador global puede conciliar pagos en otra tienda de su organización'
);
reset role;

-- Mostrador: Ventas en edición pero SIN la acción conciliar_pago.
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is(
  public.puede_conciliar_pago('a1000000-0000-0000-0000-00000000000a'),
  false, 'sin la acción conciliar_pago la pantalla no habilita el interruptor'
);
reset role;

-- Operador: Ventas en edición, tampoco concilia.
select pg_temp.como('d1000000-0000-0000-0000-000000000004');
select is(
  public.puede_conciliar_pago('a1000000-0000-0000-0000-00000000000a'),
  false, 'Operador no puede conciliar pagos'
);
reset role;

-- Depósito: Ventas en lectura, tampoco concilia.
select pg_temp.como('d1000000-0000-0000-0000-000000000005');
select is(
  public.puede_conciliar_pago('a1000000-0000-0000-0000-00000000000a'),
  false, 'Depósito no puede conciliar pagos'
);
reset role;

-- Otra organización: una tienda ajena no habilita la conciliación.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(
  public.puede_conciliar_pago('a1000000-0000-0000-0000-00000000000a'),
  false, 'una tienda de otra organización no habilita la conciliación'
);
reset role;

-- ============================================================================
-- Totales y cuentas ANTES de conciliar (FR-024): las tarjetas de la pantalla
-- ============================================================================

-- El Administrador de la organización ve las dos tiendas.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is(
  (select por_conciliar_importe from public.resumen_pagos()),
  2100.00::numeric, 'por conciliar: 400 + 1000 + 200 + 300 + 100 + 100 de las dos tiendas'
);
select is(
  (select por_conciliar_cantidad from public.resumen_pagos()),
  6::bigint, 'por conciliar: seis pagos con cuenta de cobro'
);
select is(
  (select conciliado_importe from public.resumen_pagos()),
  0.00::numeric, 'conciliado: nada todavía'
);
select is(
  (select conciliado_cantidad from public.resumen_pagos()),
  0::bigint, 'conciliado: ningún pago todavía'
);
select is(
  (select saldo_pendiente from public.resumen_pagos()),
  2500.00::numeric, 'saldo pendiente: 600 + 300 + 700 + 900 (las facturas anulada y en borrador no deben nada)'
);

-- El filtro por tienda: solo lo de San Javucho.
select is(
  (select por_conciliar_importe from public.resumen_pagos('a1000000-0000-0000-0000-00000000000a')),
  1800.00::numeric, 'por conciliar de San Javucho: 400 + 1000 + 200 + 100 + 100'
);
select is(
  (select por_conciliar_cantidad from public.resumen_pagos('a1000000-0000-0000-0000-00000000000a')),
  5::bigint, 'por conciliar de San Javucho: cinco pagos'
);
select is(
  (select saldo_pendiente from public.resumen_pagos('a1000000-0000-0000-0000-00000000000a')),
  1800.00::numeric, 'saldo pendiente de San Javucho: 600 + 300 + 900'
);

-- Las cuentas más usadas: primero las que más se usaron; las marcadas «No usar» también
-- aparecen (conservan su historial).
select is(
  (select count(*)::int from public.cuentas_cobro_mas_usadas()),
  3, 'las tres cuentas de la organización están en la tarjeta'
);
select is(
  (select total_cuentas from public.cuentas_cobro_mas_usadas()),
  3::bigint, 'el total de cuentas cargadas es 3'
);
select is(
  (select nombre from public.cuentas_cobro_mas_usadas() order by usos desc, nombre limit 1),
  'Banco Uno', 'la cuenta más usada es la primera'
);
select is(
  (select usos from public.cuentas_cobro_mas_usadas() order by usos desc, nombre limit 1),
  4::bigint, '«Banco Uno» tiene cuatro usos'
);
select is(
  (select activa from public.cuentas_cobro_mas_usadas()
    where id = 'e1000000-0000-0000-0000-00000000000b'),
  false, 'la cuenta marcada «No usar» aparece con esa marca'
);
select is(
  (select usos from public.cuentas_cobro_mas_usadas()
    where id = 'e1000000-0000-0000-0000-00000000000b'),
  1::bigint, 'la cuenta «No usar» conserva su historial de usos'
);
select is(
  (select count(*)::int from public.cuentas_cobro_mas_usadas('a1000000-0000-0000-0000-00000000000a')),
  2, 'con filtro de tienda solo salen las cuentas habilitadas en ella'
);
select is(
  (select count(*)::int from public.cuentas_cobro_mas_usadas(p_limite => 1)),
  1, 'el límite de la tarjeta se respeta'
);

reset role;

-- ============================================================================
-- El listado (FR-023)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- Solo pagos con cuenta de cobro: el cobro en efectivo (P7) no aparece.
select is(
  (select count(*)::int from public.listar_pagos()),
  6, 'el listado trae los seis pagos con cuenta de cobro (el efectivo no aparece)'
);
select is(
  (select count(*)::int from public.listar_pagos()
    where id = 'b1000000-0000-0000-0000-000000000107'),
  0, 'un cobro sin cuenta de cobro no se lista'
);

-- Las columnas de la pantalla.
select is(
  (select empresa from public.listar_pagos()
    where id = 'b1000000-0000-0000-0000-000000000104'),
  'Mundo JC', 'la columna Tienda trae el nombre de la empresa'
);
select is(
  (select numero from public.listar_pagos()
    where id = 'b1000000-0000-0000-0000-000000000101'),
  '0001-00000001', 'la columna Comprobante trae el número de la factura'
);
select is(
  (select cliente from public.listar_pagos()
    where id = 'b1000000-0000-0000-0000-000000000101'),
  'Cliente Uno', 'la columna Cliente trae el nombre del cliente'
);
select is(
  (select cuenta_cobro from public.listar_pagos()
    where id = 'b1000000-0000-0000-0000-000000000101'),
  'Banco Uno', 'la columna Cuenta de cobro trae el nombre de la cuenta'
);
select is(
  (select importe from public.listar_pagos()
    where id = 'b1000000-0000-0000-0000-000000000101'),
  400.00::numeric, 'la columna Importe trae el importe del pago'
);
select is(
  (select conciliado from public.listar_pagos()
    where id = 'b1000000-0000-0000-0000-000000000101'),
  false, 'la columna Conciliado empieza en falso'
);
select is_null(
  (select aprobado_por from public.listar_pagos()
    where id = 'b1000000-0000-0000-0000-000000000101'),
  'la columna Aprobado por está vacía mientras no se aprueba'
);
select is(
  (select saldo from public.listar_pagos()
    where id = 'b1000000-0000-0000-0000-000000000101'),
  600.00::numeric, 'la columna Saldo trae lo que le queda al cliente (1.000 − 400)'
);
select is(
  (select saldo from public.listar_pagos()
    where id = 'b1000000-0000-0000-0000-000000000102'),
  0.00::numeric, 'una factura totalmente cobrada tiene saldo 0'
);

-- Filtro por tienda.
select is(
  (select count(*)::int from public.listar_pagos('a1000000-0000-0000-0000-00000000000a')),
  5, 'el filtro de tienda deja solo los pagos de esa tienda'
);
select is(
  (select count(*)::int from public.listar_pagos('a1000000-0000-0000-0000-00000000000b')),
  1, 'la otra tienda tiene su propio pago'
);

-- Filtro por cuenta de cobro.
select is(
  (select count(*)::int from public.listar_pagos(p_cuenta_cobro_id => 'e1000000-0000-0000-0000-00000000000a')),
  4, 'el filtro por cuenta deja solo los pagos de esa cuenta'
);
select is(
  (select count(*)::int from public.listar_pagos(p_cuenta_cobro_id => 'e1000000-0000-0000-0000-00000000000b')),
  1, 'la cuenta «No usar» también se puede filtrar (conserva su historial)'
);

-- «Solo con saldo»: el comprobante del pago todavía debe saldo.
select is(
  (select count(*)::int from public.listar_pagos(p_solo_con_saldo => true)),
  5, '«Solo con saldo» deja los cinco pagos cuyo comprobante todavía debe'
);
select is(
  (select count(*)::int from public.listar_pagos(
    p_solo_con_saldo => true, p_empresa_id => 'a1000000-0000-0000-0000-00000000000a')),
  4, '«Solo con saldo» y el filtro de tienda se combinan'
);

-- Paginación en el servidor: el total del filtro viene en `filas`.
select is(
  (select filas from public.listar_pagos(p_pagina => 1, p_tamano => 2) limit 1),
  6::bigint, '`filas` trae el total del filtro actual'
);
select is(
  (select count(*)::int from public.listar_pagos(p_pagina => 1, p_tamano => 2)),
  2, 'la primera página trae dos pagos'
);
select is(
  (select id from public.listar_pagos(p_pagina => 1, p_tamano => 2) order by id limit 1),
  'b1000000-0000-0000-0000-000000000105', 'la primera página empieza por el pago más reciente'
);
select is(
  (select count(*)::int from public.listar_pagos(p_pagina => 3, p_tamano => 2)),
  2, 'la tercera página trae los dos pagos que quedan'
);
select is(
  (select count(*)::int from public.listar_pagos(p_pagina => 4, p_tamano => 2)),
  0, 'una página más allá del total no trae filas'
);
select is(
  (select filas from public.listar_pagos(p_cuenta_cobro_id => 'e1000000-0000-0000-0000-00000000000a', p_pagina => 1, p_tamano => 2) limit 1),
  4::bigint, '`filas` cuenta el total del filtro, no el de la página'
);

reset role;

-- ============================================================================
-- El permiso por rol para conciliar (FR-020)
-- ============================================================================

-- Administración concilia en su tienda.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select lives_ok(
  $$select public.conciliar_pago(
      'b1000000-0000-0000-0000-000000000101',
      (select actualizado_en from dominio.cobros_comprobante
        where id = 'b1000000-0000-0000-0000-000000000101'))$$,
  'Administración concilia un pago de su tienda'
);
reset role;

-- El Mostrador registra cobros pero no concilia (aunque Ventas esté en edición).
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.conciliar_pago(
      'b1000000-0000-0000-0000-000000000101',
      (select actualizado_en from dominio.cobros_comprobante
        where id = 'b1000000-0000-0000-0000-000000000101'))$$,
  '42501', null, 'Mostrador no puede conciliar pagos'
);
reset role;

-- El Operador tiene Ventas en edición, pero no la acción.
select pg_temp.como('d1000000-0000-0000-0000-000000000004');
select throws_ok(
  $$select public.conciliar_pago(
      'b1000000-0000-0000-0000-000000000101',
      (select actualizado_en from dominio.cobros_comprobante
        where id = 'b1000000-0000-0000-0000-000000000101'))$$,
  '42501', null, 'Operador no puede conciliar pagos'
);
reset role;

-- Depósito y Consulta: solo lectura.
select pg_temp.como('d1000000-0000-0000-0000-000000000005');
select throws_ok(
  $$select public.conciliar_pago(
      'b1000000-0000-0000-0000-000000000101',
      (select actualizado_en from dominio.cobros_comprobante
        where id = 'b1000000-0000-0000-0000-000000000101'))$$,
  '42501', null, 'Depósito no puede conciliar pagos'
);
select pg_temp.como('d1000000-0000-0000-0000-000000000006');
select throws_ok(
  $$select public.conciliar_pago(
      'b1000000-0000-0000-0000-000000000101',
      (select actualizado_en from dominio.cobros_comprobante
        where id = 'b1000000-0000-0000-0000-000000000101'))$$,
  '42501', null, 'Consulta no puede conciliar pagos'
);
reset role;

-- Otra organización: el pago no existe para ella.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.conciliar_pago('b1000000-0000-0000-0000-000000000101', '2026-12-01 10:00:00+00')$$,
  'P0002', null, 'otra organización no puede conciliar un pago ajeno'
);
reset role;

-- El permiso es el de la EMPRESA del pago: Administración no hereda el de otra tienda por ser
-- Administración en la suya.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.conciliar_pago(
      'b1000000-0000-0000-0000-000000000104',
      (select actualizado_en from dominio.cobros_comprobante
        where id = 'b1000000-0000-0000-0000-000000000104'))$$,
  '42501', null, 'Administración no concilia pagos de una tienda donde no tiene el rol'
);
reset role;

-- ============================================================================
-- Conciliar y revertir (FR-021, FR-022)
-- ============================================================================

-- La conciliación (la hizo Administración más arriba): guarda quién aprobó y cuándo.
select is(
  (select aprobado_por from dominio.cobros_comprobante
    where id = 'b1000000-0000-0000-0000-000000000101'),
  'd1000000-0000-0000-0000-000000000002'::uuid, 'la conciliación guarda quién aprobó'
);
select is(
  (select aprobado_por_nombre from dominio.cobros_comprobante
    where id = 'b1000000-0000-0000-0000-000000000101'),
  'Rita Ramírez', 'la conciliación guarda una foto del nombre de quien aprobó'
);
select ok(
  (select aprobado_en is not null from dominio.cobros_comprobante
    where id = 'b1000000-0000-0000-0000-000000000101'),
  'la conciliación guarda cuándo se aprobó'
);

-- Conciliar NO es cobrar: el estado del comprobante y el saldo quedan intactos.
select is(
  (select estado from dominio.comprobantes_venta
    where id = 'f1000000-0000-0000-0000-000000000001'),
  'confirmada', 'conciliar no cambia el estado del comprobante'
);
select is(
  (select saldo from public.saldo_comprobante('f1000000-0000-0000-0000-000000000001')),
  600.00::numeric, 'conciliar no cambia el saldo del comprobante'
);
select is(
  (select importe from dominio.cobros_comprobante
    where id = 'b1000000-0000-0000-0000-000000000101'),
  400.00::numeric, 'conciliar no cambia el importe del pago'
);

-- El evento (FR-022): actor, tienda, importe y cuenta por su nombre; sin datos bancarios.
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'pago.conciliado' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1, 'la conciliación deja un evento'
);
select is(
  (select actor_id from public.registro_actividad
    where tipo = 'pago.conciliado' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'd1000000-0000-0000-0000-000000000002'::uuid, 'el evento guarda quién concilió'
);
select is(
  (select empresa_id from public.registro_actividad
    where tipo = 'pago.conciliado' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'a1000000-0000-0000-0000-00000000000a'::uuid, 'el evento guarda la tienda del pago'
);
select ok(
  (select detalle like '%400%' and detalle like '%Banco Uno%'
     from public.registro_actividad
    where tipo = 'pago.conciliado' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'el evento nombra el importe y la cuenta de cobro'
);
select ok(
  not exists (
    select 1 from public.registro_actividad
     where tipo = 'pago.conciliado' and organizacion_id = '11111111-1111-1111-1111-111111111111'
       and (detalle ~ '[0-9]{11}' or detalle like '%CBU%' or detalle like '%CUIT%')),
  'el evento no lleva datos bancarios completos'
);

-- Idempotente: conciliar un pago ya conciliado no hace nada (ni cambia la aprobación ni
-- deja otro evento). El bloqueo optimista protege la transición, no la repetición.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select lives_ok(
  $$select public.conciliar_pago(
      'b1000000-0000-0000-0000-000000000101',
      '2026-12-01 10:00:00+00')$$,
  'conciliar un pago ya conciliado no falla'
);
reset role;
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'pago.conciliado' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1, 'conciliar de nuevo no deja un segundo evento'
);
select is(
  (select aprobado_por from dominio.cobros_comprobante
    where id = 'b1000000-0000-0000-0000-000000000101'),
  'd1000000-0000-0000-0000-000000000002'::uuid, 'conciliar de nuevo no cambia la aprobación'
);

-- Bloqueo optimista: si el pago cambió desde que la pantalla lo leyó, la RPC rechaza.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.conciliar_pago(
      'b1000000-0000-0000-0000-000000000102',
      '2026-12-01 10:00:00+00')$$,
  '40001', null, 'una versión vieja del pago se rechaza (bloqueo optimista)'
);
reset role;
select is_null(
  (select aprobado_por from dominio.cobros_comprobante
    where id = 'b1000000-0000-0000-0000-000000000102'),
  'el pago con conflicto de versión no quedó conciliado'
);
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'pago.conciliado' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1, 'el pago con conflicto de versión no dejó evento'
);

-- Un cobro sin cuenta de cobro no se concilia: el efectivo no va a ningún banco.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.conciliar_pago(
      'b1000000-0000-0000-0000-000000000107',
      (select actualizado_en from dominio.cobros_comprobante
        where id = 'b1000000-0000-0000-0000-000000000107'))$$,
  '22023', null, 'un cobro sin cuenta de cobro no se concilia'
);
reset role;

-- Revertir: deshace la aprobación y deja su evento.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select lives_ok(
  $$select public.revertir_conciliacion_pago(
      'b1000000-0000-0000-0000-000000000101',
      (select actualizado_en from dominio.cobros_comprobante
        where id = 'b1000000-0000-0000-0000-000000000101'))$$,
  'Administración revierte la conciliación de un pago'
);
reset role;
select is_null(
  (select aprobado_por from dominio.cobros_comprobante
    where id = 'b1000000-0000-0000-0000-000000000101'),
  'revertir deja la aprobación vacía'
);
select is_null(
  (select aprobado_por_nombre from dominio.cobros_comprobante
    where id = 'b1000000-0000-0000-0000-000000000101'),
  'revertir borra la foto del nombre'
);
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'pago.conciliacion_revertida' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1, 'la reversión deja su evento'
);
select is(
  (select estado from dominio.comprobantes_venta
    where id = 'f1000000-0000-0000-0000-000000000001'),
  'confirmada', 'revertir tampoco cambia el estado del comprobante'
);
select is(
  (select saldo from public.saldo_comprobante('f1000000-0000-0000-0000-000000000001')),
  600.00::numeric, 'revertir tampoco cambia el saldo'
);

-- Revertir un pago ya revertido es un no-op (no otro evento).
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select lives_ok(
  $$select public.revertir_conciliacion_pago(
      'b1000000-0000-0000-0000-000000000101',
      (select actualizado_en from dominio.cobros_comprobante
        where id = 'b1000000-0000-0000-0000-000000000101'))$$,
  'revertir un pago ya revertido no falla'
);
reset role;
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'pago.conciliacion_revertida' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1, 'revertir de nuevo no deja un segundo evento'
);

-- ============================================================================
-- Las tarjetas siguen a la conciliación (FR-024)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select lives_ok(
  $$select public.conciliar_pago(
      'b1000000-0000-0000-0000-000000000101',
      (select actualizado_en from dominio.cobros_comprobante
        where id = 'b1000000-0000-0000-0000-000000000101'))$$,
  'Administración vuelve a conciliar el pago'
);
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  (select conciliado_importe from public.resumen_pagos()),
  400.00::numeric, 'la tarjeta Conciliado muestra el importe conciliado'
);
select is(
  (select conciliado_cantidad from public.resumen_pagos()),
  1::bigint, 'la tarjeta Conciliado cuenta un pago'
);
select is(
  (select por_conciliar_importe from public.resumen_pagos()),
  1700.00::numeric, 'la tarjeta Por conciliar descuenta lo conciliado'
);
select is(
  (select por_conciliar_cantidad from public.resumen_pagos()),
  5::bigint, 'la tarjeta Por conciliar descuenta la cantidad'
);
select is(
  (select conciliado from public.listar_pagos()
    where id = 'b1000000-0000-0000-0000-000000000101'),
  true, 'el listado marca el pago como conciliado'
);
select is(
  (select aprobado_por from public.listar_pagos()
    where id = 'b1000000-0000-0000-0000-000000000101'),
  'Rita Ramírez', 'el listado muestra quién aprobó'
);
reset role;

-- ============================================================================
-- Aislamiento (SC-003)
-- ============================================================================

-- Otra organización: ve lo suyo y nada de lo ajeno.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.listar_pagos()),
  1, 'la otra organización ve solo su propio pago'
);
select is(
  (select count(*)::int from public.listar_pagos()
    where id = 'b1000000-0000-0000-0000-000000000101'),
  0, 'y no ve los pagos de la otra organización'
);
select is(
  (select por_conciliar_importe from public.resumen_pagos()),
  700.00::numeric, 'los totales son los de su propia organización'
);
select is(
  (select count(*)::int from public.cuentas_cobro_mas_usadas()),
  1, 'solo ve las cuentas de cobro de su propia organización'
);
select lives_ok(
  $$select public.conciliar_pago(
      'b2000000-0000-0000-0000-000000000108',
      (select actualizado_en from dominio.cobros_comprobante
        where id = 'b2000000-0000-0000-0000-000000000108'))$$,
  'el Administrador de la otra organización concilia sus propios pagos'
);
reset role;

-- Otra tienda de la misma organización: una persona con acceso solo a Mundo JC no ve San
-- Javucho.
select pg_temp.como('d1000000-0000-0000-0000-000000000006');
select is(
  (select count(*)::int from public.listar_pagos()),
  1, 'quien solo tiene Mundo JC ve un pago'
);
select is(
  (select count(*)::int from public.listar_pagos()
    where empresa_id = 'a1000000-0000-0000-0000-00000000000a'),
  0, 'y no ve los pagos de San Javucho'
);
select is(
  (select count(*)::int from public.cuentas_cobro_mas_usadas()),
  3, 've las tres cuentas de la organización, pero solo los usos de sus tiendas'
);
select is(
  (select usos from public.cuentas_cobro_mas_usadas()
    where id = 'e1000000-0000-0000-0000-00000000000c'),
  1::bigint, 'el uso de la cuenta de su tienda se cuenta'
);
select is(
  (select usos from public.cuentas_cobro_mas_usadas()
    where id = 'e1000000-0000-0000-0000-00000000000a'),
  0::bigint, 'el uso de una cuenta que solo se usó en otra tienda no se revela'
);
reset role;

-- Sin Ventas no hay pagos, ni tarjetas, ni cuentas.
update permisos_rol set nivel = 'ninguno'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'deposito' and seccion = 'ventas';
select pg_temp.como('d1000000-0000-0000-0000-000000000005');
select throws_ok(
  $$select * from public.listar_pagos()$$,
  '42501', null, 'sin Ventas no se listan pagos'
);
select throws_ok(
  $$select * from public.resumen_pagos()$$,
  '42501', null, 'sin Ventas no se leen los totales'
);
select throws_ok(
  $$select * from public.cuentas_cobro_mas_usadas()$$,
  '42501', null, 'sin Ventas no se leen las cuentas de cobro'
);
reset role;
update permisos_rol set nivel = 'lectura'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'deposito' and seccion = 'ventas';

select * from finish();

rollback;
