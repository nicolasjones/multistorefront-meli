-- F-VTA-11 (MSF-377, épica MSF-177, SC-007): nota de crédito. Cubre FR-043 (los tres tipos, tope acreditable con notas
-- previas, numeración propia, permisos), FR-044 (stock solo en «Devolución de productos», al depósito de origen),
-- FR-047 (facturado neto en el ranking y en las compras del cliente) y FR-048 (permisos verificados en la RPC).
-- La concurrencia real (dos sesiones) no cabe en una transacción de pgTAP: se prueba la serie (la segunda nota ve lo que
-- dejó la primera y no excede el tope) y que la RPC toma la factura `for update`.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('f1000000-0000-0000-0000-000000000004', 'administracion@example.com'),
  ('f1000000-0000-0000-0000-000000000005', 'mostrador@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'administracion', 'activo'),
  ('f1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'mostrador', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('f1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'mostrador');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista', null);

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks');

-- Joystick y Cable con stock; Consola «A pedido».
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', null, true),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 'ARS', 500, 'c1000000-0000-0000-0000-000000000001', null, true),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Consola bajo pedido', 'CON-1', 'ARS', 2000, 'c1000000-0000-0000-0000-000000000001', 'a_pedido', true);

insert into dominio.depositos (id, organizacion_id, nombre) values
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Local');

create temp table datos as
  select (select id from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as principal;
grant select on datos to public;

insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select d, 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'
  from (select principal as d from datos union all select 'd1000000-0000-0000-0000-000000000002'::uuid) x
on conflict do nothing;

-- Joystick: 10 en el principal y 4 en Local (14). Cable: 5 en el principal. Consola a pedido: 6 en el principal.
insert into dominio.existencias (producto_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 14, 0),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 5, 0),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 6, 0)
on conflict (producto_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;
insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000001', (select principal from datos), '11111111-1111-1111-1111-111111111111', 10, 0),
  ('b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 4, 0),
  ('b1000000-0000-0000-0000-000000000002', (select principal from datos), '11111111-1111-1111-1111-111111111111', 5, 0),
  ('b1000000-0000-0000-0000-000000000003', (select principal from datos), '11111111-1111-1111-1111-111111111111', 6, 0)
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
create function pg_temp.est(p_clave text) returns text language sql security definer as $$
  select estado from dominio.comprobantes_venta where id = (select id from comps where clave = p_clave) $$;
create function pg_temp.disp(p_producto uuid, p_deposito uuid) returns text language sql security definer as $$
  select cantidad || '/' || reservado from dominio.existencias_deposito where producto_id = p_producto and deposito_id = p_deposito $$;
create function pg_temp.eventos(p_tipo text) returns integer language sql security definer as $$
  select count(*)::int from public.registro_actividad where tipo = p_tipo $$;
create function pg_temp.detalle_evento(p_tipo text) returns text language sql security definer as $$
  select detalle from public.registro_actividad where tipo = p_tipo order by creado_en desc limit 1 $$;
create function pg_temp.linea(p_clave text, p_producto uuid, p_deposito uuid) returns uuid language sql security definer as $$
  select l.id from dominio.comprobantes_venta_lineas l
   where l.comprobante_id = (select id from comps where clave = p_clave) and l.producto_id = p_producto and l.deposito_id = p_deposito $$;
create function pg_temp.resta_sin(p_clave text) returns numeric language sql security definer as $$
  select f.total_sin_iva - coalesce((select sum(n.total_sin_iva) from dominio.comprobantes_venta n where n.comprobante_origen_id = f.id), 0)
    from dominio.comprobantes_venta f where f.id = (select id from comps where clave = p_clave) $$;
grant execute on function pg_temp.resta_sin(text) to public;

create function pg_temp.entradas(p_clave text, p_motivo text) returns integer language sql security definer as $$
  select count(*)::int from dominio.movimientos_stock m
    join dominio.motivos_movimiento mo on mo.id = m.motivo_id and mo.organizacion_id = m.organizacion_id
   where m.tipo = 'entrada' and mo.nombre = p_motivo
     and m.nota like '%' || (select numero from dominio.comprobantes_venta where id = (select id from comps where clave = p_clave)) $$;
grant execute on function pg_temp.upd(text), pg_temp.est(text), pg_temp.disp(uuid, uuid), pg_temp.eventos(text),
  pg_temp.entradas(text, text), pg_temp.id_de(text), pg_temp.detalle_evento(text), pg_temp.linea(text, uuid, uuid) to public;

-- ============================================================================
-- Armado: las facturas las vende el Operador (ventas en edición)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

-- P: Joystick 2 del principal + 2 de Local + Cable 2 del principal.
select pg_temp.armar('P', 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 2, 'deposito_id', (select principal from datos)),
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 2, 'deposito_id', 'd1000000-0000-0000-0000-000000000002'),
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000002', 'cantidad', 2, 'deposito_id', (select principal from datos))));
-- Q: para Administración. R: anulada. S: Consola a pedido 1 (reserva activa).
select pg_temp.armar('Q', 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000002', 'cantidad', 1, 'deposito_id', (select principal from datos))));
select pg_temp.armar('R', 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000002', 'cantidad', 1, 'deposito_id', (select principal from datos))));
select pg_temp.armar('S', 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000003', 'cantidad', 1, 'deposito_id', (select principal from datos))));
select pg_temp.armar('borrador', 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000002', 'cantidad', 1, 'deposito_id', (select principal from datos))));
select pg_temp.armar('presupuesto', 'presupuesto', null);

select public.confirmar_comprobante(pg_temp.id_de(k)) from unnest(array['P', 'Q', 'R', 'S']) k;

select is(pg_temp.disp('b1000000-0000-0000-0000-000000000001', (select principal from datos)), '8/0', 'P descontó 2 joysticks del principal');
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002'), '2/0', 'P descontó 2 joysticks de Local');
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000002', (select principal from datos)), '1/0', 'P, Q y R descontaron 4 cables');

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select public.anular_comprobante(pg_temp.id_de('R'), 'Error de carga', pg_temp.upd('R'));

-- ============================================================================
-- Privilegios
-- ============================================================================

select is(has_function_privilege('anon', 'public.emitir_nota_credito(uuid,text,jsonb,text)', 'execute'), false, 'anon no emite notas');
select is(has_function_privilege('authenticated', 'public.emitir_nota_credito(uuid,text,jsonb,text)', 'execute'), true, 'authenticated ejecuta emitir_nota_credito');
select is(has_function_privilege('authenticated', 'private.signo_comprobante(text)', 'execute'), false, 'authenticated no ejecuta el signo interno');

-- ============================================================================
-- Permisos verificados en la RPC (FR-048)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(format($$select public.emitir_nota_credito(%L, 'devolucion_importe', '[{"importe_sin_iva": 1}]'::jsonb, 'Ajuste')$$, pg_temp.id_de('Q')),
  '42501', null, 'el Operador (ventas en edición, sin la acción) no emite notas');
select pg_temp.como('f1000000-0000-0000-0000-000000000005');
select throws_ok(format($$select public.emitir_nota_credito(%L, 'devolucion_importe', '[{"importe_sin_iva": 1}]'::jsonb, 'Ajuste')$$, pg_temp.id_de('Q')),
  '42501', null, 'Mostrador no emite notas');
select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select throws_ok(format($$select public.emitir_nota_credito(%L, 'devolucion_importe', '[{"importe_sin_iva": 1}]'::jsonb, 'Ajuste')$$, pg_temp.id_de('Q')),
  '42501', null, 'Consulta no emite notas');
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.comprobantes_venta where tipo = 'nota_credito'), 0, 'sin permiso no se creó ninguna nota');

-- ============================================================================
-- Validaciones de entrada y de estado
-- ============================================================================

select throws_ok(format($$select public.emitir_nota_credito(%L, 'otro', '[{"importe_sin_iva": 1}]'::jsonb, 'Ajuste')$$, pg_temp.id_de('P')),
  '22023', null, 'el motivo debe ser uno de los tres');
select throws_ok(format($$select public.emitir_nota_credito(%L, 'devolucion_importe', '[]'::jsonb, 'Ajuste')$$, pg_temp.id_de('P')),
  '22023', null, 'las líneas no pueden ir vacías');
select throws_ok(format($$select public.emitir_nota_credito(%L, 'descuento', '[{"importe_sin_iva": 5}]'::jsonb, '  ')$$, pg_temp.id_de('P')),
  '22023', 'Escribí el concepto de la nota de crédito', 'devolución de importe y descuento exigen concepto');
select throws_ok(format($$select public.emitir_nota_credito(%L, 'descuento', '[{"importe_sin_iva": 0}]'::jsonb, 'Bonificación')$$, pg_temp.id_de('P')),
  '22023', null, 'el importe debe ser mayor a cero');
select throws_ok(format($$select public.emitir_nota_credito(%L, 'descuento', '[{"importe_sin_iva": "abc"}]'::jsonb, 'Bonificación')$$, pg_temp.id_de('P')),
  '22023', null, 'un importe que no es número se rechaza');
select throws_ok(format($$select public.emitir_nota_credito(%L, 'devolucion_productos', %L::jsonb, null)$$, pg_temp.id_de('P'),
    jsonb_build_array(jsonb_build_object('linea_id', pg_temp.linea('Q', 'b1000000-0000-0000-0000-000000000002', (select principal from datos)), 'cantidad', 1))::text),
  '22023', null, 'una línea de otra factura se rechaza');
select throws_ok(format($$select public.emitir_nota_credito(%L, 'devolucion_productos', %L::jsonb, null)$$, pg_temp.id_de('P'),
    jsonb_build_array(jsonb_build_object('linea_id', pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000002', (select principal from datos)), 'cantidad', 0))::text),
  '22023', null, 'la cantidad devuelta es de al menos 1');
select throws_ok(format($$select public.emitir_nota_credito(%L, 'devolucion_importe', '[{"importe_sin_iva": 1}]'::jsonb, 'Ajuste')$$, pg_temp.id_de('borrador')),
  '55000', null, 'una factura en borrador no admite notas');
select throws_ok(format($$select public.emitir_nota_credito(%L, 'devolucion_importe', '[{"importe_sin_iva": 1}]'::jsonb, 'Ajuste')$$, pg_temp.id_de('R')),
  '55000', null, 'una factura anulada no admite notas');
select throws_ok(format($$select public.emitir_nota_credito(%L, 'devolucion_importe', '[{"importe_sin_iva": 1}]'::jsonb, 'Ajuste')$$, pg_temp.id_de('presupuesto')),
  '22023', null, 'un presupuesto no admite notas');
select is((select count(*)::int from dominio.comprobantes_venta where tipo = 'nota_credito'), 0, 'los rechazos no dejaron notas ni consumieron numeración');

-- ============================================================================
-- Devolución de productos: stock al depósito de origen (FR-043, FR-044)
-- ============================================================================

select is(
  (select nc_tipo from public.emitir_nota_credito(pg_temp.id_de('P'), 'devolucion_productos',
    jsonb_build_array(jsonb_build_object('linea_id', pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002'), 'cantidad', 1)), 'Falla de fábrica')),
  'devolucion_productos', 'se emite la primera nota (1 joystick de Local)'
);
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002'), '3/0', 'el joystick vuelve a Local, su depósito de origen');
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000001', (select principal from datos)), '8/0', 'el principal no se toca');
select is((select cantidad from dominio.existencias where producto_id = 'b1000000-0000-0000-0000-000000000001'), 11, 'el total único sube 1');
select is(
  (select count(*)::int from dominio.movimientos_stock m join dominio.motivos_movimiento mo on mo.id = m.motivo_id
    where mo.nombre = 'Devolución de cliente' and m.tipo = 'entrada' and m.cantidad = 1 and m.deposito_id = 'd1000000-0000-0000-0000-000000000002'),
  1, 'una entrada con motivo «Devolución de cliente» en Local'
);
select is(
  (select (n.estado = 'confirmada' and n.numero_entero = 1 and n.comprobante_origen_id = pg_temp.id_de('P')
            and n.total_sin_iva > 0 and n.total_con_iva >= n.total_sin_iva and n.operador_id = 'f1000000-0000-0000-0000-000000000001')::text
     from dominio.comprobantes_venta n where n.tipo = 'nota_credito'),
  'true', 'la nota queda confirmada, numerada desde 1, asociada a la factura y con importes positivos'
);
select is(
  (select (nl.cantidad = 1 and nl.orden = ol.orden and nl.subtotal_sin_iva > 0)::text
     from dominio.comprobantes_venta_lineas nl
     join dominio.comprobantes_venta n on n.id = nl.comprobante_id and n.tipo = 'nota_credito'
     join dominio.comprobantes_venta_lineas ol on ol.id = pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002')),
  'true', 'la línea de la nota copia la de la factura (mismo orden) con la cantidad devuelta'
);
select is(pg_temp.eventos('comprobante.nota_credito_emitida'), 1, 'registra el evento comprobante.nota_credito_emitida');
select is(
  pg_temp.detalle_evento('comprobante.nota_credito_emitida'),
  'Emitió la nota de crédito 00000001 (Devolución de productos) sobre la factura ' || (select numero from dominio.comprobantes_venta where id = pg_temp.id_de('P')),
  'el evento nombra la nota, el motivo y la factura (así aparece en el historial de la factura)'
);

-- Tope por línea: queda 1 de Local; pedir 2 falla y no consume numeración ni toca el stock.
select throws_ok(
  format($$select public.emitir_nota_credito(%L, 'devolucion_productos', %L::jsonb, null)$$, pg_temp.id_de('P'),
    jsonb_build_array(jsonb_build_object('linea_id', pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002'), 'cantidad', 2))::text),
  'P0001', null, 'no se devuelve más de lo facturado menos lo ya acreditado por línea'
);
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002'), '3/0', 'el tope rechazado no tocó el stock');

-- Segunda nota: cierra la línea; los subtotales de las dos notas suman exacto la línea de la factura.
select lives_ok(
  format($$select public.emitir_nota_credito(%L, 'devolucion_productos', %L::jsonb, null)$$, pg_temp.id_de('P'),
    jsonb_build_array(jsonb_build_object('linea_id', pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002'), 'cantidad', 1))::text),
  'la segunda nota cierra la línea de Local'
);
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002'), '4/0', 'Local recupera sus 2 joysticks');
select is(
  (select sum(nl.subtotal_sin_iva) + 0 from dominio.comprobantes_venta_lineas nl
     join dominio.comprobantes_venta n on n.id = nl.comprobante_id and n.tipo = 'nota_credito' and n.comprobante_origen_id = pg_temp.id_de('P')),
  (select subtotal_sin_iva from dominio.comprobantes_venta_lineas where id = pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002')),
  'las dos notas acreditan exactamente el subtotal de la línea (sin deriva de redondeo)'
);
select is(
  (select array_agg(numero_entero order by numero_entero) from dominio.comprobantes_venta where tipo = 'nota_credito'),
  array[1, 2], 'la numeración de las notas es correlativa y propia (el rechazo no consumió número)'
);
select throws_ok(
  format($$select public.emitir_nota_credito(%L, 'devolucion_productos', %L::jsonb, null)$$, pg_temp.id_de('P'),
    jsonb_build_array(jsonb_build_object('linea_id', pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002'), 'cantidad', 1))::text),
  'P0001', null, 'una línea ya acreditada por completo no admite más'
);

-- ============================================================================
-- Devolución de importe y Descuento: sin stock (FR-044), con tope por importe (FR-043)
-- ============================================================================

select lives_ok(
  format($$select public.emitir_nota_credito(%L, 'devolucion_importe', '[{"importe_sin_iva": 10}]'::jsonb, 'Reintegro parcial')$$, pg_temp.id_de('P')),
  'Devolución de importe de 10 con concepto'
);
select lives_ok(
  format($$select public.emitir_nota_credito(%L, 'descuento', '[{"importe_sin_iva": 5.5}]'::jsonb, 'Bonificación por demora')$$, pg_temp.id_de('P')),
  'Descuento de 5,50 con concepto'
);
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000001', (select principal from datos)), '8/0', 'los tipos de importe no tocan el stock (principal)');
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000002', (select principal from datos)), '1/0', 'los tipos de importe no tocan el stock (cable)');
select is(
  (select count(*)::int from dominio.comprobantes_venta_lineas l join dominio.comprobantes_venta n on n.id = l.comprobante_id
    where n.tipo = 'nota_credito' and n.nc_tipo in ('devolucion_importe', 'descuento')),
  0, 'las notas de importe no llevan líneas'
);
select is(
  (select nc_concepto from dominio.comprobantes_venta where tipo = 'nota_credito' and nc_tipo = 'descuento'),
  'Bonificación por demora', 'guarda el concepto'
);

select throws_ok(
  format($$select public.emitir_nota_credito(%L, 'devolucion_importe', jsonb_build_array(jsonb_build_object('importe_sin_iva', pg_temp.resta_sin('P') + 0.01)), 'Pasado')$$, pg_temp.id_de('P')),
  'P0001', null, 'no se acredita más de lo facturado menos las notas previas (por importe)'
);
-- Cierra lo acreditable: la suma de las notas iguala exacto a la factura, con y sin IVA.
select lives_ok(
  format($$select public.emitir_nota_credito(%L, 'descuento', jsonb_build_array(jsonb_build_object('importe_sin_iva', pg_temp.resta_sin('P'))), 'Cierre')$$, pg_temp.id_de('P')),
  'una nota por todo lo que queda acreditable'
);
select is(
  (select (sum(n.total_sin_iva) = f.total_sin_iva and sum(n.total_con_iva) = f.total_con_iva)::text
     from dominio.comprobantes_venta n join dominio.comprobantes_venta f on f.id = n.comprobante_origen_id
    where f.id = pg_temp.id_de('P') group by f.id, f.total_sin_iva, f.total_con_iva),
  'true', 'las notas suman exactamente la factura, sin y con IVA'
);
select throws_ok(
  format($$select public.emitir_nota_credito(%L, 'devolucion_importe', '[{"importe_sin_iva": 0.01}]'::jsonb, 'Ya no queda nada')$$, pg_temp.id_de('P')),
  'P0001', null, 'con todo acreditado no se emite ni un centavo más'
);
select throws_ok(
  format($$select public.emitir_nota_credito(%L, 'devolucion_productos', %L::jsonb, null)$$, pg_temp.id_de('P'),
    jsonb_build_array(jsonb_build_object('linea_id', pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000002', (select principal from datos)), 'cantidad', 1))::text),
  'P0001', null, 'tampoco por producto: el tope por importe rige en todos los tipos'
);
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000002', (select principal from datos)), '1/0', 'el rechazo por tope no devolvió stock');

-- ============================================================================
-- Administración emite; «A pedido» sin entrega no devuelve stock
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000004');
select lives_ok(
  format($$select public.emitir_nota_credito(%L, 'devolucion_importe', '[{"importe_sin_iva": 1}]'::jsonb, 'Ajuste de Administración')$$, pg_temp.id_de('Q')),
  'Administración emite una nota (acción emitir_nota_credito por su rol)'
);
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000003', (select principal from datos)), '6/1', 'S reservó 1 consola');
select lives_ok(
  format($$select public.emitir_nota_credito(%L, 'devolucion_productos', %L::jsonb, null)$$, pg_temp.id_de('S'),
    jsonb_build_array(jsonb_build_object('linea_id', pg_temp.linea('S', 'b1000000-0000-0000-0000-000000000003', (select principal from datos)), 'cantidad', 1))::text),
  'se devuelve la consola «A pedido» que nunca salió del depósito'
);
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000003', (select principal from datos)), '6/1', 'sin entrega no hay stock que devolver');

-- ============================================================================
-- Facturado neto (FR-047): el ranking y las compras restan las notas
-- ============================================================================

reset role;
update dominio.comprobantes_venta set fecha = '2026-10-24' where tipo = 'nota_credito';
select is(private.comprobante_cuenta_como_facturado('nota_credito', 'confirmada'), true, 'una nota emitida cuenta (con signo negativo)');
select is(private.comprobante_cuenta_como_facturado('nota_credito', 'borrador'), false, 'una nota en borrador no cuenta');
select is(private.signo_comprobante('nota_credito'), -1, 'la nota resta');
select is(private.signo_comprobante('factura'), 1, 'la factura suma');

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select is(
  (select facturado from public.ranking_clientes('2026-10-01', '2026-10-31') where nombre = 'Cliente Uno'),
  (select sum(case when tipo = 'nota_credito' then -total_sin_iva else total_sin_iva end) from dominio.comprobantes_venta
    where cliente_id = 'c5000000-0000-0000-0000-000000000001' and tipo in ('factura', 'nota_credito') and estado not in ('borrador', 'anulada')),
  'el facturado del ranking es neto de las notas'
);
select is(
  (select comprobantes from public.ranking_clientes('2026-10-01', '2026-10-31') where nombre = 'Cliente Uno'),
  (select count(*) from dominio.comprobantes_venta
    where cliente_id = 'c5000000-0000-0000-0000-000000000001' and tipo = 'factura' and estado not in ('borrador', 'anulada')),
  'el ranking cuenta como comprobantes solo las facturas, no las notas'
);
select ok(
  (select facturado from public.ranking_clientes('2026-10-01', '2026-10-31') where nombre = 'Cliente Uno')
    < (select sum(total_sin_iva) from dominio.comprobantes_venta
        where cliente_id = 'c5000000-0000-0000-0000-000000000001' and tipo = 'factura' and estado not in ('borrador', 'anulada')),
  'el facturado neto es menor que el bruto'
);
select ok(
  (select bool_and(total_sin_iva < 0) from public.compras_de_cliente('c5000000-0000-0000-0000-000000000001', 1, 100) where tipo = 'nota_credito'),
  'las compras del cliente muestran las notas con signo negativo'
);

-- ============================================================================
-- Lectura del detalle (FR-045, FR-046): notas asociadas y acciones que se ofrecen
-- ============================================================================

select is(
  (select jsonb_array_length(public.detalle_anulacion_nota_credito(pg_temp.id_de('P')) -> 'notas')), 5,
  'la factura P lista sus 5 notas'
);
select is(
  (public.detalle_anulacion_nota_credito(pg_temp.id_de('P')) ->> 'puede_emitir_nota_credito'), 'false',
  'con todo acreditado ya no se ofrece la nota'
);
select is(
  (public.detalle_anulacion_nota_credito(pg_temp.id_de('P')) ->> 'puede_anular'), 'false',
  'con notas emitidas ya no se ofrece anular'
);
select is(
  (public.detalle_anulacion_nota_credito(pg_temp.id_de('Q')) ->> 'puede_anular'), 'false',
  'Q tiene una nota: no se ofrece anular'
);
select is(
  (public.detalle_anulacion_nota_credito(pg_temp.id_de('R')) -> 'anulacion' ->> 'motivo'), 'Error de carga',
  'la factura anulada informa su motivo'
);
select is(
  (select (e ->> 'disponible')::integer from jsonb_array_elements(public.detalle_anulacion_nota_credito(pg_temp.id_de('P')) -> 'lineas_acreditables') e
    where e ->> 'linea_id' = pg_temp.linea('P', 'b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002')::text),
  0, 'la línea de Local ya no tiene unidades disponibles'
);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(
  (public.detalle_anulacion_nota_credito(pg_temp.id_de('S')) ->> 'puede_emitir_nota_credito'), 'false',
  'el Operador (sin la acción) no ve el botón de nota de crédito'
);
select pg_temp.como('f1000000-0000-0000-0000-000000000001');

-- ============================================================================
-- Aislamiento y anon
-- ============================================================================

select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select throws_ok(format($$select public.emitir_nota_credito(%L, 'devolucion_importe', '[{"importe_sin_iva": 1}]'::jsonb, 'Ajuste')$$, pg_temp.id_de('Q')),
  'P0002', null, 'otra organización no ve la factura');
reset role;
set local role anon;
select throws_ok(format($$select public.emitir_nota_credito(%L, 'devolucion_importe', '[{"importe_sin_iva": 1}]'::jsonb, 'Ajuste')$$, pg_temp.id_de('Q')),
  '42501', null, 'anon no ejecuta la RPC');
reset role;

select * from finish();
rollback;
