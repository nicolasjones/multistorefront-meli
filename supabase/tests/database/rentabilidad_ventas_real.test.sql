-- F-REN-09 (MSF-223, épica MSF-192, SC-004): captura de costo y cotización por línea al confirmar (FR-006, FR-007) y
-- vista `analitica.rentabilidad_ventas_real` (FR-008): margen de lo efectivamente vendido, costos adicionales
-- vigentes, notas de crédito, exclusiones (borrador, presupuesto, anulada, sin costo guardado), producto dado de baja,
-- neto ≤ 0 y privilegios (`anon`/`authenticated` sin acceso; costo guardado oculto a quien solo tiene `ventas`).
-- Las fechas son relativas al reloj de la base (`current_date - 1`): ningún caso depende del día en que corre.
-- El precio de cada línea lo calcula la RPC de líneas; los casos comparan contra lo guardado en las propias líneas.
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
  v_c := public.crear_comprobante(p_tipo, 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'mostrador', (current_date - 1));
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


-- Costos y dólar: Joystick ARS con costo 6.000 · Cable ARS con costo 100 · Consola USD con costo USD 10 (con stock, ya no «A pedido»).
insert into dominio.cotizacion_inicial (organizacion_id, valor) values ('11111111-1111-1111-1111-111111111111', 1000);
insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 6000),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 100);
update dominio.productos set precio_lista = 10000 where id = 'b1000000-0000-0000-0000-000000000001';
update dominio.productos set moneda = 'USD', precio_lista = 2, disponibilidad_manual = null where id = 'b1000000-0000-0000-0000-000000000003';
insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 10);

create function pg_temp.vista(p_producto uuid, p_columna text) returns numeric language plpgsql security definer as $$
declare v numeric;
begin
  -- Suma de las filas del producto (la factura y su nota pueden caer en fechas distintas): columnas aditivas.
  execute format('select sum(%I) from analitica.rentabilidad_ventas_real where producto_id = $1', p_columna) into v using p_producto;
  return v;
end $$;
create function pg_temp.filas_vista(p_producto uuid) returns integer language sql security definer as $$
  select count(*)::int from analitica.rentabilidad_ventas_real where producto_id = p_producto $$;
create function pg_temp.sub_lineas(p_clave text) returns numeric language sql security definer as $$
  select coalesce(sum(subtotal_sin_iva), 0) from dominio.comprobantes_venta_lineas
   where comprobante_id = (select id from comps where clave = p_clave) $$;
create function pg_temp.col_linea(p_clave text, p_columna text) returns numeric language plpgsql security definer as $$
declare v numeric;
begin
  execute format('select %I from dominio.comprobantes_venta_lineas where comprobante_id = $1 order by orden limit 1', p_columna)
    into v using (select id from comps where clave = p_clave);
  return v;
end $$;
grant execute on function pg_temp.vista(uuid, text), pg_temp.filas_vista(uuid), pg_temp.sub_lineas(text), pg_temp.col_linea(text, text) to public;

-- ============================================================================
-- Estructura y privilegios (FR-006)
-- ============================================================================

select has_column('dominio', 'comprobantes_venta_lineas', 'costo_unitario', 'la línea guarda el costo unitario en pesos');
select has_column('dominio', 'comprobantes_venta_lineas', 'cotizacion', 'la línea guarda la cotización del momento');
select col_is_null('dominio', 'comprobantes_venta_lineas', 'costo_unitario', 'el costo es nulable (ventas anteriores)');
select col_is_null('dominio', 'comprobantes_venta_lineas', 'cotizacion', 'la cotización es nulable');
select is(has_column_privilege('authenticated', 'dominio.comprobantes_venta_lineas', 'costo_unitario', 'select'), false,
  'authenticated no lee el costo guardado de la línea (secreto de rentabilidad)');
select is(has_column_privilege('authenticated', 'dominio.comprobantes_venta_lineas', 'cotizacion', 'select'), false,
  'authenticated no lee la cotización guardada');
select is(has_column_privilege('authenticated', 'dominio.comprobantes_venta_lineas', 'cantidad', 'select'), true,
  'authenticated sigue leyendo el resto de la línea');
select is(has_table_privilege('anon', 'dominio.comprobantes_venta_lineas', 'select'), false, 'anon sin acceso a las líneas');
select is(has_table_privilege('anon', 'analitica.rentabilidad_ventas_real', 'select'), false, 'anon no lee la vista');
select is(has_table_privilege('authenticated', 'analitica.rentabilidad_ventas_real', 'select'), false, 'authenticated no lee la vista');
select is(has_table_privilege('superset_analitica', 'analitica.rentabilidad_ventas_real', 'select'), true, 'el rol de Superset lee la vista');
select is(has_function_privilege('anon', 'public.confirmar_comprobante(uuid)', 'execute'), false, 'anon no confirma (misma firma y grants)');
select is(has_function_privilege('authenticated', 'public.confirmar_comprobante(uuid)', 'execute'), true, 'authenticated confirma');
select is(has_function_privilege('authenticated', 'private.copiar_costo_linea_nota()', 'execute'), false, 'el trigger de copia no es ejecutable');

-- ============================================================================
-- Armado: F1 = 3 joysticks (escenario 2 de la historia). F2 se anula. F3 sin costo guardado. U se devuelve entera.
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.armar('F1', 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 3, 'deposito_id', (select principal from datos))));
select pg_temp.armar('F2', 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000002', 'cantidad', 2, 'deposito_id', (select principal from datos))));
select pg_temp.armar('F3', 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000002', 'cantidad', 1, 'deposito_id', (select principal from datos))));
select pg_temp.armar('U', 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000003', 'cantidad', 1, 'deposito_id', (select principal from datos))));
select pg_temp.armar('borrador', 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 1, 'deposito_id', (select principal from datos))));
select pg_temp.armar('presupuesto', 'presupuesto', null);

select is(pg_temp.col_linea('F1', 'costo_unitario'), null, 'antes de confirmar la línea no tiene costo guardado');

-- Escenario 1: al confirmar queda el costo en pesos y la cotización del momento.
select lives_ok(format($$select public.confirmar_comprobante(%L)$$, pg_temp.id_de('F1')), 'se confirma F1');
select is(pg_temp.col_linea('F1', 'costo_unitario'), 6000.00, 'la línea guarda el costo del joystick en pesos');
select is(pg_temp.col_linea('F1', 'cotizacion'), 1000.0000, 'y la cotización vigente al confirmar');

select public.confirmar_comprobante(pg_temp.id_de(k)) from unnest(array['F2', 'F3', 'U']) k;
select is(pg_temp.col_linea('U', 'costo_unitario'), 10000.00, 'un producto en USD guarda su costo convertido a pesos (USD 10 × 1.000)');
select is(pg_temp.col_linea('F2', 'costo_unitario'), 100.00, 'F2 guarda el costo del cable');

-- Un cambio posterior de costo o de cotización no altera lo guardado; la doble confirmación tampoco.
reset role;
update dominio.producto_costos set costo = 9000 where producto_id = 'b1000000-0000-0000-0000-000000000001';
update dominio.cotizacion_inicial set valor = 2000 where organizacion_id = '11111111-1111-1111-1111-111111111111';
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select lives_ok(format($$select public.confirmar_comprobante(%L)$$, pg_temp.id_de('F1')), 'confirmar de nuevo es idempotente');
select is(pg_temp.col_linea('F1', 'costo_unitario'), 6000.00, 'el costo guardado no se mueve ante un cambio posterior ni una doble confirmación');
select is(pg_temp.col_linea('F1', 'cotizacion'), 1000.0000, 'la cotización guardada tampoco');

-- Confirmación fallida (sin stock): no deja costo guardado (todo o nada).
select pg_temp.armar('sinstock', 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000002', 'cantidad', 4, 'deposito_id', (select principal from datos))));
select throws_ok(format($$select public.confirmar_comprobante(%L)$$, pg_temp.id_de('sinstock')), 'P0001', null, 'sin stock no confirma');
select is(pg_temp.col_linea('sinstock', 'costo_unitario'), null, 'y la línea queda sin costo guardado');

-- Anulación de F2 y venta anterior sin costo (F3).
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select public.anular_comprobante(pg_temp.id_de('F2'), 'Error de carga', pg_temp.upd('F2'));
reset role;
update dominio.comprobantes_venta_lineas set costo_unitario = null, cotizacion = null
 where comprobante_id = pg_temp.id_de('F3');

-- ============================================================================
-- La vista (FR-008)
-- ============================================================================

-- Escenario 2: 3 unidades, costo del momento $ 6.000, sin costos adicionales → margen = vendido − 18.000.
select is(pg_temp.vista('b1000000-0000-0000-0000-000000000001', 'unidades'), 3::numeric, 'vendió 3 unidades (el borrador no cuenta)');
select is(pg_temp.vista('b1000000-0000-0000-0000-000000000001', 'vendido'), pg_temp.sub_lineas('F1'), 'vendido = neto sin IVA de las líneas');
select is(pg_temp.vista('b1000000-0000-0000-0000-000000000001', 'costo'), 18000.00, 'costo = 3 × $ 6.000 guardado, aunque el costo actual sea $ 9.000');
select is(pg_temp.vista('b1000000-0000-0000-0000-000000000001', 'costos_adicionales'), 0::numeric, 'sin costos adicionales vigentes valen 0');
select is(pg_temp.vista('b1000000-0000-0000-0000-000000000001', 'margen'), pg_temp.sub_lineas('F1') - 18000, 'margen = vendido − costo');
select is(
  round(pg_temp.vista('b1000000-0000-0000-0000-000000000001', 'margen_pct'), 6),
  round((pg_temp.sub_lineas('F1') - 18000) / pg_temp.sub_lineas('F1'), 6), 'margen % = margen / vendido');

-- Escenario 3: costos adicionales vigentes (10 % sobre el neto vendido + $ 100 por unidad).
insert into dominio.costos_adicionales_canal (organizacion_id, empresa_id, nombre, tipo, valor) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'Impuestos', 'porcentaje', 10),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'Envío', 'monto', 100);
select is(
  round(pg_temp.vista('b1000000-0000-0000-0000-000000000001', 'costos_adicionales'), 2),
  round(pg_temp.sub_lineas('F1') * 0.10 + 3 * 100, 2), 'descuenta el % sobre el neto vendido y el monto por unidad vendida');
select is(
  round(pg_temp.vista('b1000000-0000-0000-0000-000000000001', 'margen'), 2),
  round(pg_temp.sub_lineas('F1') - 18000 - pg_temp.sub_lineas('F1') * 0.10 - 300, 2), 'el margen real los descuenta');
update dominio.costos_adicionales_canal set activo = false where nombre = 'Envío';
select is(
  round(pg_temp.vista('b1000000-0000-0000-0000-000000000001', 'costos_adicionales'), 2),
  round(pg_temp.sub_lineas('F1') * 0.10, 2), 'un costo dado de baja deja de descontarse (vigentes al consultar)');
update dominio.costos_adicionales_canal set activo = false;

-- Escenario 4: la nota de crédito resta ventas, costo y margen (el costo se copia de la línea original).
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select lives_ok(
  format($$select public.emitir_nota_credito(%L, 'devolucion_productos', %L::jsonb, null)$$, pg_temp.id_de('F1'),
    jsonb_build_array(jsonb_build_object('linea_id', pg_temp.linea('F1', 'b1000000-0000-0000-0000-000000000001', (select principal from datos)), 'cantidad', 1))::text),
  'se emite una nota de crédito por 1 joystick');
reset role;
select is(
  (select nl.costo_unitario from dominio.comprobantes_venta_lineas nl
     join dominio.comprobantes_venta n on n.id = nl.comprobante_id and n.tipo = 'nota_credito'
    where n.comprobante_origen_id = pg_temp.id_de('F1')),
  6000.00, 'la línea de la nota copia el costo guardado de la original');
select is(pg_temp.vista('b1000000-0000-0000-0000-000000000001', 'unidades'), 2::numeric, 'la nota resta una unidad');
select is(pg_temp.vista('b1000000-0000-0000-0000-000000000001', 'costo'), 12000.00, 'la nota resta su costo (3 × 6.000 − 1 × 6.000)');
select ok(pg_temp.vista('b1000000-0000-0000-0000-000000000001', 'vendido') < pg_temp.sub_lineas('F1'), 'la nota resta lo vendido');

-- Anuladas, borradores, presupuestos y ventas sin costo guardado no cuentan; no se inventa costo.
select is(pg_temp.filas_vista('b1000000-0000-0000-0000-000000000002'), 0, 'F2 anulada y F3 sin costo guardado: el cable no tiene fila');

-- Neto ≤ 0: factura devuelta entera → vendido 0, margen % nulo, no explota.
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select public.emitir_nota_credito(pg_temp.id_de('U'), 'devolucion_productos',
  jsonb_build_array(jsonb_build_object('linea_id', pg_temp.linea('U', 'b1000000-0000-0000-0000-000000000003', (select principal from datos)), 'cantidad', 1)), null);
reset role;
select is(pg_temp.vista('b1000000-0000-0000-0000-000000000003', 'vendido'), 0::numeric, 'devuelta entera: vendido 0');
select is(
  (select margen_pct from analitica.rentabilidad_ventas_real where producto_id = 'b1000000-0000-0000-0000-000000000003'),
  null::numeric, 'una fila sin neto positivo trae margen % nulo (no divide por cero)');

-- Producto dado de baja y empresa pausada: las ventas ya hechas cuentan.
update dominio.productos set activo = false where id = 'b1000000-0000-0000-0000-000000000001';
update dominio.empresas set activa = false where id = 'a1000000-0000-0000-0000-000000000001';
select ok(pg_temp.filas_vista('b1000000-0000-0000-0000-000000000001') >= 1, 'las ventas de un producto dado de baja siguen en el margen real');

-- Estado según el umbral de la organización. Los costos adicionales ya están dados de baja, así que el margen %
-- sale solo del costo guardado: se fija en 5 % del neto (costo = 95 % del neto unitario) y se mueve el umbral.
create function pg_temp.estado_joystick() returns text language sql as $$
  select estado from analitica.rentabilidad_ventas_real
   where producto_id = 'b1000000-0000-0000-0000-000000000001' and fecha = current_date - 1 $$;
update dominio.comprobantes_venta_lineas set costo_unitario = round(subtotal_sin_iva / cantidad * 0.95, 4)
 where producto_id = 'b1000000-0000-0000-0000-000000000001' and costo_unitario is not null;
select is(
  (select round(margen_pct, 4) from analitica.rentabilidad_ventas_real
    where producto_id = 'b1000000-0000-0000-0000-000000000001' and fecha = current_date - 1),
  0.0500::numeric, 'con el costo en 95 % del neto el margen % es 5 %');
select is(pg_temp.estado_joystick(), 'bajo', 'sin fila de configuración rige el umbral 10 %: 5 % es bajo');
insert into dominio.rentabilidad_config (organizacion_id, umbral_margen_bajo)
  values ('11111111-1111-1111-1111-111111111111', 0.04);
select is(pg_temp.estado_joystick(), 'ok', 'con el umbral de la organización en 4 %, 5 % es ok');
select is(
  (select umbral_margen_bajo from analitica.rentabilidad_ventas_real
    where producto_id = 'b1000000-0000-0000-0000-000000000001' and fecha = current_date - 1),
  0.0400::numeric, 'la fila expone el umbral de la organización');
update dominio.rentabilidad_config set umbral_margen_bajo = 0.06;
select is(pg_temp.estado_joystick(), 'bajo', 'un margen por debajo del umbral de la organización (6 %) es bajo');
update dominio.comprobantes_venta_lineas set costo_unitario = round(subtotal_sin_iva / cantidad * 1.20, 4)
 where producto_id = 'b1000000-0000-0000-0000-000000000001' and costo_unitario is not null;
select is(pg_temp.estado_joystick(), 'negativo', 'con el costo sobre el neto el margen es negativo');

-- Sin acceso desde la sesión de la app.
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select throws_ok($$select * from analitica.rentabilidad_ventas_real$$, '42501', null, 'authenticated no lee la vista');
select throws_ok($$select costo_unitario from dominio.comprobantes_venta_lineas$$, '42501', null, 'ni el costo guardado de las líneas');
reset role;

-- Con una cotización aplicada distinta de la inicial, costo y cotización guardados son coherentes (misma fuente que a_pesos).
reset role;
insert into dominio.cotizacion_aplicada (organizacion_id, valor) values ('11111111-1111-1111-1111-111111111111', 1500);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.armar('UA', 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000003', 'cantidad', 1, 'deposito_id', (select principal from datos))));
select lives_ok(format($$select public.confirmar_comprobante(%L)$$, pg_temp.id_de('UA')), 'se confirma con cotización aplicada');
select is(pg_temp.col_linea('UA', 'cotizacion'), 1500.0000, 'guarda la cotización aplicada, no la inicial (2.000)');
select is(pg_temp.col_linea('UA', 'costo_unitario'), 15000.00, 'el costo en pesos usa la misma cotización (USD 10 × 1.500)');
select is(pg_temp.col_linea('UA', 'costo_unitario'), round(10 * pg_temp.col_linea('UA', 'cotizacion'), 2),
  'costo_unitario = costo USD × cotización guardada');

select * from finish();
rollback;
