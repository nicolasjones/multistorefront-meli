-- F-CLI-18 (MSF-447, épica MSF-445): fusión de clientes duplicados. Cubre SC-003 (3 + 5 compras = 8, descartado
-- archivado y evento sin DNI/CUIT), SC-004 (Operador rechazado, `anon` sin ejecución) y SC-005 (dos cuentas web
-- activas sin resolver, validaciones y atomicidad) y la vista previa de solo lectura (FR-012).
begin;

select plan(29);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'operador-uno@example.com'),
  ('d3000000-0000-0000-0000-0000000000a1', 'web-a@example.com'),
  ('d3000000-0000-0000-0000-0000000000b1', 'web-b@example.com'),
  ('d3000000-0000-0000-0000-0000000000c1', 'web-c@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Otra tienda');

-- 101 y 102: las dos fichas del mismo cliente (3 y 5 compras). 103 y 104: ambos con cuenta web activa.
-- 105: sin cuentas. 201: otra organización.
insert into clientes (id, organizacion_id, numero, nombre, documento) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 101, 'Alfa', '20-11111111-1'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 102, 'Alfa duplicado', '20-11111111-2'),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 103, 'Beta', null),
  ('c1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 104, 'Beta duplicado', null),
  ('c1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 105, 'Gamma', null),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 201, 'Ajeno', null);

insert into clientes_empresas (cliente_id, empresa_id, organizacion_id) values
  ('c1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111');
insert into cuentas_cliente (organizacion_id, cliente_id, empresa_id, auth_user_id, estado) values
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-0000000000a1', 'activa'),
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000002', 'd3000000-0000-0000-0000-0000000000b1', 'activa');

-- Fechas relativas al reloj de la base.
insert into dominio.comprobantes_venta
  (organizacion_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva)
select '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'factura',
       '0001-' || lpad(n::text, 8, '0'), current_date - n, 'emitida', 100, 121
  from generate_series(1, 3) n;
insert into dominio.comprobantes_venta
  (organizacion_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva)
select '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000002', 'factura',
       '0002-' || lpad(n::text, 8, '0'), current_date - n, 'emitida', 100, 121
  from generate_series(1, 5) n;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ---------------------------------------------------------------------------
-- SC-004: permisos
-- ---------------------------------------------------------------------------
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select fusionar_clientes('c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002')$$,
  '42501', 'Solo el Administrador puede fusionar clientes', 'el Operador no puede fusionar');
select throws_ok(
  $$select * from vista_previa_fusion_clientes('c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002')$$,
  '42501', 'Solo el Administrador puede fusionar clientes', 'el Operador no ve la vista previa');

reset role;
set local role anon;
select throws_ok(
  $$select fusionar_clientes('c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'anon no ejecuta fusionar_clientes');
select throws_ok(
  $$select * from vista_previa_fusion_clientes('c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'anon no ejecuta vista_previa_fusion_clientes');
reset role;

-- ---------------------------------------------------------------------------
-- Validaciones (FR-011): mensajes claros y sin cambios
-- ---------------------------------------------------------------------------
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select fusionar_clientes('c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001')$$,
  '22023', 'No se puede fusionar un cliente consigo mismo', 'mismo cliente en ambos lados');
select throws_ok(
  $$select fusionar_clientes('c1000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000009')$$,
  'P0002', 'Alguno de los clientes no existe', 'cliente inexistente');
select throws_ok(
  $$select fusionar_clientes('c1000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001')$$,
  'P0002', 'Alguno de los clientes no existe', 'cliente de otra organización');
select throws_ok(
  $$select fusionar_clientes(null, 'c1000000-0000-0000-0000-000000000001')$$,
  '22023', 'Elegí los dos clientes a fusionar', 'falta uno de los clientes');
select throws_ok(
  $$select fusionar_clientes('c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000005')$$,
  '22023', 'La cuenta web elegida debe ser la de uno de los dos clientes', 'cuenta web de un tercero');

-- Vista previa: solo lectura, con compras y cuentas web (FR-012).
select results_eq(
  $$select cliente_id::text, documentos from vista_previa_fusion_clientes('c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002')$$,
  $$values ('c1000000-0000-0000-0000-000000000001', 3::bigint), ('c1000000-0000-0000-0000-000000000002', 5::bigint)$$,
  'la vista previa muestra 3 y 5 compras');
select results_eq(
  $$select cuentas_web_activas, cuentas_web_total from vista_previa_fusion_clientes('c1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000004')$$,
  $$values (1::bigint, 1::bigint), (1::bigint, 1::bigint)$$,
  'la vista previa cuenta las cuentas web activas y totales');
select throws_ok(
  $$select * from vista_previa_fusion_clientes('c1000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001')$$,
  'P0002', 'Alguno de los clientes no existe', 'la vista previa rechaza clientes de otra organización');
select is(
  (select count(*)::int from dominio.comprobantes_venta where cliente_id = 'c1000000-0000-0000-0000-000000000002'),
  5, 'la vista previa no escribe nada');

-- ---------------------------------------------------------------------------
-- SC-005: dos cuentas web activas sin resolver → rechazo sin cambios
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select fusionar_clientes('c1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000004')$$,
  '22023', 'Los dos clientes tienen cuenta web activa: elegí cuál se mantiene', 'dos cuentas activas sin resolver');
select is(
  (select count(*)::int from cuentas_cliente where cliente_id in ('c1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000004')),
  2, 'el rechazo no toca las cuentas');
select is(
  (select archivado_en is null from clientes where id = 'c1000000-0000-0000-0000-000000000004'),
  true, 'el rechazo no archiva al descartado');

-- Resuelto: prevalece la cuenta del descartado; la del conservado se da de baja.
select is(
  (select fusionar_clientes('c1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000004')),
  jsonb_build_object('documentos_reasignados', 0, 'cuentas_reasignadas', 1, 'campanas_reasignadas', 0, 'cuentas_dadas_de_baja', 1),
  'resuelto: la fusión sigue');
select results_eq(
  $$select cliente_id::text, auth_user_id::text from cuentas_cliente where cliente_id in ('c1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000004')$$,
  $$values ('c1000000-0000-0000-0000-000000000003', 'd3000000-0000-0000-0000-0000000000b1')$$,
  'queda una sola cuenta, la elegida, en el conservado');
select ok(
  exists (select 1 from clientes_empresas where cliente_id = 'c1000000-0000-0000-0000-000000000003' and empresa_id = 'a1000000-0000-0000-0000-000000000002'),
  'la tienda de la cuenta que se mantiene queda habilitada en el conservado');

-- ---------------------------------------------------------------------------
-- SC-003: 3 + 5 compras = 8, descartado archivado y evento
-- ---------------------------------------------------------------------------
select is(
  (select fusionar_clientes('c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002')),
  jsonb_build_object('documentos_reasignados', 5, 'cuentas_reasignadas', 0, 'campanas_reasignadas', 0, 'cuentas_dadas_de_baja', 0),
  'la fusión informa los documentos reasignados');
select is(
  (select count(*)::int from dominio.comprobantes_venta where cliente_id = 'c1000000-0000-0000-0000-000000000001'),
  8, 'el conservado suma 3 + 5 = 8 compras');
select is(
  (select count(*)::int from dominio.comprobantes_venta where cliente_id = 'c1000000-0000-0000-0000-000000000002'),
  0, 'el descartado queda sin compras');
select results_eq(
  $$select archivado_en is not null, nombre, documento from clientes where id = 'c1000000-0000-0000-0000-000000000002'$$,
  $$values (true, 'Alfa duplicado', '20-11111111-2')$$,
  'el descartado queda archivado con sus datos de ficha intactos');
select is(
  (select count(*)::int from registro_actividad where tipo = 'cliente.fusionado' and detalle like '%Nº 102 · Alfa duplicado en el cliente Nº 101 · Alfa'),
  1, 'queda el evento cliente.fusionado con ambos clientes');
select is(
  (select count(*)::int from registro_actividad where tipo = 'cliente.fusionado' and detalle like '%20-11111111%'),
  0, 'el evento no lleva DNI/CUIT');
select is(
  (select actor_id::text from registro_actividad where tipo = 'cliente.fusionado' order by creado_en desc limit 1),
  'd1000000-0000-0000-0000-000000000001', 'el evento lleva al actor');

-- Repetir la fusión o usar un cliente archivado: rechazo claro.
select throws_ok(
  $$select fusionar_clientes('c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002')$$,
  '22023', 'Alguno de los clientes ya está archivado (¿la fusión ya se hizo?)', 'repetir la fusión se rechaza');
select throws_ok(
  $$select fusionar_clientes('c1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000005')$$,
  '22023', 'Alguno de los clientes ya está archivado (¿la fusión ya se hizo?)', 'un cliente archivado no se fusiona');

-- Atomicidad: si falla una validación tardía no queda nada a medias.
select is(
  (select count(*)::int from clientes where archivado_en is not null and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  2, 'solo los dos descartados de las fusiones correctas están archivados');

select * from finish();
rollback;
