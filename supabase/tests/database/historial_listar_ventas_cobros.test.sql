-- MSF-309 (F-VTA-38, SC-004): listar_historial_ventas y listar_historial_cobros.
-- Cubre: búsqueda (sin mayúsculas/tildes, texto literal), filtro de tienda, paginación y tope,
-- rango de fechas, orden estable, aislamiento por organización / empresas asignadas / sección de
-- `ventas`, `anon` sin ejecución. El fixture corre como postgres; las verificaciones, con el rol
-- que corresponda (misma técnica que historial_importacion.test.sql).
begin;

select plan(31);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000011', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000012', 'mostrador-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000013', 'deposito-uno@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'miembro'),
  ('d1000000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'miembro');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-0000000000a1', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000012', 'a1000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'mostrador'),
  ('d1000000-0000-0000-0000-000000000013', 'a1000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'deposito');
insert into usuario_empresa_activa (user_id, empresa_id) values
  ('d1000000-0000-0000-0000-000000000012', 'a1000000-0000-0000-0000-0000000000a1'),
  ('d1000000-0000-0000-0000-000000000013', 'a1000000-0000-0000-0000-0000000000a1');

insert into dominio.historial_comprobantes (organizacion_id, empresa_id, tipo, numero, fecha, cliente_nombre, cliente_numero, operador, estado_final, total) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000a1', 'Factura', 'A-0001', '2020-01-10', 'José Pérez', 'C-100', 'Javier', 'Cobrado', 100),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000a1', 'Factura', 'A-0002', '2020-02-10', 'Kiosco 100%', 'C-200', 'Emilse', 'Deuda', 200),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000a2', 'Factura', 'B-0003', '2020-03-10', 'Tecnoplay', null, 'Javier', 'Cobrado', 300),
  ('22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-0000000000a1', 'Factura', 'Z-0099', '2020-03-10', 'José Otra Org', null, null, null, 999);

insert into dominio.historial_cobros (organizacion_id, empresa_id, fecha, comprobante_numero, cliente_nombre, cliente_numero, cuenta_cobro, aprobado_por, importe) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000a1', '2020-01-11', 'A-0001', 'José Pérez', 'C-100', 'Caja', 'Ana', 100),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000a2', '2020-03-11', 'B-0003', 'Tecnoplay', null, 'Banco', 'Ana', 300),
  ('22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-0000000000a1', '2020-03-11', 'Z-0099', 'José Otra Org', null, 'Caja', 'Ana', 999);

-- 230 ventas más en la tienda Uno para probar paginación y tope.
insert into dominio.historial_comprobantes (organizacion_id, empresa_id, tipo, numero, fecha, cliente_nombre, total)
select '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000a1', 'Factura',
       'M-' || lpad(g::text, 4, '0'), date '2019-01-01' + g, 'Masivo ' || g, g
  from generate_series(1, 230) g;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Administrador: todas las tiendas de su organización, ninguna otra
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000011');

select is(
  (select total_filas::int from public.listar_historial_ventas(null, null, 1, 1)), 233,
  'ventas: el total cuenta las tiendas de la organización y ninguna otra'
);

select is(
  (select numero from public.listar_historial_ventas('a-0001')), 'A-0001',
  'ventas: busca por número de comprobante sin distinguir mayúsculas'
);

select is(
  (select cliente_nombre from public.listar_historial_ventas('jose perez')), 'José Pérez',
  'ventas: busca por cliente sin distinguir tildes'
);

select is(
  (select numero from public.listar_historial_ventas('c-200')), 'A-0002',
  'ventas: busca por número de cliente'
);

select is(
  (select count(*)::int from public.listar_historial_ventas('100%')), 1,
  'ventas: el % se busca literal y no es comodín'
);

select is(
  (select count(*)::int from public.listar_historial_ventas('_')), 0,
  'ventas: el _ se busca literal y no es comodín'
);

select is(
  (select numero from public.listar_historial_ventas(null, 'a1000000-0000-0000-0000-0000000000a2')), 'B-0003',
  'ventas: el filtro de tienda deja solo esa tienda'
);

select is(
  (select empresa_nombre from public.listar_historial_ventas('tecnoplay')), 'Mundo JC',
  'ventas: devuelve el nombre de la tienda, no solo el id'
);

select is(
  (select count(*)::int from public.listar_historial_ventas(null, 'a2000000-0000-0000-0000-0000000000a1')), 0,
  'ventas: una tienda de otra organización no devuelve filas'
);

select is(
  (select count(*)::int from public.listar_historial_ventas(null, null, 1, 1000)), 200,
  'ventas: el tamaño de página tiene tope 200'
);

select is(
  (select count(*)::int from public.listar_historial_ventas(null, null, 2, 200)), 33,
  'ventas: la segunda página trae el resto'
);

select is(
  (select count(*)::int from public.listar_historial_ventas(null, null, 99, 200)), 0,
  'ventas: una página fuera de rango no devuelve filas'
);

select is(
  (select numero from public.listar_historial_ventas(null, null, 1, 1)), 'B-0003',
  'ventas: orden por fecha descendente (la más nueva primero)'
);

select is(
  (select count(*)::int from public.listar_historial_ventas(null, null, 1, 200, '2020-02-01', '2020-03-31')), 2,
  'ventas: el rango Desde/Hasta recorta por fecha'
);

select is(
  (select fecha_desde::text || '/' || fecha_hasta::text from public.listar_historial_ventas('tecnoplay' ) limit 1),
  '2020-03-10/2020-03-10',
  'ventas: devuelve el rango de fechas del filtro actual'
);

select is(
  (select total_filas::int from public.listar_historial_cobros(null, null, 1, 1)), 2,
  'cobros: el total cuenta las tiendas de la organización y ninguna otra'
);

select is(
  (select comprobante_numero from public.listar_historial_cobros('c-100')), 'A-0001',
  'cobros: busca por número de cliente'
);

select is(
  (select cliente_nombre from public.listar_historial_cobros('JOSE')), 'José Pérez',
  'cobros: busca por cliente sin distinguir mayúsculas ni tildes'
);

select is(
  (select comprobante_numero from public.listar_historial_cobros(null, 'a1000000-0000-0000-0000-0000000000a2')), 'B-0003',
  'cobros: el filtro de tienda deja solo esa tienda'
);

select is(
  (select comprobante_numero from public.listar_historial_cobros(null, null, 1, 1)), 'B-0003',
  'cobros: orden por fecha descendente'
);

-- ============================================================================
-- Mostrador: solo su tienda asignada
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000012');

select is(
  (select total_filas::int from public.listar_historial_ventas(null, null, 1, 1)), 232,
  'ventas: mostrador ve solo las de su tienda asignada'
);

select is(
  (select count(*)::int from public.listar_historial_ventas(null, 'a1000000-0000-0000-0000-0000000000a2')), 0,
  'ventas: pedir una tienda no asignada no devuelve filas'
);

select is(
  (select count(*)::int from public.listar_historial_ventas('tecnoplay')), 0,
  'ventas: la búsqueda no se escapa a tiendas no asignadas'
);

select is(
  (select total_filas::int from public.listar_historial_cobros(null, null, 1, 1)), 1,
  'cobros: mostrador ve solo los de su tienda asignada'
);

select is(
  (select count(*)::int from public.listar_historial_cobros(null, 'a1000000-0000-0000-0000-0000000000a2')), 0,
  'cobros: pedir una tienda no asignada no devuelve filas'
);

-- ============================================================================
-- Depósito sin acceso a la sección ventas
-- ============================================================================

reset role;
insert into public.permisos_rol (organizacion_id, rol_id, seccion, nivel) values
  ('11111111-1111-1111-1111-111111111111', 'deposito', 'ventas', 'ninguno')
on conflict (organizacion_id, rol_id, seccion) do update set nivel = excluded.nivel;
select pg_temp.como('d1000000-0000-0000-0000-000000000013');

select is(
  (select count(*)::int from public.listar_historial_ventas()), 0,
  'ventas: sin nivel en la sección ventas la base no devuelve filas'
);

select is(
  (select count(*)::int from public.listar_historial_cobros()), 0,
  'cobros: sin nivel en la sección ventas la base no devuelve filas'
);

-- ============================================================================
-- anon sin ejecución; authenticated con ejecución
-- ============================================================================

reset role;

select ok(
  has_function_privilege('authenticated', 'public.listar_historial_ventas(text, uuid, integer, integer, date, date)', 'execute')
  and has_function_privilege('authenticated', 'public.listar_historial_cobros(text, uuid, integer, integer, date, date)', 'execute'),
  'authenticated ejecuta las dos RPC'
);

set local role anon;

select throws_ok(
  $$ select * from public.listar_historial_ventas() $$,
  '42501', null, 'anon no ejecuta listar_historial_ventas'
);

select throws_ok(
  $$ select * from public.listar_historial_cobros() $$,
  '42501', null, 'anon no ejecuta listar_historial_cobros'
);

reset role;

select ok(
  (select bool_and(p.prosecdef = false) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('listar_historial_ventas', 'listar_historial_cobros')),
  'las dos RPC son security invoker (rige la RLS del llamador)'
);

select * from finish();
rollback;
