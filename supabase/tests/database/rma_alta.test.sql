-- F-VTA-28 (MSF-288, épica MSF-178, SC-001): alta y listado de RMA. Cubre FR-001 (tablas con RLS, `check` de formas y
-- estados, sin escritura directa), FR-002 (`registrar_rma`: cantidad excedida, comprobante inválido, permisos,
-- numeración correlativa, evento, aislamiento) y FR-006 (`listar_rma`: columnas, filtros, paginación, aislamiento).
-- La concurrencia real (dos sesiones) no cabe en una transacción de pgTAP: se prueba la serie (la segunda alta ve lo
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
select public.anular_comprobante(pg_temp.id_de('R'), 'Error de carga', pg_temp.upd('R'));

-- ============================================================================
-- FR-001 · Tablas: RLS, sin escritura directa, anon sin privilegios
-- ============================================================================

select is((select relrowsecurity from pg_class where oid = 'dominio.rma'::regclass), true, 'dominio.rma tiene RLS');
select is((select relrowsecurity from pg_class where oid = 'dominio.rma_items'::regclass), true, 'dominio.rma_items tiene RLS');
select is(has_table_privilege('anon', 'dominio.rma', 'select'), false, 'anon no lee rma');
select is(has_table_privilege('anon', 'dominio.rma_items', 'select'), false, 'anon no lee rma_items');
select is(has_table_privilege('authenticated', 'dominio.rma', 'insert'), false, 'authenticated no inserta en rma');
select is(has_table_privilege('authenticated', 'dominio.rma', 'update'), false, 'authenticated no actualiza rma');
select is(has_table_privilege('authenticated', 'dominio.rma_items', 'insert'), false, 'authenticated no inserta en rma_items');
select is(has_table_privilege('authenticated', 'dominio.rma', 'select'), true, 'authenticated lee rma (filtrado por RLS)');

select is(has_function_privilege('anon', 'public.registrar_rma(uuid,jsonb,text,text,text)', 'execute'), false, 'anon no registra RMA');
select is(has_function_privilege('authenticated', 'public.registrar_rma(uuid,jsonb,text,text,text)', 'execute'), true, 'authenticated ejecuta registrar_rma');
select is(has_function_privilege('anon', 'public.listar_rma(text,text,text,uuid,integer,integer)', 'execute'), false, 'anon no lista RMA');
select is(has_function_privilege('authenticated', 'public.listar_rma(text,text,text,uuid,integer,integer)', 'execute'), true, 'authenticated ejecuta listar_rma');
select is(has_function_privilege('anon', 'private.listar_rma_sesion(text,text,text,uuid,integer,integer)', 'execute'), false, 'anon no ejecuta el puente del listado');

-- `check` de formas y estados (se prueban con el rol dueño: el check manda aunque se escriba directo).
reset role;
select throws_ok(
  $$insert into dominio.rma (organizacion_id, empresa_id, comprobante_id, numero, forma_rma, motivo)
    select organizacion_id, empresa_id, id, 'RMA-9001', 'otra_forma', 'x' from dominio.comprobantes_venta limit 1$$,
  '23514', null, 'la forma de RMA debe ser una de las cinco');
select throws_ok(
  $$insert into dominio.rma (organizacion_id, empresa_id, comprobante_id, numero, forma_rma, motivo, estado)
    select organizacion_id, empresa_id, id, 'RMA-9002', 'cambio_directo', 'x', 'otro' from dominio.comprobantes_venta limit 1$$,
  '23514', null, 'el estado debe ser abierto, en_gestion o cerrado');

-- Sin escritura directa para authenticated.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$insert into dominio.rma (organizacion_id, empresa_id, comprobante_id, numero, forma_rma, motivo)
    select organizacion_id, empresa_id, id, 'RMA-9003', 'cambio_directo', 'x' from dominio.comprobantes_venta limit 1$$,
  '42501', null, 'el Operador no escribe rma directo');

-- ============================================================================
-- FR-002 · Permisos verificados en la RPC
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select throws_ok(
  format($$select pg_temp.alta('P', %L, 1, 'cambio_directo')$$, pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000002', (select principal from datos))),
  '42501', null, 'Consulta (ventas en lectura) no registra devoluciones');
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select throws_ok(
  format($$select pg_temp.alta('P', %L, 1, 'cambio_directo')$$, pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000002', (select principal from datos))),
  'P0002', null, 'otra organización no ve la factura: no existe para ella');
select is(pg_temp.total_rma(), 0, 'sin permiso no se creó ningún RMA');

-- ============================================================================
-- FR-002 · Validaciones de entrada y de estado
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select throws_ok(
  format($$select pg_temp.alta('P', %L, 1, 'otra')$$, pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000002', (select principal from datos))),
  '22023', 'Elegí la forma de RMA', 'la forma debe ser una de las cinco');
select throws_ok(
  format($$select public.registrar_rma(%L, %L::jsonb, 'cambio_directo', '   ')$$, pg_temp.id_de('P'),
    jsonb_build_array(jsonb_build_object('linea_id', pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000002', (select principal from datos)), 'cantidad', 1))::text),
  '22023', 'Escribí el motivo de la devolución', 'el motivo es obligatorio');
select throws_ok(format($$select public.registrar_rma(%L, '[]'::jsonb, 'cambio_directo', 'Falla')$$, pg_temp.id_de('P')),
  '22023', 'Elegí el ítem a devolver', 'los ítems no pueden ir vacíos');
select throws_ok(
  format($$select pg_temp.alta('P', %L, 0, 'cambio_directo')$$, pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000002', (select principal from datos))),
  '22023', null, 'la cantidad es de al menos 1');
select throws_ok(
  format($$select pg_temp.alta('P', %L, 1, 'cambio_directo')$$, pg_temp.linea('Q', 'b1000000-0000-0000-0000-000000000002', (select principal from datos))),
  '22023', null, 'una línea de otra factura se rechaza');
select throws_ok(
  format($$select public.registrar_rma(%L, '[{"linea_id": "no-es-uuid", "cantidad": 1}]'::jsonb, 'cambio_directo', 'Falla')$$, pg_temp.id_de('P')),
  '22023', null, 'una línea con identificador inválido se rechaza');
select throws_ok(
  format($$select pg_temp.alta('borrador', %L, 1, 'cambio_directo')$$, pg_temp.linea('borrador', 'b1000000-0000-0000-0000-000000000002', (select principal from datos))),
  '55000', null, 'una factura en borrador no admite RMA');
select throws_ok(
  format($$select pg_temp.alta('R', %L, 1, 'cambio_directo')$$, pg_temp.linea('R', 'b1000000-0000-0000-0000-000000000002', (select principal from datos))),
  '55000', null, 'una factura anulada no admite RMA');
select throws_ok(
  format($$select public.registrar_rma(%L, '[{"linea_id": "c0000000-0000-0000-0000-000000000000", "cantidad": 1}]'::jsonb, 'cambio_directo', 'Falla')$$, pg_temp.id_de('presupuesto')),
  '22023', null, 'un presupuesto no admite RMA');
select throws_ok(
  $$select public.registrar_rma('c0000000-0000-0000-0000-00000000dead', '[{"linea_id": "c0000000-0000-0000-0000-000000000000", "cantidad": 1}]'::jsonb, 'cambio_directo', 'Falla')$$,
  'P0002', null, 'un comprobante inexistente se rechaza');
select is(pg_temp.total_rma(), 0, 'ninguna validación fallida dejó rastro');

-- ============================================================================
-- FR-002 · Alta, numeración correlativa, tope por línea, evento
-- ============================================================================

-- Línea de 2 joysticks del principal: se devuelve 1 (RMA-0001), 2 se rechaza, 1 más entra (RMA-0003) y la tercera no.
select is(pg_temp.alta('P', pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000001', (select principal from datos)), 1, 'cambio_directo'),
  'RMA-0001', 'el primer RMA es RMA-0001');
select is(pg_temp.alta('P', pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000002', (select principal from datos)), 2, 'devolucion_importe'),
  'RMA-0002', 'el segundo es RMA-0002 (correlativo)');
select throws_ok(
  format($$select pg_temp.alta('P', %L, 2, 'cambio_directo')$$, pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000001', (select principal from datos))),
  'P0001', null, 'no se devuelven más unidades que las vendidas: ya se devolvió 1 de 2');
select throws_ok(
  format($$select pg_temp.alta('P', %L, 1, 'cambio_directo')$$, pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000002', (select principal from datos))),
  'P0001', null, 'una línea totalmente devuelta no admite otro RMA');
select is(pg_temp.total_rma(), 2, 'los rechazos por cantidad no crearon nada');
select is(pg_temp.alta('P', pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000001', (select principal from datos)), 1, 'faltante_envio'),
  'RMA-0003', 'el rechazo no consumió número: sigue RMA-0003');
select throws_ok(
  format($$select pg_temp.alta('P', %L, 1, 'cambio_directo')$$, pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000001', (select principal from datos))),
  'P0001', null, 'completado el tope de la línea, no entra otra unidad');
select is(pg_temp.alta('P', pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002'), 2, 'reclamo_faltante'),
  'RMA-0004', 'el tope es por línea: la del depósito Local admite sus 2');

select is(pg_temp.eventos('rma.registrada'), 4, 'cada alta dejó su evento rma.registrada');

-- Contenido del RMA registrado.
select is((select r.estado from dominio.rma r where r.numero = 'RMA-0001'), 'abierto', 'nace abierto');
select is((select r.empresa_id from dominio.rma r where r.numero = 'RMA-0001'), 'a1000000-0000-0000-0000-000000000001'::uuid, 'la empresa es la del comprobante');
select is((select r.operador_id from dominio.rma r where r.numero = 'RMA-0001'), 'f1000000-0000-0000-0000-000000000002'::uuid, 'el operador es quien registró');
select is((select r.observaciones from dominio.rma r where r.numero = 'RMA-0001'), 'Observación de prueba', 'guarda las observaciones');
select is((select i.cantidad from dominio.rma_items i join dominio.rma r on r.id = i.rma_id where r.numero = 'RMA-0002'), 2, 'el ítem guarda la cantidad');
select is((select count(*)::int from dominio.rma_items), 4, 'un ítem por RMA');

-- ============================================================================
-- FR-006 · Listado: columnas, filtros, paginación
-- ============================================================================

select is((select count(*)::int from public.listar_rma()), 4, 'el listado trae los cuatro RMA');
select is((select filas from public.listar_rma() limit 1), 4::bigint, '`filas` es el total del filtro');
select is((select numero from public.listar_rma() limit 1), 'RMA-0004', 'orden estable: el más reciente primero');
select is((select cliente from public.listar_rma() where numero = 'RMA-0002'), 'Cliente Uno', 'trae el cliente');
select is((select empresa from public.listar_rma() where numero = 'RMA-0002'), 'San Javucho', 'trae la tienda');
select is((select cantidad from public.listar_rma() where numero = 'RMA-0002'), 2::bigint, 'trae la cantidad');
select ok((select producto from public.listar_rma() where numero = 'RMA-0002') like 'Cable%', 'trae el producto');
select is((select comprobante_id from public.listar_rma() where numero = 'RMA-0002'), pg_temp.id_de('P'), 'trae el comprobante para el enlace');
select ok((select comprobante_numero from public.listar_rma() where numero = 'RMA-0002') is not null, 'trae el número del comprobante');
select is((select motivo from public.listar_rma() where numero = 'RMA-0002'), 'No enciende', 'trae el motivo');
select is((select estado from public.listar_rma() where numero = 'RMA-0002'), 'abierto', 'trae el estado');

select is((select count(*)::int from public.listar_rma(p_forma_rma => 'cambio_directo')), 1, 'filtro por forma');
select is((select numero from public.listar_rma(p_forma_rma => 'cambio_directo')), 'RMA-0001', 'el filtro de forma trae el RMA correcto');
select is((select count(*)::int from public.listar_rma(p_estado => 'cerrado')), 0, 'filtro por estado sin coincidencias');
select is((select count(*)::int from public.listar_rma(p_estado => 'abierto')), 4, 'filtro por estado abierto');
select is((select count(*)::int from public.listar_rma(p_empresa_id => 'a1000000-0000-0000-0000-000000000001')), 4, 'filtro por tienda');
select is((select count(*)::int from public.listar_rma(p_empresa_id => 'a2000000-0000-0000-0000-000000000001')), 0, 'una tienda ajena devuelve cero filas, sin error');
select throws_ok($$select * from public.listar_rma(p_forma_rma => 'otra')$$, '22023', null, 'una forma desconocida se rechaza');
select throws_ok($$select * from public.listar_rma(p_estado => 'otro')$$, '22023', null, 'un estado desconocido se rechaza');

select is((select count(*)::int from public.listar_rma(p_busqueda => 'rma-0002')), 1, 'búsqueda por número de RMA, sin mayúsculas');
select is((select count(*)::int from public.listar_rma(p_busqueda => '  cliente uno ')), 4, 'búsqueda por cliente, sin espacios sobrantes');
select is((select count(*)::int from public.listar_rma(p_busqueda => 'joystick')), 3, 'búsqueda por producto');
select is((select count(*)::int from public.listar_rma(p_busqueda => '%')), 0, 'el comodín % se busca como texto literal');

select is((select count(*)::int from public.listar_rma(p_pagina => 1, p_tamano => 3)), 3, 'primera página de tres');
select is((select count(*)::int from public.listar_rma(p_pagina => 2, p_tamano => 3)), 1, 'segunda página con el resto');
select is((select numero from public.listar_rma(p_pagina => 2, p_tamano => 3)), 'RMA-0001', 'la segunda página sigue el orden');
select is((select filas from public.listar_rma(p_pagina => 2, p_tamano => 3)), 4::bigint, 'filas es el total aun en la segunda página');
select is((select count(*)::int from public.listar_rma(p_pagina => 9, p_tamano => 3)), 0, 'una página fuera de rango no devuelve filas');

-- ============================================================================
-- Aislamiento
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.listar_rma()), 4, 'Consulta (ventas en lectura) ve el listado');
select is((select count(*)::int from dominio.rma), 4, 'Consulta lee rma por RLS');

select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.listar_rma()), 0, 'otra organización no ve los RMA');
select is((select count(*)::int from dominio.rma), 0, 'otra organización no lee rma');
select is((select count(*)::int from dominio.rma_items), 0, 'otra organización no lee rma_items');

reset role;
select throws_ok($$set local role anon; select * from public.listar_rma()$$, '42501', null, 'anon no ejecuta el listado');
reset role;

select * from finish();
rollback;
