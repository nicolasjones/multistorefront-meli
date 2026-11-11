-- F-VTA-30 (MSF-320, épica MSF-178, SC-005, SC-006): RMA con nota de crédito y stock. Cubre FR-020 (columna y FK compuesta de
-- `nota_credito_id`), FR-021 (`vincular_nota_credito_rma`: nota emitida con la firma de F-VTA-11, vínculo, cierre, evento,
-- idempotencia, permiso, aislamiento), FR-022 (`reingresar_stock_rma`: entradas por depósito con motivo «Devolución» y nota
-- del RMA, sin stock negativo, idempotencia, permiso, aislamiento) y FR-023 (el listado trae el vínculo). La concurrencia real
-- (dos sesiones) no cabe en una transacción de pgTAP: se prueba la serie (el segundo pedido ve lo que dejó el primero).
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


create function pg_temp.rma_id(p_numero text) returns uuid language sql security definer as $$
  select id from dominio.rma where numero = p_numero $$;
create function pg_temp.estado(p_numero text) returns text language sql security definer as $$
  select estado from dominio.rma where numero = p_numero $$;
create function pg_temp.nota_de(p_numero text) returns uuid language sql security definer as $$
  select nota_credito_id from dominio.rma where numero = p_numero $$;
create function pg_temp.reingresado(p_numero text) returns boolean language sql security definer as $$
  select stock_reingresado_en is not null from dominio.rma where numero = p_numero $$;
create function pg_temp.disp(p_producto uuid, p_deposito uuid) returns text language sql security definer as $$
  select cantidad || '/' || reservado from dominio.existencias_deposito where producto_id = p_producto and deposito_id = p_deposito $$;
create function pg_temp.notas() returns integer language sql security definer as $$
  select count(*)::int from dominio.comprobantes_venta where tipo = 'nota_credito' $$;
-- Entradas con motivo «Devolución» cuya nota es el número del RMA.
create function pg_temp.entradas(p_numero text) returns integer language sql security definer as $$
  select count(*)::int from dominio.movimientos_stock m
    join dominio.motivos_movimiento mo on mo.id = m.motivo_id and mo.organizacion_id = m.organizacion_id
   where m.tipo = 'entrada' and mo.nombre = 'Devolución' and m.nota = p_numero $$;
create function pg_temp.entradas_en(p_numero text, p_deposito uuid) returns bigint language sql security definer as $$
  select coalesce(sum(m.cantidad), 0) from dominio.movimientos_stock m
   where m.tipo = 'entrada' and m.nota = p_numero and m.deposito_id = p_deposito $$;
create function pg_temp.negativos() returns integer language sql security definer as $$
  select count(*)::int from dominio.existencias_deposito where cantidad < 0 $$;
create function pg_temp.detalle_evento(p_tipo text) returns text language sql security definer as $$
  select detalle from public.registro_actividad where tipo = p_tipo order by creado_en desc limit 1 $$;
grant execute on function pg_temp.rma_id(text), pg_temp.estado(text), pg_temp.nota_de(text), pg_temp.reingresado(text),
  pg_temp.disp(uuid, uuid), pg_temp.notas(), pg_temp.entradas(text), pg_temp.entradas_en(text, uuid), pg_temp.negativos(),
  pg_temp.detalle_evento(text) to public;

-- ============================================================================
-- Armado: la factura la vende el Operador (ventas en edición)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

-- P: Joystick 2 del principal + 2 de Local + Cable 2 del principal.
select pg_temp.armar('P', 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 2, 'deposito_id', (select principal from datos)),
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 2, 'deposito_id', 'd1000000-0000-0000-0000-000000000002'),
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000002', 'cantidad', 2, 'deposito_id', (select principal from datos))));
select public.confirmar_comprobante(pg_temp.id_de('P'));

-- Cinco RMA sobre P: 0001 y 0004 importe/productos por nota; 0002, 0003 y 0005 por reingreso.
select pg_temp.alta('P', pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000001', (select principal from datos)), 1, 'devolucion_importe');
select pg_temp.alta('P', pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002'), 2, 'cambio_directo');
select pg_temp.alta('P', pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000001', (select principal from datos)), 1, 'faltante_envio');
select pg_temp.alta('P', pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000002', (select principal from datos)), 1, 'devolucion_importe');
select pg_temp.alta('P', pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000002', (select principal from datos)), 1, 'enviado_a_proveedor');

select is(pg_temp.disp('b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002'), '2/0', 'P descontó 2 joysticks de Local');
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000002', (select principal from datos)), '8/0', 'P descontó 2 cables del principal');

-- ============================================================================
-- FR-020 · Columna y FK compuesta
-- ============================================================================

select has_column('dominio', 'rma', 'nota_credito_id', 'rma tiene nota_credito_id');
select col_is_null('dominio', 'rma', 'nota_credito_id', 'nota_credito_id admite nulo');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'dominio.rma'::regclass and contype = 'f' and conname = 'rma_nota_credito_fk'
      and confrelid = 'dominio.comprobantes_venta'::regclass and array_length(conkey, 1) = 2),
  1, 'FK compuesta (nota_credito_id, organizacion_id) a comprobantes_venta');
select is(pg_temp.nota_de('RMA-0001'), null::uuid, 'un RMA recién creado no tiene nota');
select is(pg_temp.reingresado('RMA-0001'), false, 'un RMA recién creado no tiene reingreso');

-- ============================================================================
-- Privilegios
-- ============================================================================

select is(has_function_privilege('anon', 'public.vincular_nota_credito_rma(uuid,text,jsonb,text)', 'execute'), false, 'anon no vincula notas');
select is(has_function_privilege('authenticated', 'public.vincular_nota_credito_rma(uuid,text,jsonb,text)', 'execute'), true, 'authenticated ejecuta vincular_nota_credito_rma');
select is(has_function_privilege('anon', 'public.reingresar_stock_rma(uuid,uuid)', 'execute'), false, 'anon no reingresa stock');
select is(has_function_privilege('authenticated', 'public.reingresar_stock_rma(uuid,uuid)', 'execute'), true, 'authenticated ejecuta reingresar_stock_rma');

-- ============================================================================
-- Permisos
-- ============================================================================

-- El Operador (ventas en edición, sin la acción emitir_nota_credito) no vincula notas.
select throws_ok(format($$select public.vincular_nota_credito_rma(%L, 'devolucion_importe', '[{"importe_sin_iva": 100}]'::jsonb, 'Devolución')$$, pg_temp.rma_id('RMA-0001')),
  '42501', null, 'el Operador no vincula notas de crédito');
select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select throws_ok(format($$select public.vincular_nota_credito_rma(%L, 'devolucion_importe', '[{"importe_sin_iva": 100}]'::jsonb, 'Devolución')$$, pg_temp.rma_id('RMA-0001')),
  '42501', null, 'Consulta no vincula notas de crédito');
select throws_ok(format($$select public.reingresar_stock_rma(%L)$$, pg_temp.rma_id('RMA-0002')),
  '42501', null, 'Consulta (ventas en lectura) no reingresa stock');
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select is(pg_temp.notas(), 0, 'sin permiso no se emitió ninguna nota');
select is(pg_temp.entradas('RMA-0002'), 0, 'sin permiso no se movió stock');
select is(pg_temp.estado('RMA-0002'), 'abierto', 'el rechazo por permiso no cerró el RMA');

-- ============================================================================
-- FR-021 · Nota de crédito vinculada (SC-005)
-- ============================================================================

select throws_ok(format($$select public.vincular_nota_credito_rma(%L, 'otro', '[]'::jsonb, 'x')$$, pg_temp.rma_id('RMA-0001')),
  '22023', null, 'el tipo debe ser devolución de importe o de productos');
select throws_ok(format($$select public.vincular_nota_credito_rma(%L, 'devolucion_importe', '[{"importe_sin_iva": 100}]'::jsonb, '  ')$$, pg_temp.rma_id('RMA-0001')),
  '22023', null, 'la nota de importe exige concepto (regla de emitir_nota_credito)');
select throws_ok(format($$select public.vincular_nota_credito_rma(%L, 'devolucion_importe', '[{"importe_sin_iva": 99999999}]'::jsonb, 'Devolución')$$, pg_temp.rma_id('RMA-0001')),
  'P0001', null, 'la nota no excede lo acreditable de la factura');
select throws_ok($$select public.vincular_nota_credito_rma('00000000-0000-0000-0000-000000000000', 'devolucion_importe', '[{"importe_sin_iva": 100}]'::jsonb, 'Devolución')$$,
  'P0002', null, 'un RMA inexistente se rechaza');
select is(pg_temp.notas(), 0, 'los rechazos no dejaron notas');
select is(pg_temp.estado('RMA-0001'), 'abierto', 'los rechazos no cerraron el RMA');

select is(
  (select estado from public.vincular_nota_credito_rma(pg_temp.rma_id('RMA-0001'), 'devolucion_importe', '[{"importe_sin_iva": 100}]'::jsonb, 'Devolución de importe')),
  'cerrado', 'vincular la nota cierra el RMA');
select isnt(pg_temp.nota_de('RMA-0001'), null::uuid, 'nota_credito_id quedó asignado');
select is(
  (select (n.tipo = 'nota_credito' and n.nc_tipo = 'devolucion_importe' and n.total_sin_iva = 100
            and n.comprobante_origen_id = pg_temp.id_de('P') and n.estado = 'confirmada')::text
     from dominio.comprobantes_venta n where n.id = pg_temp.nota_de('RMA-0001')),
  'true', 'la nota es la de F-VTA-11: de importe, sobre la factura del RMA y confirmada');
select is(pg_temp.notas(), 1, 'se emitió una sola nota');
select is(pg_temp.eventos('rma.nota_credito_vinculada'), 1, 'el vínculo registró un evento');
select ok(pg_temp.detalle_evento('rma.nota_credito_vinculada') like 'Vinculó la nota de crédito % a la devolución RMA-0001',
  'el evento dice qué nota y qué devolución');

-- Idempotencia: un reintento no emite otra nota ni duplica el evento.
select is(
  (select nota_credito_id from public.vincular_nota_credito_rma(pg_temp.rma_id('RMA-0001'), 'devolucion_importe', '[{"importe_sin_iva": 100}]'::jsonb, 'Devolución de importe')),
  pg_temp.nota_de('RMA-0001'), 'repetir devuelve la misma nota');
select is(pg_temp.notas(), 1, 'el reintento no emitió otra nota');
select is(pg_temp.eventos('rma.nota_credito_vinculada'), 1, 'el reintento no duplicó el evento');

-- Devolución de productos: sin líneas usa los ítems del RMA y la mercadería vuelve al depósito de origen.
select is(
  (select estado from public.vincular_nota_credito_rma(pg_temp.rma_id('RMA-0004'), 'devolucion_productos')),
  'cerrado', 'la nota de productos cierra el RMA');
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000002', (select principal from datos)), '9/0', 'el cable vuelve al principal por la nota');
select is(
  (select n.nc_tipo from dominio.comprobantes_venta n where n.id = pg_temp.nota_de('RMA-0004')),
  'devolucion_productos', 'la nota del RMA-0004 es de productos');
select is(pg_temp.notas(), 2, 'ya van dos notas');

-- ============================================================================
-- FR-022 · Reingreso de stock (SC-006)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select throws_ok($$select public.reingresar_stock_rma('00000000-0000-0000-0000-000000000000')$$,
  'P0002', null, 'un RMA inexistente se rechaza');
select throws_ok(format($$select public.reingresar_stock_rma(%L, %L)$$, pg_temp.rma_id('RMA-0002'), '00000000-0000-0000-0000-0000000000aa'),
  '22023', null, 'un depósito inexistente se rechaza');
select is(pg_temp.entradas('RMA-0002'), 0, 'el rechazo no dejó movimientos');
select is(pg_temp.estado('RMA-0002'), 'abierto', 'el rechazo no cerró el RMA');
select is(pg_temp.reingresado('RMA-0002'), false, 'el rechazo no marcó el reingreso');

select is((select estado from public.reingresar_stock_rma(pg_temp.rma_id('RMA-0002'))), 'cerrado', 'reingresar cierra el RMA');
select is(pg_temp.reingresado('RMA-0002'), true, 'el RMA queda marcado como reingresado');
select is(pg_temp.entradas('RMA-0002'), 1, 'una entrada con motivo «Devolución» y nota del RMA');
select is(pg_temp.entradas_en('RMA-0002', 'd1000000-0000-0000-0000-000000000002'), 2::bigint, 'la entrada va al depósito de origen de la línea (Local)');
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002'), '4/0', 'Local recupera los 2 joysticks');
select is(pg_temp.eventos('rma.stock_reingresado'), 1, 'el reingreso registró un evento');
select is(pg_temp.detalle_evento('rma.stock_reingresado'), 'Reingresó al stock los ítems de la devolución RMA-0002', 'el evento dice qué devolución');

-- Idempotencia: un reintento no duplica movimientos ni eventos.
select is((select estado from public.reingresar_stock_rma(pg_temp.rma_id('RMA-0002'))), 'cerrado', 'repetir devuelve el RMA');
select is(pg_temp.entradas('RMA-0002'), 1, 'el reintento no duplicó la entrada');
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002'), '4/0', 'el reintento no tocó el stock');
select is(pg_temp.eventos('rma.stock_reingresado'), 1, 'el reintento no duplicó el evento');

-- Depósito indicado: manda sobre el de origen de la línea.
select public.reingresar_stock_rma(pg_temp.rma_id('RMA-0003'), 'd1000000-0000-0000-0000-000000000002');
select is(pg_temp.entradas_en('RMA-0003', 'd1000000-0000-0000-0000-000000000002'), 1::bigint, 'la entrada va al depósito indicado');
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002'), '5/0', 'Local suma el joystick del RMA-0003');
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000001', (select principal from datos)), '8/0', 'el principal no se tocó');
select is(pg_temp.negativos(), 0, 'ningún depósito quedó con stock negativo');

-- ============================================================================
-- Exclusión: una devolución se resuelve por nota o por stock, no por ambos
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select throws_ok(format($$select public.vincular_nota_credito_rma(%L, 'devolucion_productos')$$, pg_temp.rma_id('RMA-0002')),
  '55000', null, 'un RMA con reingreso no admite nota de crédito');
select throws_ok(format($$select public.reingresar_stock_rma(%L)$$, pg_temp.rma_id('RMA-0001')),
  '55000', null, 'un RMA con nota no admite reingreso');
select is(pg_temp.notas(), 2, 'la exclusión no emitió notas');
select is(pg_temp.entradas('RMA-0001'), 0, 'la exclusión no movió stock');

-- ============================================================================
-- FR-023 · El listado trae el vínculo
-- ============================================================================

select is((select nota_credito_numero from public.listar_rma(p_busqueda => 'RMA-0001')),
  (select numero from dominio.comprobantes_venta where id = pg_temp.nota_de('RMA-0001')), 'el listado trae el número de la nota');
select is((select nota_credito_id from public.listar_rma(p_busqueda => 'RMA-0001')), pg_temp.nota_de('RMA-0001'), 'el listado trae la nota asociada');
select is((select stock_reingresado from public.listar_rma(p_busqueda => 'RMA-0001')), false, 'RMA con nota: sin reingreso');
select is((select stock_reingresado from public.listar_rma(p_busqueda => 'RMA-0002')), true, 'RMA reingresado: marcado en el listado');
select is((select nota_credito_numero from public.listar_rma(p_busqueda => 'RMA-0002')), null, 'RMA reingresado: sin nota');
select is((select stock_reingresado from public.listar_rma(p_busqueda => 'RMA-0005')), false, 'RMA sin resolver: sin reingreso');
select is((select count(*)::int from public.listar_rma()), 5, 'el listado sigue trayendo los cinco RMA');

-- ============================================================================
-- Aislamiento y anon
-- ============================================================================

select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select throws_ok(format($$select public.vincular_nota_credito_rma(%L, 'devolucion_importe', '[{"importe_sin_iva": 1}]'::jsonb, 'x')$$, pg_temp.rma_id('RMA-0005')),
  'P0002', null, 'otra organización no vincula notas a un RMA ajeno');
select throws_ok(format($$select public.reingresar_stock_rma(%L)$$, pg_temp.rma_id('RMA-0005')),
  'P0002', null, 'otra organización no reingresa stock de un RMA ajeno');
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select is(pg_temp.estado('RMA-0005'), 'abierto', 'otra organización no alteró el RMA');
select is(pg_temp.negativos(), 0, 'al final ningún depósito quedó con stock negativo');

reset role;
select throws_ok(format($$set local role anon; select public.reingresar_stock_rma(%L)$$, pg_temp.rma_id('RMA-0005')),
  '42501', null, 'anon no reingresa stock');
reset role;
select throws_ok(format($$set local role anon; select public.vincular_nota_credito_rma(%L, 'devolucion_importe', '[{"importe_sin_iva": 1}]'::jsonb, 'x')$$, pg_temp.rma_id('RMA-0005')),
  '42501', null, 'anon no vincula notas');
reset role;

select * from finish();
rollback;
