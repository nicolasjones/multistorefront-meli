-- F-VTA-15 (MSF-152, épica MSF-135, spec 20261024-130000-ventas-despacho-y-faltantes): la entrega del despacho.
--
-- Cubre SC-002 (verifica FR-007): al entregar una factura `listo_para_despachar`, las reservas «A pedido» de sus
-- líneas quedan descontadas; todo o nada si una falla; el reintento no descuenta dos veces; las líneas de stock
-- normal no se vuelven a tocar; un presupuesto no entra al despacho.
--
-- La máquina de estados completa (roles de Armó/Controló/Entregó, excepción del Administrador, conflicto 40001,
-- permisos por rol, `anon` y aislamiento entre organizaciones) es de T006 (`despacho_estados.test.sql`).
begin;

select no_plan();

-- ============================================================================
-- Datos: organización, personas, tienda, productos y existencias
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'armador@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'controlador@example.com'),
  ('f1000000-0000-0000-0000-000000000004', 'consulta@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo'),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');

-- La empresa activa de cada uno: `ventas` se resuelve por empresa.
insert into public.usuario_empresa_activa (user_id, empresa_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Despacho', 'minorista', null);

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks');

-- P1 es de stock normal; P2 y P3 son «A pedido» (reservan al confirmar y se descuentan al entregar).
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', null, true),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Consola', 'CON-1', 'ARS', 2000, 'c1000000-0000-0000-0000-000000000001', 'a_pedido', true),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Cámara', 'CAM-1', 'ARS', 3000, 'c1000000-0000-0000-0000-000000000001', 'a_pedido', true);

create temp table datos as
  select (select id from dominio.depositos
           where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as principal;
grant select on datos to public;

insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select principal, 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'
  from datos;

insert into dominio.existencias (producto_id, organizacion_id, cantidad, reservado)
select p, '11111111-1111-1111-1111-111111111111', c, 0
  from (values
    ('b1000000-0000-0000-0000-000000000001'::uuid, 10),
    ('b1000000-0000-0000-0000-000000000002'::uuid, 6),
    ('b1000000-0000-0000-0000-000000000003'::uuid, 4)
  ) as x(p, c);

insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado)
select p, principal, '11111111-1111-1111-1111-111111111111', c, 0
  from (values
    ('b1000000-0000-0000-0000-000000000001'::uuid, 10),
    ('b1000000-0000-0000-0000-000000000002'::uuid, 6),
    ('b1000000-0000-0000-0000-000000000003'::uuid, 4)
  ) as x(p, c), datos;

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
grant select, insert, update on comps to public;

-- `updated_at` con el que se pidió cada transición: el reintento repite el mismo payload original.
create temp table marcas (clave text primary key, actualizado timestamptz);
grant select, insert on marcas to public;

-- Crea un comprobante con sus líneas, como el administrador (Ventas en edición).
create function pg_temp.armar(p_clave text, p_tipo text, p_lineas jsonb) returns void language plpgsql as $$
declare v_c dominio.comprobantes_venta;
begin
  v_c := public.crear_comprobante(
    p_tipo, 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-12-14');
  insert into comps (clave, id) values (p_clave, v_c.id);
  if p_lineas is not null then
    perform public.guardar_lineas_comprobante(v_c.id, p_lineas, v_c.updated_at);
  end if;
end $$;

create function pg_temp.id_de(p_clave text) returns uuid language sql as $$
  select id from comps where clave = p_clave $$;

-- `updated_at` vigente: es el bloqueo optimista de `cambiar_estado_despacho`.
create function pg_temp.actualizado(p_clave text) returns timestamptz language sql security definer as $$
  select updated_at from dominio.comprobantes_venta where id = (select id from comps where clave = p_clave) $$;

-- Existencias del producto en el depósito principal: «cantidad/reservado».
create function pg_temp.disp(p_producto uuid) returns text language sql security definer as $$
  select cantidad || '/' || reservado
    from dominio.existencias_deposito
   where producto_id = p_producto and deposito_id = (select principal from datos) $$;

-- ============================================================================
-- La factura que se entrega: una línea de stock normal y una «A pedido»
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');

select pg_temp.armar('entrega', 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 3),
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000002', 'cantidad', 2)));

select is(
  (select estado from public.confirmar_comprobante(pg_temp.id_de('entrega'))),
  'confirmada', 'la factura quedó confirmada');

select is(
  (select estado_despacho from dominio.comprobantes_venta where id = pg_temp.id_de('entrega')),
  'sin_armar', 'sin forma de envío, la factura arranca Sin armar');

select is(pg_temp.disp('b1000000-0000-0000-0000-000000000001'), '7/0', 'la línea de stock normal se descontó al confirmar');
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000002'), '6/2', 'la línea «A pedido» reservó 2 sin descontar');
select is(
  (select estado from dominio.reservas_stock
    where referencia = 'comprobante:' || pg_temp.id_de('entrega') || ':linea:2'),
  'activa', 'la reserva «A pedido» queda activa con la referencia del comprobante y la línea');

-- ============================================================================
-- Armado, control y entrega (FR-006, FR-007)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select is(
  (select estado_despacho from public.cambiar_estado_despacho(
     pg_temp.id_de('entrega'), 'armando', 'f1000000-0000-0000-0000-000000000002', pg_temp.actualizado('entrega'))),
  'armando', 'Depósito arma el pedido');

select pg_temp.como('f1000000-0000-0000-0000-000000000003');

select is(
  (select estado_despacho from public.cambiar_estado_despacho(
     pg_temp.id_de('entrega'), 'listo_para_despachar', 'f1000000-0000-0000-0000-000000000003', pg_temp.actualizado('entrega'))),
  'listo_para_despachar', 'otro Depósito controla el pedido');

-- Se guarda el `updated_at` de la entrega para repetir exactamente el mismo pedido en el reintento.
insert into marcas values ('entrega', pg_temp.actualizado('entrega'));

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select is(
  (select estado_despacho from public.cambiar_estado_despacho(
     pg_temp.id_de('entrega'), 'entregado', 'f1000000-0000-0000-0000-000000000002',
     (select actualizado from marcas where clave = 'entrega'))),
  'entregado', 'el Depósito entrega el pedido');

select is(
  (select estado_despacho from dominio.comprobantes_venta where id = pg_temp.id_de('entrega')),
  'entregado', 'la factura quedó entregada');

select is(
  (select entrego_id from dominio.comprobantes_venta where id = pg_temp.id_de('entrega')),
  'f1000000-0000-0000-0000-000000000002', 'la entrega registra quién entregó');

select ok(
  (select entregado_en is not null from dominio.comprobantes_venta where id = pg_temp.id_de('entrega')),
  'la entrega deja el momento de la entrega');

select is(
  (select estado from dominio.reservas_stock
    where referencia = 'comprobante:' || pg_temp.id_de('entrega') || ':linea:2'),
  'descontada', 'la reserva «A pedido» quedó descontada');

select is(pg_temp.disp('b1000000-0000-0000-0000-000000000002'), '4/0', 'la reserva se descontó del depósito (6 − 2)');

select is(pg_temp.disp('b1000000-0000-0000-0000-000000000001'), '7/0', 'las líneas de stock normal no se vuelven a tocar');

select is(
  (select count(*)::int from dominio.movimientos_stock
    where producto_id = 'b1000000-0000-0000-0000-000000000001'),
  1, 'el stock normal no tuvo un movimiento nuevo: solo el de la confirmación');

select is(
  (select count(*)::int from dominio.movimientos_stock
    where producto_id = 'b1000000-0000-0000-0000-000000000002' and tipo = 'salida'),
  1, 'la entrega dejó una sola salida en el libro');

select is(
  (select count(*)::int from public.registro_actividad where tipo = 'despacho.estado_cambiado'),
  3, 'las tres transiciones quedaron en la actividad');

-- ============================================================================
-- Reintento idempotente (FR-003): la entrega repetida no descuenta dos veces
-- ============================================================================

select lives_ok(
  format($$select public.cambiar_estado_despacho(%L, 'entregado', 'f1000000-0000-0000-0000-000000000002', %L::timestamptz)$$,
    pg_temp.id_de('entrega'), (select actualizado from marcas where clave = 'entrega')),
  'reintentar la entrega no falla');

select is(pg_temp.disp('b1000000-0000-0000-0000-000000000002'), '4/0', 'el reintento no descuenta la reserva otra vez');

select is(
  (select count(*)::int from dominio.movimientos_stock
    where producto_id = 'b1000000-0000-0000-0000-000000000002' and tipo = 'salida'),
  1, 'el reintento no repite el movimiento de stock');

select is(
  (select count(*)::int from public.registro_actividad where tipo = 'despacho.estado_cambiado'),
  3, 'el reintento no repite la actividad');

-- ============================================================================
-- Todo o nada (FR-007): si una reserva no está activa, no se entrega nada
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');

select pg_temp.armar('parcial', 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000002', 'cantidad', 1),
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000003', 'cantidad', 1)));

select is(
  (select estado from public.confirmar_comprobante(pg_temp.id_de('parcial'))),
  'confirmada', 'la segunda factura quedó confirmada');

select is(pg_temp.disp('b1000000-0000-0000-0000-000000000002'), '4/1', 'la primera entrega descontó 2 y la segunda reserva 1');
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000003'), '4/1', 'la cámara quedó reservada');

-- La reserva de la segunda línea se libera (puede pasar en la operación): la entrega ya no puede completarse.
select is(
  (select estado from public.liberar_reserva(
     (select id from dominio.reservas_stock
       where referencia = 'comprobante:' || pg_temp.id_de('parcial') || ':linea:2'))),
  'liberada', 'la reserva de la segunda línea se liberó');

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(
  (select estado_despacho from public.cambiar_estado_despacho(
     pg_temp.id_de('parcial'), 'armando', 'f1000000-0000-0000-0000-000000000002', pg_temp.actualizado('parcial'))),
  'armando', 'la segunda factura se arma');

select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select is(
  (select estado_despacho from public.cambiar_estado_despacho(
     pg_temp.id_de('parcial'), 'listo_para_despachar', 'f1000000-0000-0000-0000-000000000003', pg_temp.actualizado('parcial'))),
  'listo_para_despachar', 'la segunda factura queda lista para despachar');

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select throws_ok(
  format($$select public.cambiar_estado_despacho(%L, 'entregado', 'f1000000-0000-0000-0000-000000000002', %L::timestamptz)$$,
    pg_temp.id_de('parcial'), pg_temp.actualizado('parcial')),
  '22023', null, 'no se entrega si alguna reserva no está activa');

select is(
  (select estado_despacho from dominio.comprobantes_venta where id = pg_temp.id_de('parcial')),
  'listo_para_despachar', 'todo o nada: la factura no se entregó');

select is(
  (select entregado_en from dominio.comprobantes_venta where id = pg_temp.id_de('parcial')),
  null, 'todo o nada: no quedó fecha de entrega');

select is(
  (select estado from dominio.reservas_stock
    where referencia = 'comprobante:' || pg_temp.id_de('parcial') || ':linea:1'),
  'activa', 'todo o nada: la reserva de la primera línea no se descontó');

select is(pg_temp.disp('b1000000-0000-0000-0000-000000000002'), '4/1', 'todo o nada: el stock de la primera línea no se tocó');

select is(
  (select count(*)::int from dominio.movimientos_stock
    where producto_id = 'b1000000-0000-0000-0000-000000000002' and tipo = 'salida'),
  1, 'todo o nada: no quedó ninguna salida nueva por la entrega fallida');

-- ============================================================================
-- Un presupuesto no entra al despacho
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');

select pg_temp.armar('presupuesto', 'presupuesto', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000002', 'cantidad', 1)));

select throws_ok(
  format($$select public.cambiar_estado_despacho(%L, 'entregado', 'f1000000-0000-0000-0000-000000000002', %L::timestamptz)$$,
    pg_temp.id_de('presupuesto'), pg_temp.actualizado('presupuesto')),
  '22023', null, 'un presupuesto no se entrega');

select is(
  (select estado_despacho from dominio.comprobantes_venta where id = pg_temp.id_de('presupuesto')),
  null, 'el presupuesto no tiene estado de despacho');

-- ============================================================================
-- Sin la acción `despachar` no se entrega
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000004');

select throws_ok(
  format($$select public.cambiar_estado_despacho(%L, 'entregado', 'f1000000-0000-0000-0000-000000000002', %L::timestamptz)$$,
    pg_temp.id_de('entrega'), pg_temp.actualizado('entrega')),
  '42501', null, 'Consulta (sin la acción despachar) no entrega');

reset role;
set local role anon;
select throws_ok(
  format($$select public.cambiar_estado_despacho(%L, 'entregado', 'f1000000-0000-0000-0000-000000000002', %L::timestamptz)$$,
    pg_temp.id_de('entrega'), pg_temp.actualizado('entrega')),
  '42501', null, 'anon no ejecuta la RPC de despacho');
reset role;

select * from finish();
rollback;
