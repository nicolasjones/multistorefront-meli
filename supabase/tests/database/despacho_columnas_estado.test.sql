-- F-VTA-15 (MSF-152, épica MSF-135, spec 20261024-130000-ventas-despacho-y-faltantes): columnas del despacho,
-- estado inicial al confirmar y acción `despachar`.
--
-- Cubre lo que traen T001, T002 y T003:
--   · FR-001 (T001): las cinco columnas de despacho, el `check` de los cinco estados, que solo las facturas
--     tengan estado de despacho, el índice por organización/empresa/estado, RLS vigente y `anon` sin acceso.
--   · FR-002 (T003): estado inicial según la forma de envío, `sin_armar` cuando no resuelve, una sola vez y
--     un presupuesto que no entra al despacho.
--   · FR-008 (T002): la acción `despachar` sembrada para Administrador y Depósito, `lectura` alcanza para
--     despachar y sin la acción no se puede.
--
-- La máquina de estados completa (transiciones, responsables, entrega y reservas) es de T006/T007: este
-- archivo no adelanta esas tareas.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'deposito@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'mostrador@example.com'),
  ('f1000000-0000-0000-0000-000000000004', 'consulta@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'mostrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'mostrador'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');

-- La empresa activa de cada usuario con rol por empresa: `ventas` se resuelve por empresa.
insert into public.usuario_empresa_activa (user_id, empresa_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista', null);

-- Formas de envío de la organización Uno: cada una entra al despacho con un estado inicial distinto.
insert into dominio.formas_envio (id, organizacion_id, empresa_id, nombre, tipo, estado_despacho_inicial) values
  ('f9000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'Retiro en local', 'retiro_local', 'sin_armar'),
  ('f9000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'Expreso', 'expreso', 'armando'),
  ('f9000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'Dejá', 'retiro_local', 'listo_para_despachar');

-- Facturas en borrador: cada una con una forma de envío distinta (o ninguna). F6 es de otra organización.
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, envio_id) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'factura', 'F-0001', '2026-12-14', 'borrador', 100, 121, 'f9000000-0000-0000-0000-000000000001'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'factura', 'F-0002', '2026-12-14', 'borrador', 100, 121, 'f9000000-0000-0000-0000-000000000002'),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'factura', 'F-0003', '2026-12-14', 'borrador', 100, 121, 'f9000000-0000-0000-0000-000000000003'),
  ('e1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'factura', 'F-0004', '2026-12-14', 'borrador', 100, 121, null),
  ('e1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'presupuesto', 'P-0001', '2026-12-14', 'borrador', 100, 121, 'f9000000-0000-0000-0000-000000000002');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- FR-001 (T001) · Columnas, checks, índice y acceso
-- ============================================================================

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'dominio' and table_name = 'comprobantes_venta'
      and column_name in ('estado_despacho', 'armo_id', 'controlo_id', 'entrego_id', 'entregado_en')),
  5, 'FR-001: las cinco columnas del despacho existen en dominio.comprobantes_venta');

select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'dominio' and tablename = 'comprobantes_venta'
      and indexname = 'comprobantes_venta_despacho_idx'),
  1, 'FR-001: hay índice por organización, empresa y estado de despacho');

select is(
  (select relrowsecurity from pg_class where oid = 'dominio.comprobantes_venta'::regclass),
  true, 'FR-001: RLS sigue activo en comprobantes_venta');

select is(has_table_privilege('anon', 'dominio.comprobantes_venta', 'select'), false, 'FR-001: anon no lee los comprobantes');
-- El privilegio de lectura de la factura es por columna (`20270112140500_envio_aislamiento.sql`, F-VTA-16: las
-- columnas del envío no se leen directo de la tabla), así que se comprueba la columna y no la tabla.
select ok(
  has_column_privilege('authenticated', 'dominio.comprobantes_venta', 'estado_despacho', 'SELECT'),
  'FR-001: authenticated lee los comprobantes (con RLS)');

select throws_ok(
  $$update dominio.comprobantes_venta set estado_despacho = 'inventado'
    where id = 'e1000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'FR-001: un estado de despacho fuera de los cinco se rechaza');

select throws_ok(
  $$update dominio.comprobantes_venta set estado_despacho = 'sin_armar'
    where id = 'e1000000-0000-0000-0000-000000000005'$$,
  '23514', null, 'FR-001: un presupuesto no puede tener estado de despacho');

-- ============================================================================
-- FR-002 (T003) · Estado de despacho inicial al confirmar
-- ============================================================================

select is(
  (select estado_despacho from dominio.comprobantes_venta where id = 'e1000000-0000-0000-0000-000000000001'),
  null, 'FR-002: antes de confirmar, la factura no tiene estado de despacho');

update dominio.comprobantes_venta set estado = 'confirmada' where id = 'e1000000-0000-0000-0000-000000000001';
select is(
  (select estado_despacho from dominio.comprobantes_venta where id = 'e1000000-0000-0000-0000-000000000001'),
  'sin_armar', 'FR-002: la forma de envío «Retiro en local» deja la factura Sin armar');

update dominio.comprobantes_venta set estado = 'confirmada' where id = 'e1000000-0000-0000-0000-000000000002';
select is(
  (select estado_despacho from dominio.comprobantes_venta where id = 'e1000000-0000-0000-0000-000000000002'),
  'armando', 'FR-002: la forma de envío «Expreso» deja la factura Armando');

update dominio.comprobantes_venta set estado = 'confirmada' where id = 'e1000000-0000-0000-0000-000000000003';
select is(
  (select estado_despacho from dominio.comprobantes_venta where id = 'e1000000-0000-0000-0000-000000000003'),
  'listo_para_despachar', 'FR-002: la forma de envío «Dejá» deja la factura Listo para despachar');

update dominio.comprobantes_venta set estado = 'confirmada' where id = 'e1000000-0000-0000-0000-000000000004';
select is(
  (select estado_despacho from dominio.comprobantes_venta where id = 'e1000000-0000-0000-0000-000000000004'),
  'sin_armar', 'FR-002: sin forma de envío, la factura queda Sin armar');

-- Una sola vez: volver a pasar por `confirmada` no pisa el estado ya fijado.
update dominio.comprobantes_venta set estado = 'pendiente' where id = 'e1000000-0000-0000-0000-000000000002';
update dominio.comprobantes_venta set estado = 'confirmada' where id = 'e1000000-0000-0000-0000-000000000002';
select is(
  (select estado_despacho from dominio.comprobantes_venta where id = 'e1000000-0000-0000-0000-000000000002'),
  'armando', 'FR-002: el estado de despacho se fija una sola vez');

-- Un presupuesto nunca entra al despacho.
update dominio.comprobantes_venta set estado = 'confirmada' where id = 'e1000000-0000-0000-0000-000000000005';
select is(
  (select estado_despacho from dominio.comprobantes_venta where id = 'e1000000-0000-0000-0000-000000000005'),
  null, 'FR-002: un presupuesto no entra al despacho');

-- La forma de envío de otra organización no se usa (aislamiento).
insert into dominio.formas_envio (id, organizacion_id, empresa_id, nombre, tipo, estado_despacho_inicial) values
  ('f9000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-000000000001', 'Expreso', 'expreso', 'armando');
insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 20, 'Cliente Dos', 'minorista', null);
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, envio_id) values
  ('e1000000-0000-0000-0000-000000000007', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002', 'factura', 'F-0007', '2026-12-14', 'borrador', 100, 121, 'f9000000-0000-0000-0000-000000000002');
update dominio.comprobantes_venta set estado = 'confirmada' where id = 'e1000000-0000-0000-0000-000000000007';
select is(
  (select estado_despacho from dominio.comprobantes_venta where id = 'e1000000-0000-0000-0000-000000000007'),
  'sin_armar', 'FR-002: la forma de envío de otra organización no se aplica');

-- ============================================================================
-- FR-008 (T002) · Acción `despachar`
-- ============================================================================

select is(
  (select permitido from public.permisos_rol_accion
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'administrador'
      and seccion = 'ventas' and accion = 'despachar'),
  true, 'FR-008: el Administrador tiene la acción despachar');

select is(
  (select permitido from public.permisos_rol_accion
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'deposito'
      and seccion = 'ventas' and accion = 'despachar'),
  true, 'FR-008: Depósito tiene la acción despachar');

select is(
  (select permitido from public.permisos_rol_accion
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'mostrador'
      and seccion = 'ventas' and accion = 'despachar'),
  false, 'FR-008: Mostrador no tiene la acción despachar');

select is(
  (select permitido from public.permisos_rol_accion
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta'
      and seccion = 'ventas' and accion = 'despachar'),
  false, 'FR-008: Consulta no tiene la acción despachar');

select is(
  (select count(*)::int from public.permisos_rol_accion
    where accion = 'despachar' and seccion <> 'ventas'),
  0, 'FR-008: la acción despachar existe solo en Ventas');

-- Depósito tiene Ventas en lectura y despacha igual; Mostrador y Consulta no.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is((select private.nivel_seccion('ventas')), 'lectura', 'FR-008: Depósito tiene Ventas en lectura');
select ok(private.puede_accion('ventas', 'despachar'), 'FR-008: Depósito puede despachar con Ventas en lectura');
select ok(not private.puede_accion('ventas', 'eliminar'), 'FR-008: despachar no habilita eliminar');

select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select ok(not private.puede_accion('ventas', 'despachar'), 'FR-008: Mostrador no puede despachar');

select pg_temp.como('f1000000-0000-0000-0000-000000000004');
select ok(not private.puede_accion('ventas', 'despachar'), 'FR-008: Consulta no puede despachar');

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select ok(private.puede_accion('ventas', 'despachar'), 'FR-008: el Administrador puede despachar');

reset role;

select * from finish();
rollback;
