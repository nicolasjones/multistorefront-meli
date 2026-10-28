-- F-VTA-29 (MSF-304, épica MSF-178, SC-003): seguimiento de RMA. Cubre FR-011 (`cambiar_estado_rma`: transición lineal sin
-- saltos, idempotencia, bloqueo optimista, evento, permisos y aislamiento) y FR-010 (filtro `p_forma_rma` de `listar_rma`
-- y `actualizado_en` en el listado). La concurrencia real (dos sesiones) no cabe en una transacción de pgTAP: se prueba el
-- conflicto con un sello vencido, que es lo que ve la segunda sesión.
-- que dejó la primera) y que la RPC toma el comprobante `for update`.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista', null);

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks');

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', null, true),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 'ARS', 500, 'c1000000-0000-0000-0000-000000000001', null, true);

insert into dominio.depositos (id, organizacion_id, nombre) values
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Local');

create temp table datos as
  select (select id from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as principal;
grant select on datos to public;

insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select d, 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'
  from (select principal as d from datos union all select 'd1000000-0000-0000-0000-000000000002'::uuid) x
on conflict do nothing;

insert into dominio.existencias (producto_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 14, 0),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 10, 0)
on conflict (producto_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;
insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000001', (select principal from datos), '11111111-1111-1111-1111-111111111111', 10, 0),
  ('b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 4, 0),
  ('b1000000-0000-0000-0000-000000000002', (select principal from datos), '11111111-1111-1111-1111-111111111111', 10, 0)
on conflict (producto_id, deposito_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table comps (clave text primary key, id uuid);
grant select, insert, update on comps to public;

create function pg_temp.armar(p_clave text, p_tipo text, p_lineas jsonb) returns void language plpgsql as $$
declare v_c dominio.comprobantes_venta;
begin
  v_c := public.crear_comprobante(p_tipo, 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-10-24');
  insert into comps (clave, id) values (p_clave, v_c.id);
  if p_lineas is not null then
    perform public.guardar_lineas_comprobante(v_c.id, p_lineas, v_c.updated_at);
  end if;
end $$;

create function pg_temp.id_de(p_clave text) returns uuid language sql as $$ select id from comps where clave = p_clave $$;
create function pg_temp.upd(p_clave text) returns timestamptz language sql security definer as $$
  select updated_at from dominio.comprobantes_venta where id = (select id from comps where clave = p_clave) $$;
create function pg_temp.linea(p_clave text, p_producto uuid, p_deposito uuid) returns uuid language sql security definer as $$
  select l.id from dominio.comprobantes_venta_lineas l
   where l.comprobante_id = (select id from comps where clave = p_clave) and l.producto_id = p_producto and l.deposito_id = p_deposito $$;
create function pg_temp.eventos(p_tipo text) returns integer language sql security definer as $$
  select count(*)::int from public.registro_actividad where tipo = p_tipo $$;
create function pg_temp.total_rma() returns integer language sql security definer as $$
  select count(*)::int from dominio.rma $$;
-- Alta de un RMA de UN ítem; devuelve el número asignado.
create function pg_temp.alta(p_clave text, p_linea uuid, p_cantidad integer, p_forma text) returns text language sql as $$
  select (public.registrar_rma(
    pg_temp.id_de(p_clave),
    jsonb_build_array(jsonb_build_object('linea_id', p_linea, 'cantidad', p_cantidad)),
    p_forma, 'No enciende', 'Observación de prueba')).numero $$;
grant execute on function pg_temp.upd(text), pg_temp.eventos(text), pg_temp.id_de(text), pg_temp.linea(text, uuid, uuid),
  pg_temp.total_rma(), pg_temp.alta(text, uuid, integer, text) to public;

-- ============================================================================
-- Armado: las facturas las vende el Operador (ventas en edición)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

-- P: Joystick 2 del principal + 2 de Local + Cable 2 del principal. Q: otra factura. R: anulada.
select pg_temp.armar('P', 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 2, 'deposito_id', (select principal from datos)),
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 2, 'deposito_id', 'd1000000-0000-0000-0000-000000000002'),
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000002', 'cantidad', 2, 'deposito_id', (select principal from datos))));
select pg_temp.armar('Q', 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000002', 'cantidad', 1, 'deposito_id', (select principal from datos))));
select pg_temp.armar('R', 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000002', 'cantidad', 1, 'deposito_id', (select principal from datos))));
select pg_temp.armar('borrador', 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000002', 'cantidad', 1, 'deposito_id', (select principal from datos))));
select pg_temp.armar('presupuesto', 'presupuesto', null);

select public.confirmar_comprobante(pg_temp.id_de(k)) from unnest(array['P', 'Q', 'R']) k;

select pg_temp.como('f1000000-0000-0000-0000-000000000001');

-- ============================================================================
-- Datos: cuatro RMA de formas distintas sobre la factura P
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.alta('P', pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000001', (select principal from datos)), 1, 'cambio_directo');
select pg_temp.alta('P', pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002'), 1, 'enviado_a_proveedor');
select pg_temp.alta('P', pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000002', (select principal from datos)), 1, 'faltante_envio');
select pg_temp.alta('Q', pg_temp.linea('Q', 'b1000000-0000-0000-0000-000000000002', (select principal from datos)), 1, 'devolucion_importe');

create function pg_temp.rma_id(p_numero text) returns uuid language sql security definer as $$
  select id from dominio.rma where numero = p_numero $$;
create function pg_temp.sello(p_numero text) returns timestamptz language sql security definer as $$
  select actualizado_en from dominio.rma where numero = p_numero $$;
create function pg_temp.estado(p_numero text) returns text language sql security definer as $$
  select estado from dominio.rma where numero = p_numero $$;
create function pg_temp.evento(p_columna text) returns text language plpgsql security definer as $$
declare v text;
begin
  execute format('select %I::text from public.registro_actividad where tipo = ''rma.estado_cambiado'' order by creado_en limit 1', p_columna) into v;
  return v;
end $$;
grant execute on function pg_temp.rma_id(text), pg_temp.sello(text), pg_temp.estado(text), pg_temp.evento(text) to public;

-- ============================================================================
-- Permisos de la función
-- ============================================================================

select is(has_function_privilege('anon', 'public.cambiar_estado_rma(uuid,text,timestamptz)', 'execute'), false, 'anon no ejecuta cambiar_estado_rma');
select is(has_function_privilege('authenticated', 'public.cambiar_estado_rma(uuid,text,timestamptz)', 'execute'), true, 'authenticated ejecuta cambiar_estado_rma');

-- ============================================================================
-- FR-011 · Transición válida: abierto → en_gestión → cerrado
-- ============================================================================

select is((select estado from public.cambiar_estado_rma(pg_temp.rma_id('RMA-0001'), 'en_gestion', pg_temp.sello('RMA-0001'))),
  'en_gestion', 'abierto pasa a en_gestion');
select is(pg_temp.estado('RMA-0001'), 'en_gestion', 'el estado quedó guardado');
select is(pg_temp.eventos('rma.estado_cambiado'), 1, 'el cambio registró un evento');
select is(pg_temp.evento('detalle'),
  'Pasó la devolución RMA-0001 de Abierta a En gestión', 'el evento dice desde, hasta y qué devolución');
select is(pg_temp.evento('empresa_id'),
  'a1000000-0000-0000-0000-000000000001', 'el evento lleva la tienda');
select is(pg_temp.evento('actor_id'),
  'f1000000-0000-0000-0000-000000000002', 'el evento lleva quién lo hizo');

select is((select estado from public.cambiar_estado_rma(pg_temp.rma_id('RMA-0001'), 'cerrado', pg_temp.sello('RMA-0001'))),
  'cerrado', 'en_gestion pasa a cerrado');
select is(pg_temp.eventos('rma.estado_cambiado'), 2, 'el segundo cambio registró otro evento');

-- ============================================================================
-- Transición inválida (sin saltos ni retrocesos)
-- ============================================================================

select throws_ok(format($$select public.cambiar_estado_rma(%L, 'cerrado', %L)$$, pg_temp.rma_id('RMA-0002'), pg_temp.sello('RMA-0002')),
  '22023', null, 'no se salta de abierto a cerrado');
select throws_ok(format($$select public.cambiar_estado_rma(%L, 'abierto', %L)$$, pg_temp.rma_id('RMA-0001'), pg_temp.sello('RMA-0001')),
  '22023', null, 'no se reabre una devolución cerrada');
select is(pg_temp.estado('RMA-0002'), 'abierto', 'la transición inválida no cambió el estado');
select throws_ok(format($$select public.cambiar_estado_rma(%L, 'otro', %L)$$, pg_temp.rma_id('RMA-0002'), pg_temp.sello('RMA-0002')),
  '22023', null, 'un estado desconocido se rechaza');
select throws_ok(format($$select public.cambiar_estado_rma(%L, null, %L)$$, pg_temp.rma_id('RMA-0002'), pg_temp.sello('RMA-0002')),
  '22023', null, 'un estado vacío se rechaza');
select is(pg_temp.eventos('rma.estado_cambiado'), 2, 'los rechazos no registran eventos');

-- ============================================================================
-- Idempotencia y bloqueo optimista
-- ============================================================================

select is((select estado from public.cambiar_estado_rma(pg_temp.rma_id('RMA-0001'), 'cerrado', pg_temp.sello('RMA-0001'))),
  'cerrado', 'repetir el mismo estado devuelve el actual');
select is((select estado from public.cambiar_estado_rma(pg_temp.rma_id('RMA-0001'), 'cerrado', '2000-01-01T00:00:00Z')),
  'cerrado', 'un reintento con sello vencido tampoco es un conflicto');
select is(pg_temp.eventos('rma.estado_cambiado'), 2, 'el reintento no duplica eventos');

select throws_ok(format($$select public.cambiar_estado_rma(%L, 'en_gestion', '2000-01-01T00:00:00Z')$$, pg_temp.rma_id('RMA-0002')),
  '40001', null, 'un sello vencido es un conflicto');
select throws_ok(format($$select public.cambiar_estado_rma(%L, 'en_gestion', null)$$, pg_temp.rma_id('RMA-0002')),
  '40001', null, 'sin sello es un conflicto');
select is(pg_temp.estado('RMA-0002'), 'abierto', 'el conflicto no cambió el estado');
select throws_ok($$select public.cambiar_estado_rma('00000000-0000-0000-0000-000000000000', 'en_gestion', now())$$,
  'P0002', null, 'un RMA inexistente se rechaza');
select ok((select actualizado_en from public.cambiar_estado_rma(pg_temp.rma_id('RMA-0003'), 'en_gestion', pg_temp.sello('RMA-0003')))
  > '2026-01-01', 'el cambio renueva el sello de bloqueo');

-- ============================================================================
-- FR-010 · Filtro por forma y sello en el listado
-- ============================================================================

select is((select count(*)::int from public.listar_rma(p_forma_rma => 'cambio_directo')), 1, 'filtro por forma: cambio directo');
select is((select numero from public.listar_rma(p_forma_rma => 'enviado_a_proveedor')), 'RMA-0002', 'filtro por forma: enviado a proveedor');
select is((select count(*)::int from public.listar_rma(p_forma_rma => 'faltante_envio')), 1, 'filtro por forma: faltante en envío');
select is((select count(*)::int from public.listar_rma(p_forma_rma => 'reclamo_faltante')), 0, 'filtro por forma sin coincidencias');
select is((select filas from public.listar_rma(p_forma_rma => 'devolucion_importe')), 1::bigint, '`filas` cuenta el filtro por forma');
select is((select count(*)::int from public.listar_rma()), 4, 'sin filtro trae las cuatro formas');
select is((select actualizado_en from public.listar_rma(p_busqueda => 'RMA-0001')), pg_temp.sello('RMA-0001'), 'el listado trae el sello de bloqueo');
select is((select estado from public.listar_rma(p_busqueda => 'RMA-0001')), 'cerrado', 'el listado refleja el estado nuevo');
select is((select count(*)::int from public.listar_rma(p_estado => 'en_gestion')), 2, 'filtro por estado en gestión');

-- ============================================================================
-- Permisos y aislamiento
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select throws_ok(format($$select public.cambiar_estado_rma(%L, 'en_gestion', %L)$$, pg_temp.rma_id('RMA-0004'), pg_temp.sello('RMA-0004')),
  '42501', null, 'Consulta (ventas en lectura) no cambia el estado');
select is(pg_temp.estado('RMA-0004'), 'abierto', 'el rechazo por permiso no cambió el estado');

select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select throws_ok(format($$select public.cambiar_estado_rma(%L, 'en_gestion', %L)$$, pg_temp.rma_id('RMA-0004'), pg_temp.sello('RMA-0004')),
  'P0002', null, 'otra organización no ve ni cambia el RMA');
select is(pg_temp.estado('RMA-0004'), 'abierto', 'otra organización no alteró el estado');

reset role;
select throws_ok(format($$set local role anon; select public.cambiar_estado_rma(%L, 'en_gestion', now())$$, pg_temp.rma_id('RMA-0004')),
  '42501', null, 'anon no cambia el estado');
reset role;

select * from finish();
rollback;
