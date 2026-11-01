-- F-VTA-15 (MSF-152, épica MSF-135, spec 20261024-130000-ventas-despacho-y-faltantes): la máquina de estados
-- del despacho y sus responsables (SC-001).
--
-- Cubre T006 (verifica FR-003, FR-004, FR-005, FR-006, FR-008, FR-009 y FR-011):
--   · Transiciones válidas e inválidas, idempotencia y conflicto de edición (FR-003).
--   · «Armó» con rol Depósito o Administrador (FR-004).
--   · «Controló» distinto de quien armó, salvo el Administrador (FR-005).
--   · «Entregó» con la acción `despachar` (FR-006 y FR-008).
--   · Elegibles por función y por empresa; otra organización sin filas; y quien no tiene Ventas en la empresa no
--     se ofrece en el desplegable ni se puede registrar como responsable (FR-009).
--   · Actividad `despacho.estado_cambiado` con estado anterior, nuevo y responsable (FR-011).
--   · La lectura del despacho (`obtener_despacho_comprobante`): con Ventas en lectura se ve el estado y los
--     responsables, sin la acción `despachar` no se puede avanzar (FR-010 y FR-008).
--   · Quién puede ejecutar cada función: las RPC son de `authenticated`, `anon` no las ejecuta y las ayudas de
--     `private` no las ejecuta nadie del navegador (FR-009).
--   · `anon` sin acceso.
--
-- El descuento de las reservas «A pedido» al entregar es de T007 (`despacho_entrega.test.sql`).
begin;

select no_plan();

-- ============================================================================
-- Datos: dos organizaciones, una tienda, el equipo y sus roles
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'deposito@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'deposito-dos@example.com'),
  ('f1000000-0000-0000-0000-000000000004', 'mostrador@example.com'),
  ('f1000000-0000-0000-0000-000000000005', 'consulta@example.com'),
  ('f1000000-0000-0000-0000-000000000006', 'suspendido@example.com'),
  ('f1000000-0000-0000-0000-000000000007', 'miembro@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo'),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'mostrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'deposito', 'suspendido'),
  ('f1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'miembro', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'mostrador'),
  ('f1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('f1000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('f2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administracion');

-- La empresa activa de cada uno: `ventas` se resuelve por empresa.
insert into public.usuario_empresa_activa (user_id, empresa_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000001'),
  ('f2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista', null);

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks');

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', null, true);

create temp table datos as
  select (select id from dominio.depositos
           where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as principal;
grant select on datos to public;

insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select principal, 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'
  from datos;

-- El trigger `productos_crear_existencias` ya crea la fila de existencias: se actualiza la cantidad.
insert into dominio.existencias (producto_id, organizacion_id, cantidad, reservado)
select 'b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 100, 0
on conflict (producto_id) do update
   set cantidad = excluded.cantidad, reservado = 0, updated_at = now();

insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado)
select 'b1000000-0000-0000-0000-000000000001', principal, '11111111-1111-1111-1111-111111111111', 100, 0
  from datos;

-- ============================================================================
-- Ayudas
-- ============================================================================

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table comps (clave text primary key, id uuid);
grant select, insert on comps to public;

-- Factura de la tienda de la organización Uno, con su línea, y confirmada (queda Sin armar).
create function pg_temp.armar(p_clave text) returns void language plpgsql as $$
declare v_c dominio.comprobantes_venta;
begin
  v_c := public.crear_comprobante(
    'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-12-14');
  insert into comps (clave, id) values (p_clave, v_c.id);
  perform public.guardar_lineas_comprobante(v_c.id, jsonb_build_array(
    jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 1)), v_c.updated_at);
end $$;

create function pg_temp.id_de(p_clave text) returns uuid language sql as $$
  select id from comps where clave = p_clave $$;

-- `updated_at` vigente: es el bloqueo optimista de `cambiar_estado_despacho`.
create function pg_temp.actualizado(p_clave text) returns timestamptz language sql security definer as $$
  select updated_at from dominio.comprobantes_venta where id = (select id from comps where clave = p_clave) $$;

-- Los ids que la RPC devuelve para un paso, ordenados: los elegibles del desplegable.
create function pg_temp.elegibles(p_funcion text) returns text language sql security definer as $$
  select coalesce(string_agg(r.user_id::text, ',' order by r.user_id::text), '')
    from public.listar_responsables_despacho('a1000000-0000-0000-0000-000000000001', p_funcion) r $$;

-- ============================================================================
-- FR-002 / FR-003 · Estado inicial y transiciones
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');

select pg_temp.armar('f1');

select is(
  (select estado from public.confirmar_comprobante(pg_temp.id_de('f1'))),
  'confirmada', 'la factura quedó confirmada');

select is(
  (select estado_despacho from dominio.comprobantes_venta where id = pg_temp.id_de('f1')),
  'sin_armar', 'sin forma de envío, la factura arranca Sin armar');

-- Una transición que no existe en el flujo se rechaza y no cambia nada.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select throws_ok(
  format($$select public.cambiar_estado_despacho(%L, 'entregado', 'f1000000-0000-0000-0000-000000000002', %L::timestamptz)$$,
    pg_temp.id_de('f1'), pg_temp.actualizado('f1')),
  '55000', null, 'Sin armar no pasa directo a Entregado');

select is(
  (select estado_despacho from dominio.comprobantes_venta where id = pg_temp.id_de('f1')),
  'sin_armar', 'la transición inválida no cambió el estado');

-- Un estado que no es del despacho se rechaza antes de tocar nada.
select throws_ok(
  format($$select public.cambiar_estado_despacho(%L, 'inventado', 'f1000000-0000-0000-0000-000000000002', %L::timestamptz)$$,
    pg_temp.id_de('f1'), pg_temp.actualizado('f1')),
  '22023', null, 'un estado que no es del despacho se rechaza');

-- Bloqueo optimista: un `updated_at` viejo choca (FR-003).
select throws_ok(
  format($$select public.cambiar_estado_despacho(%L, 'armando', 'f1000000-0000-0000-0000-000000000002', %L::timestamptz)$$,
    pg_temp.id_de('f1'), '2026-01-01T00:00:00Z'),
  '40001', null, 'un updated_at viejo da conflicto de edición');

-- ============================================================================
-- FR-004 / FR-005 / FR-006 · Quién puede armar, controlar y entregar
-- ============================================================================

-- Mostrador no puede ser quien arma (FR-004): el rol Depósito o Administrador.
select throws_ok(
  format($$select public.cambiar_estado_despacho(%L, 'armando', 'f1000000-0000-0000-0000-000000000004', %L::timestamptz)$$,
    pg_temp.id_de('f1'), pg_temp.actualizado('f1')),
  '42501', null, 'Mostrador no puede armar el pedido');

-- Consulta tampoco (FR-004).
select throws_ok(
  format($$select public.cambiar_estado_despacho(%L, 'armando', 'f1000000-0000-0000-0000-000000000005', %L::timestamptz)$$,
    pg_temp.id_de('f1'), pg_temp.actualizado('f1')),
  '42501', null, 'Consulta no puede armar el pedido');

-- Un Depósito sí (FR-004).
select is(
  (select estado_despacho from public.cambiar_estado_despacho(
     pg_temp.id_de('f1'), 'armando', 'f1000000-0000-0000-0000-000000000002', pg_temp.actualizado('f1'))),
  'armando', 'Depósito arma el pedido');

select is(
  (select armo_id from dominio.comprobantes_venta where id = pg_temp.id_de('f1')),
  'f1000000-0000-0000-0000-000000000002', 'la factura recuerda quién armó');

-- Idempotencia (FR-003): pedir el estado que ya tiene no cambia nada.
select is(
  (select estado_despacho from public.cambiar_estado_despacho(
     pg_temp.id_de('f1'), 'armando', 'f1000000-0000-0000-0000-000000000002', pg_temp.actualizado('f1'))),
  'armando', 'repetir el estado ya alcanzado no falla');

select is(
  (select count(*)::int from public.registro_actividad where tipo = 'despacho.estado_cambiado'),
  0, 'repetir el estado ya alcanzado no registra actividad otra vez');

-- Quien armó no puede controlar (FR-005).
select throws_ok(
  format($$select public.cambiar_estado_despacho(%L, 'listo_para_despachar', 'f1000000-0000-0000-0000-000000000002', %L::timestamptz)$$,
    pg_temp.id_de('f1'), pg_temp.actualizado('f1')),
  '42501', null, 'quien armó no puede controlar el pedido');

-- Otro Depósito sí (FR-005).
select pg_temp.como('f1000000-0000-0000-0000-000000000003');

select is(
  (select estado_despacho from public.cambiar_estado_despacho(
     pg_temp.id_de('f1'), 'listo_para_despachar', 'f1000000-0000-0000-0000-000000000003', pg_temp.actualizado('f1'))),
  'listo_para_despachar', 'otro Depósito controla el pedido');

select is(
  (select controlo_id from dominio.comprobantes_venta where id = pg_temp.id_de('f1')),
  'f1000000-0000-0000-0000-000000000003', 'la factura recuerda quién controló');

-- Entregar exige la acción `despachar` (FR-006, FR-008): Consulta no la tiene.
select pg_temp.como('f1000000-0000-0000-0000-000000000005');

select throws_ok(
  format($$select public.cambiar_estado_despacho(%L, 'entregado', 'f1000000-0000-0000-0000-000000000005', %L::timestamptz)$$,
    pg_temp.id_de('f1'), pg_temp.actualizado('f1')),
  '42501', null, 'Consulta no tiene la acción despachar y no entrega');

-- Depósito (con Ventas en lectura) sí entrega (FR-006, FR-008).
select pg_temp.como('f1000000-0000-0000-0000-000000000003');

select is(
  (select estado_despacho from public.cambiar_estado_despacho(
     pg_temp.id_de('f1'), 'entregado', 'f1000000-0000-0000-0000-000000000003', pg_temp.actualizado('f1'))),
  'entregado', 'Depósito entrega el pedido');

select is(
  (select entrego_id from dominio.comprobantes_venta where id = pg_temp.id_de('f1')),
  'f1000000-0000-0000-0000-000000000003', 'la factura recuerda quién entregó');

select ok(
  (select entregado_en is not null from dominio.comprobantes_venta where id = pg_temp.id_de('f1')),
  'la entrega deja el momento de la entrega');

-- `entregado` es terminal (FR-003).
select throws_ok(
  format($$select public.cambiar_estado_despacho(%L, 'armando', 'f1000000-0000-0000-0000-000000000002', %L::timestamptz)$$,
    pg_temp.id_de('f1'), pg_temp.actualizado('f1')),
  '55000', null, 'una factura entregada no vuelve a armarse');

-- ============================================================================
-- FR-005 · El Administrador puede armar y controlar el mismo pedido
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select pg_temp.armar('f2');

select is(
  (select estado from public.confirmar_comprobante(pg_temp.id_de('f2'))),
  'confirmada', 'la segunda factura quedó confirmada');

select is(
  (select estado_despacho from public.cambiar_estado_despacho(
     pg_temp.id_de('f2'), 'armando', 'f1000000-0000-0000-0000-000000000001', pg_temp.actualizado('f2'))),
  'armando', 'el Administrador arma el pedido');

select is(
  (select estado_despacho from public.cambiar_estado_despacho(
     pg_temp.id_de('f2'), 'listo_para_despachar', 'f1000000-0000-0000-0000-000000000001', pg_temp.actualizado('f2'))),
  'listo_para_despachar', 'el Administrador puede controlar el pedido que armó (excepción de FR-005)');

-- ============================================================================
-- Responsables inválidos (spec, *Edge Cases*): suspendido, de otra organización o
-- sin acceso a la empresa se rechazan y no cambian nada.
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select pg_temp.armar('f3');

select is(
  (select estado from public.confirmar_comprobante(pg_temp.id_de('f3'))),
  'confirmada', 'la tercera factura quedó confirmada');

select throws_ok(
  format($$select public.cambiar_estado_despacho(%L, 'armando', 'f1000000-0000-0000-0000-000000000006', %L::timestamptz)$$,
    pg_temp.id_de('f3'), pg_temp.actualizado('f3')),
  '42501', null, 'un responsable suspendido no puede armar');

select throws_ok(
  format($$select public.cambiar_estado_despacho(%L, 'armando', 'f2000000-0000-0000-0000-000000000001', %L::timestamptz)$$,
    pg_temp.id_de('f3'), pg_temp.actualizado('f3')),
  '42501', null, 'un responsable de otra organización no puede armar');

select throws_ok(
  format($$select public.cambiar_estado_despacho(%L, 'armando', 'f1000000-0000-0000-0000-000000000007', %L::timestamptz)$$,
    pg_temp.id_de('f3'), pg_temp.actualizado('f3')),
  '42501', null, 'un responsable sin acceso a la empresa no puede armar');

select is(
  (select estado_despacho from dominio.comprobantes_venta where id = pg_temp.id_de('f3')),
  'sin_armar', 'los responsables inválidos no cambiaron el estado');

-- ============================================================================
-- FR-009 · Los elegibles del desplegable
-- ============================================================================

-- Armar y controlar: los Depósito de la tienda y el Administrador de la organización.
select is(
  pg_temp.elegibles('armar'),
  'f1000000-0000-0000-0000-000000000001,f1000000-0000-0000-0000-000000000002,f1000000-0000-0000-0000-000000000003',
  'para armar se ofrecen el Administrador y los Depósito de la tienda');

select is(
  pg_temp.elegibles('controlar'),
  'f1000000-0000-0000-0000-000000000001,f1000000-0000-0000-0000-000000000002,f1000000-0000-0000-0000-000000000003',
  'para controlar se ofrecen los mismos');

-- Entregar: los roles con la acción `despachar` (Administrador y Depósito).
select is(
  pg_temp.elegibles('entregar'),
  'f1000000-0000-0000-0000-000000000001,f1000000-0000-0000-0000-000000000002,f1000000-0000-0000-0000-000000000003',
  'para entregar se ofrecen los roles con la acción despachar');

-- Mostrador, Consulta, el suspendido y el miembro sin empresa no se ofrecen.
select ok(
  pg_temp.elegibles('armar') not like '%f1000000-0000-0000-0000-000000000004%',
  'Mostrador no se ofrece para armar');

select ok(
  pg_temp.elegibles('armar') not like '%f1000000-0000-0000-0000-000000000005%',
  'Consulta no se ofrece para armar');

select ok(
  pg_temp.elegibles('armar') not like '%f1000000-0000-0000-0000-000000000006%',
  'un usuario suspendido no se ofrece');

select ok(
  pg_temp.elegibles('armar') not like '%f1000000-0000-0000-0000-000000000007%',
  'quien no tiene rol en la tienda no se ofrece');

-- Un paso que no existe se rechaza.
select throws_ok(
  $$select public.listar_responsables_despacho('a1000000-0000-0000-0000-000000000001', 'inventado')$$,
  '22023', null, 'un paso que no es del despacho se rechaza');

-- Aislamiento: la tienda de otra organización no existe para esta sesión.
select throws_ok(
  $$select public.listar_responsables_despacho('a2000000-0000-0000-0000-000000000001', 'armar')$$,
  'P0002', null, 'no se listan responsables de una tienda de otra organización');

-- Y al revés: la otra organización no ve los responsables de esta tienda.
select pg_temp.como('f2000000-0000-0000-0000-000000000001');

select throws_ok(
  $$select public.listar_responsables_despacho('a1000000-0000-0000-0000-000000000001', 'armar')$$,
  'P0002', null, 'otra organización no ve los responsables de esta tienda');

-- Quien no accede a la tienda no ve la lista.
select pg_temp.como('f1000000-0000-0000-0000-000000000007');

select throws_ok(
  $$select public.listar_responsables_despacho('a1000000-0000-0000-0000-000000000001', 'armar')$$,
  '42501', null, 'quien no accede a la tienda no ve los responsables');

-- ============================================================================
-- FR-009 · El responsable tiene que tener acceso a Ventas en la empresa
-- ============================================================================

-- La organización le deja a Depósito sin Ventas: deja de ser elegible y no se
-- puede registrar (el desplegable y la RPC usan la misma regla).
-- La matriz se edita como superusuario: `permisos_rol` se escribe por RPC, no desde la app.
reset role;

update public.permisos_rol
   set nivel = 'ninguno'
 where organizacion_id = '11111111-1111-1111-1111-111111111111'
   and rol_id = 'deposito'
   and seccion = 'ventas';

select pg_temp.como('f1000000-0000-0000-0000-000000000001');

select is(
  pg_temp.elegibles('armar'),
  'f1000000-0000-0000-0000-000000000001',
  'sin acceso a Ventas en la tienda el Depósito no se ofrece para armar');

select throws_ok(
  format($$select public.cambiar_estado_despacho(%L, 'armando', 'f1000000-0000-0000-0000-000000000002', %L::timestamptz)$$,
    pg_temp.id_de('f3'), pg_temp.actualizado('f3')),
  '42501', null, 'sin acceso a Ventas en la tienda el Depósito no puede ser responsable');

select is(
  (select estado_despacho from dominio.comprobantes_venta where id = pg_temp.id_de('f3')),
  'sin_armar', 'el responsable sin Ventas no cambió el estado');

reset role;

update public.permisos_rol
   set nivel = 'lectura'
 where organizacion_id = '11111111-1111-1111-1111-111111111111'
   and rol_id = 'deposito'
   and seccion = 'ventas';

-- ============================================================================
-- FR-008 · El permiso `despachar` se evalúa en la empresa del comprobante
-- ============================================================================

-- Segunda tienda de la misma organización. El Depósito tiene `deposito` en la tienda A (donde despacha) y
-- `mostrador` en B (Ventas en edición, pero SIN la acción `despachar`). Su empresa activa sigue siendo A:
-- el permiso no puede salir de ahí.
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Otra tienda', true);

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 11, 'Cliente Dos', 'minorista', null);

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  -- Quien intenta despachar: en A es Depósito (despacha); en B es Mostrador (Ventas en edición, sin `despachar`).
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'mostrador'),
  -- El responsable del paso sí es válido en B: si no, el rechazo vendría por el responsable y no por el actor.
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'deposito');

insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, estado_despacho,
   total_sin_iva, total_con_iva, canal, operador_id)
values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'a1000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000002', 'factura', '00000001', 1,
   '2026-12-14', 'confirmada', 'sin_armar', 0, 0, 'mostrador', 'f1000000-0000-0000-0000-000000000001');

insert into comps (clave, id) values
  ('f4', 'd1000000-0000-0000-0000-000000000001');

select is(
  (select private.rol_usuario_en_empresa(
     '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000003',
     'a1000000-0000-0000-0000-000000000002')),
  'deposito', 'el responsable del intento sí es válido en la tienda B');

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select ok(
  (select private.puede_accion('ventas', 'despachar')),
  'la persona despacha en su empresa activa (la tienda A)');

select is(
  (select (public.obtener_despacho_comprobante(pg_temp.id_de('f4')) ->> 'puede_despachar')::boolean),
  false,
  'la tarjeta no ofrece despachar en la tienda donde su rol no tiene la acción');

select throws_ok(
  format($$select public.cambiar_estado_despacho(%L, 'armando', 'f1000000-0000-0000-0000-000000000003', %L::timestamptz)$$,
    pg_temp.id_de('f4'), pg_temp.actualizado('f4')),
  '42501', null, 'no se despacha una factura de otra tienda con el permiso de la empresa activa');

select is(
  (select estado_despacho from dominio.comprobantes_venta where id = pg_temp.id_de('f4')),
  'sin_armar', 'el intento cruzado no cambió el estado');

-- ============================================================================
-- FR-011 · La actividad del despacho
-- ============================================================================

-- La actividad es de la sección «actividad»: la cuenta el Administrador.
select pg_temp.como('f1000000-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.registro_actividad where tipo = 'despacho.estado_cambiado'),
  5, 'las transiciones validas quedaron en la actividad');

select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'despacho.estado_cambiado' and detalle like '%Sin armar%Armando%'),
  2, 'la actividad guarda el estado anterior y el nuevo');

select ok(
  exists (select 1 from public.registro_actividad
    where tipo = 'despacho.estado_cambiado' and detalle like '%Armando%Listo para despachar%'),
  'la actividad guarda el paso de Armando a Listo para despachar');

select ok(
  exists (select 1 from public.registro_actividad
    where tipo = 'despacho.estado_cambiado' and detalle like '%Listo para despachar%Entregado%'),
  'la actividad guarda el paso de Listo para despachar a Entregado');

-- ============================================================================
-- FR-010 / FR-008 · La lectura del despacho (`obtener_despacho_comprobante`)
-- ============================================================================
-- La tarjeta «Responsables» lee el despacho por esta RPC (FR-010). Con Ventas en lectura se ve el estado y
-- los responsables, pero sin la acción `despachar` no se puede avanzar (escenario 6 de la spec); y el
-- aislamiento por organización y por tienda es el mismo de las otras RPC del despacho.

-- Consulta tiene Ventas en lectura y NO la acción `despachar`.
select pg_temp.como('f1000000-0000-0000-0000-000000000005');

select is(
  (select public.obtener_despacho_comprobante(pg_temp.id_de('f1')) ->> 'estado_despacho'),
  'entregado', 'con Ventas en lectura se ve el estado del despacho');

select is(
  (select public.obtener_despacho_comprobante(pg_temp.id_de('f1')) ->> 'armo'),
  'deposito@example.com', 'con Ventas en lectura se ve quién armó');

select is(
  (select public.obtener_despacho_comprobante(pg_temp.id_de('f1')) ->> 'controlo'),
  'deposito-dos@example.com', 'con Ventas en lectura se ve quién controló');

select is(
  (select public.obtener_despacho_comprobante(pg_temp.id_de('f1')) ->> 'entrego'),
  'deposito-dos@example.com', 'con Ventas en lectura se ve quién entregó');

select is(
  (select (public.obtener_despacho_comprobante(pg_temp.id_de('f1')) ->> 'puede_despachar')::boolean),
  false, 'sin la acción despachar la tarjeta no ofrece avanzar');

-- Sin acceso a la tienda no se lee el despacho.
select pg_temp.como('f1000000-0000-0000-0000-000000000007');

select throws_ok(
  format($$select public.obtener_despacho_comprobante(%L)$$, pg_temp.id_de('f1')),
  '42501', null, 'quien no accede a la tienda no lee el despacho');

-- Otra organización: el comprobante no existe para esa sesión.
select pg_temp.como('f2000000-0000-0000-0000-000000000001');

select throws_ok(
  format($$select public.obtener_despacho_comprobante(%L)$$, pg_temp.id_de('f1')),
  'P0002', null, 'otra organización no lee el despacho de esta factura');

-- ============================================================================
-- FR-009 / FR-008 · Quién puede ejecutar las funciones del despacho
-- ============================================================================
-- Las RPC son de `authenticated` y `anon` no las ejecuta (T004 y T005). Las ayudas de `private` no las
-- ejecuta nadie del navegador: el descuento de las reservas «A pedido» solo pasa por
-- `cambiar_estado_despacho` y la elegibilidad de los responsables solo se consulta por las RPC.

select is(
  has_function_privilege('authenticated', 'public.listar_responsables_despacho(uuid, text)', 'EXECUTE'),
  true, 'authenticated ejecuta listar_responsables_despacho');

select is(
  has_function_privilege('anon', 'public.listar_responsables_despacho(uuid, text)', 'EXECUTE'),
  false, 'anon no ejecuta listar_responsables_despacho');

select is(
  has_function_privilege('authenticated', 'public.cambiar_estado_despacho(uuid, text, uuid, timestamptz)', 'EXECUTE'),
  true, 'authenticated ejecuta cambiar_estado_despacho');

select is(
  has_function_privilege('anon', 'public.cambiar_estado_despacho(uuid, text, uuid, timestamptz)', 'EXECUTE'),
  false, 'anon no ejecuta cambiar_estado_despacho');

select is(
  has_function_privilege('authenticated', 'public.obtener_despacho_comprobante(uuid)', 'EXECUTE'),
  true, 'authenticated ejecuta obtener_despacho_comprobante');

select is(
  has_function_privilege('anon', 'public.obtener_despacho_comprobante(uuid)', 'EXECUTE'),
  false, 'anon no ejecuta obtener_despacho_comprobante');

select is(
  has_function_privilege('authenticated', 'private.descontar_reservas_entrega(uuid)', 'EXECUTE'),
  false, 'authenticated no descuenta reservas por su cuenta: solo por la entrega');

select is(
  has_function_privilege('authenticated', 'private.responsable_despacho_habilitado(uuid, text, text)', 'EXECUTE'),
  false, 'authenticated no consulta la elegibilidad de los responsables');

select is(
  has_function_privilege('authenticated', 'private.rol_usuario_en_empresa(uuid, uuid, uuid)', 'EXECUTE'),
  false, 'authenticated no consulta el rol de otra persona');

select is(
  has_function_privilege('authenticated', 'private.puede_despachar_en_empresa(uuid)', 'EXECUTE'),
  false, 'authenticated no consulta el permiso de despacho por empresa');

select is(
  has_function_privilege('authenticated', 'private.etiqueta_estado_despacho(text)', 'EXECUTE'),
  false, 'authenticated no traduce los estados del despacho por su cuenta');

-- ============================================================================
-- MSF-598 · El despacho avanza en cualquier estado vivo de la factura (no solo «confirmada»)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select pg_temp.armar('f7');
select pg_temp.armar('f8');
select pg_temp.armar('f9');
select public.confirmar_comprobante(pg_temp.id_de('f7'));
select public.confirmar_comprobante(pg_temp.id_de('f8'));
select public.confirmar_comprobante(pg_temp.id_de('f9'));

-- Cobrada, en deuda o anulada: el estado documental/de cobro se fija directo (es independiente del despacho).
reset role;
update dominio.comprobantes_venta set estado = 'cobrado' where id = pg_temp.id_de('f7');
update dominio.comprobantes_venta set estado = 'deuda' where id = pg_temp.id_de('f8');
update dominio.comprobantes_venta set estado = 'anulada' where id = pg_temp.id_de('f9');

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select is(
  (select estado_despacho from public.cambiar_estado_despacho(
    pg_temp.id_de('f7'), 'armando', 'f1000000-0000-0000-0000-000000000002', pg_temp.actualizado('f7'))),
  'armando', 'una factura Cobrada pasa de Sin armar a Armando (MSF-598)');

select is(
  (select estado from dominio.comprobantes_venta where id = pg_temp.id_de('f7')),
  'cobrado', 'despachar no altera el estado de cobro');

select is(
  (select estado_despacho from public.cambiar_estado_despacho(
    pg_temp.id_de('f8'), 'armando', 'f1000000-0000-0000-0000-000000000002', pg_temp.actualizado('f8'))),
  'armando', 'una factura en Deuda también se despacha (MSF-598)');

select throws_ok(
  format($$select public.cambiar_estado_despacho(%L, 'armando', 'f1000000-0000-0000-0000-000000000002', %L::timestamptz)$$,
    pg_temp.id_de('f9'), pg_temp.actualizado('f9')),
  '55000', null, 'una factura Anulada no se despacha');

-- ============================================================================
-- `anon` sin acceso
-- ============================================================================

reset role;
set local role anon;

select throws_ok(
  format($$select public.cambiar_estado_despacho(%L, 'armando', 'f1000000-0000-0000-0000-000000000002', %L::timestamptz)$$,
    pg_temp.id_de('f3'), pg_temp.actualizado('f3')),
  '42501', null, 'anon no ejecuta la RPC de despacho');

select throws_ok(
  $$select public.listar_responsables_despacho('a1000000-0000-0000-0000-000000000001', 'armar')$$,
  '42501', null, 'anon no lista los responsables');

select throws_ok(
  format($$select public.obtener_despacho_comprobante(%L)$$, pg_temp.id_de('f1')),
  '42501', null, 'anon no lee el despacho');

reset role;

select * from finish();
rollback;
