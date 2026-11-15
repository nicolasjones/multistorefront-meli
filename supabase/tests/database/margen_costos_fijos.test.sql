-- F-GAS-03 (MSF-469), RF-GAS-11 / RF-GAS-12 / SC-001 / SC-002 / CA-GAS-16…21 / CA-GAS-24: la medida «margen después de costos
-- fijos» con el ejemplo numérico de la spec (San Javucho, octubre: tasa 20 %, A → 150.000 y B → −75.000), la nota de crédito,
-- el mes sin ventas, el mes con solo gastos variables, el gasto en USD con cotización congelada, «Sin atribuir», la anulación
-- (recalcula al leer), el mes en curso y el aislamiento entre organizaciones. La bandera se enciende dentro de la transacción.
begin;

select plan(45);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

-- E1 San Javucho (ejemplo de la spec) · E2 Mundo JC (nota de crédito y USD) · E3 de la otra organización.
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('e2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into public.clientes (id, organizacion_id, nombre, tipo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Cliente Uno', 'minorista'),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Cliente Dos', 'minorista');

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('ca100000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Consolas'),
  ('ca200000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Otra');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, categoria_id) values
  ('b1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Producto A', 'PA', 100, 'ca100000-0000-0000-0000-000000000001'),
  ('b1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Producto B', 'PB', 100, 'ca100000-0000-0000-0000-000000000001'),
  ('b1000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Sin costo', 'PC', 100, null),
  ('b2000000-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', 'Producto Dos', 'PD', 100, 'ca200000-0000-0000-0000-000000000001');

delete from dominio.depositos
 where por_defecto and organizacion_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
insert into dominio.depositos (id, organizacion_id, nombre, por_defecto) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Central', true),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Depósito Dos', true);

-- Costos adicionales del canal de San Javucho: 5 % sobre el neto (el margen real los descuenta; los gastos variables NO).
insert into dominio.costos_adicionales_canal (organizacion_id, empresa_id, nombre, tipo, valor) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'Comisión', 'porcentaje', 5);

-- Comprobantes. Octubre 2027 de San Javucho: A $ 1.000.000 (costo 600.000), B $ 500.000 (costo 450.000) y $ 8.500.000 de
-- «Sin costo» (línea sin costo guardado): ventas netas del mes = $ 10.000.000.
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'factura', '00000001', 1, '2027-10-10', 'confirmada', 10000000, 12100000),
  -- Setiembre: solo gastos variables (CA-GAS-17).
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'factura', '00000002', 2, '2027-09-10', 'confirmada', 100000, 121000),
  -- Un borrador de octubre no cuenta.
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'factura', '00000003', 3, '2027-10-12', 'borrador', 7000000, 8470000),
  -- Mundo JC, octubre: factura de $ 1.000.000 (costo 600.000) y nota de crédito de $ 200.000 (costo 120.000) otro día.
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000001', 'factura', '00000001', 1, '2027-10-05', 'confirmada', 1000000, 1210000),
  -- Otra organización.
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000003', 'c6000000-0000-0000-0000-000000000001', 'factura', '00000001', 1, '2027-10-10', 'confirmada', 1000, 1210);

insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva, comprobante_origen_id, nc_tipo)
values
  ('a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000001', 'nota_credito', '00000001', 2, '2027-10-20', 'confirmada', 200000, 242000, 'a1000000-0000-0000-0000-000000000004', 'devolucion_productos');

insert into dominio.comprobantes_venta_lineas
  (organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad, precio_unitario, escala, deposito_id, subtotal_sin_iva, iva, costo_unitario) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 1, 'b1000000-0000-0000-0000-00000000000a', 'A', 'A', 1, 1000000, 'x1', 'd1000000-0000-0000-0000-000000000001', 1000000, 210000, 600000),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 2, 'b1000000-0000-0000-0000-00000000000b', 'B', 'B', 1, 500000, 'x1', 'd1000000-0000-0000-0000-000000000001', 500000, 105000, 450000),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 3, 'b1000000-0000-0000-0000-00000000000c', 'C', 'C', 1, 8500000, 'x1', 'd1000000-0000-0000-0000-000000000001', 8500000, 1785000, null),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000002', 1, 'b1000000-0000-0000-0000-00000000000a', 'A', 'A', 1, 100000, 'x1', 'd1000000-0000-0000-0000-000000000001', 100000, 21000, 60000),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000003', 1, 'b1000000-0000-0000-0000-00000000000a', 'A', 'A', 7, 1000000, 'x1', 'd1000000-0000-0000-0000-000000000001', 7000000, 1470000, 600000),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000004', 1, 'b1000000-0000-0000-0000-00000000000a', 'A', 'A', 1, 1000000, 'x1', 'd1000000-0000-0000-0000-000000000001', 1000000, 210000, 600000),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000005', 1, 'b1000000-0000-0000-0000-00000000000a', 'A', 'A', 1, 200000, 'x1', 'd1000000-0000-0000-0000-000000000001', 200000, 42000, 120000),
  ('22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-000000000001', 1, 'b2000000-0000-0000-0000-00000000000a', 'D', 'D', 1, 1000, 'x1', 'd2000000-0000-0000-0000-000000000001', 1000, 210, 400);

-- Gastos (fixture como postgres: la escritura real es por RPC, ya probada en gastos_rpc.test.sql).
--   San Javucho, octubre: fijos 800.000 + 120.000 + 1.080.000 = 2.000.000; un variable (Fletes 60.000) y un fijo ANULADO (999.999) no cuentan.
--   San Javucho, noviembre: un fijo de 50.000 y NINGUNA venta (CA-GAS-18). Setiembre: solo un variable de 30.000 (CA-GAS-17).
--   Mundo JC, octubre: Alquiler 40.000 + USD 100 a 1.200 = 120.000 pesos congelados → 160.000 fijos.
--   Empresa Dos, octubre: fijo 500.
insert into dominio.gastos (organizacion_id, empresa_id, fecha, categoria, tipo_costo, detalle, importe, moneda, cotizacion_usada, importe_pesos) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', '2027-10-01', 'Alquiler',  'fijo',     null, 800000,  'ARS', null, 800000),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', '2027-10-03', 'Servicios', 'fijo',     null, 120000,  'ARS', null, 120000),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', '2027-10-31', 'Sueldos',   'fijo',     null, 1080000, 'ARS', null, 1080000),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', '2027-10-15', 'Fletes',    'variable', null, 60000,   'ARS', null, 60000),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', '2027-11-05', 'Otros',     'fijo',     null, 50000,   'ARS', null, 50000),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', '2027-09-05', 'Insumos',   'variable', null, 30000,   'ARS', null, 30000),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', '2027-10-02', 'Alquiler',  'fijo',     null, 40000,   'ARS', null, 40000),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', '2027-10-04', 'Servicios', 'fijo',     null, 100,     'USD', 1200, 120000),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000003', '2027-10-02', 'Alquiler',  'fijo',     null, 500,     'ARS', null, 500);
insert into dominio.gastos (organizacion_id, empresa_id, fecha, categoria, tipo_costo, importe, moneda, importe_pesos, anulado_en, motivo_anulacion) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', '2027-10-20', 'Otros', 'fijo', 999999, 'ARS', 999999, now(), 'Cargado por error');

update public.banderas_plataforma set activa = true where clave = 'margen_costos_fijos';

create function pg_temp.fila(p_empresa uuid, p_producto uuid, p_fecha date, p_col text) returns numeric language plpgsql as $$
declare v numeric;
begin
  execute format('select %I from analitica.margen_despues_costos_fijos where empresa_id = %L and producto_id = %L and fecha = %L', p_col, p_empresa, p_producto, p_fecha) into v;
  return v;
end $$;

-- ============================================================================
-- Contrato de la vista (RF-GAS-12): las columnas del margen real más las cuatro nuevas
-- ============================================================================

select has_view('analitica', 'margen_despues_costos_fijos', 'existe analitica.margen_despues_costos_fijos');
select columns_are(
  'analitica', 'margen_despues_costos_fijos',
  array['organizacion_id', 'empresa_id', 'empresa_nombre', 'categoria', 'producto_id', 'producto_nombre', 'sku', 'fecha', 'mes', 'mes_en_curso',
        'unidades', 'vendido', 'costo', 'costos_adicionales', 'margen', 'margen_pct',
        'tasa_fija', 'cargo_costos_fijos', 'margen_despues_fijos', 'margen_despues_fijos_pct'],
  'la vista expone las columnas del margen real, el mes y las cuatro medidas nuevas (y ninguna de gastos)'
);

-- ============================================================================
-- Ejemplo numérico de la spec (CA-GAS-16, SC-001): San Javucho, octubre
-- ============================================================================

select is(
  (select tasa_fija from analitica.margen_despues_costos_fijos
    where empresa_id = 'e1000000-0000-0000-0000-000000000001' and producto_id = 'b1000000-0000-0000-0000-00000000000a' and fecha = '2027-10-10'),
  0.2::numeric, 'tasa_fija = 2.000.000 ÷ 10.000.000 = 20 %'
);
select is(pg_temp.fila('e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000a', '2027-10-10', 'margen'), 350000::numeric, 'A: margen vigente 350.000 (35 %), sin tocar');
select is(pg_temp.fila('e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000a', '2027-10-10', 'cargo_costos_fijos'), 200000::numeric, 'A: cargo fijo 200.000');
select is(pg_temp.fila('e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000a', '2027-10-10', 'margen_despues_fijos'), 150000::numeric, 'A: margen después de fijos 150.000');
select is(pg_temp.fila('e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000a', '2027-10-10', 'margen_despues_fijos_pct'), 0.15::numeric, 'A: 15 %');
select is(pg_temp.fila('e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000b', '2027-10-10', 'margen'), 25000::numeric, 'B: margen vigente 25.000 (5 %)');
select is(pg_temp.fila('e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000b', '2027-10-10', 'cargo_costos_fijos'), 100000::numeric, 'B: cargo fijo 100.000');
select is(pg_temp.fila('e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000b', '2027-10-10', 'margen_despues_fijos'), -75000::numeric, 'B: margen después de fijos −75.000');
select is(pg_temp.fila('e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000b', '2027-10-10', 'margen_despues_fijos_pct'), -0.15::numeric, 'B: −15 %');

-- El margen vigente de la vista nueva es EXACTAMENTE el del margen real (no se recalcula ni se redondea).
select is(
  (select count(*)::int from analitica.margen_despues_costos_fijos d
     join analitica.margen_real_categoria m
       on m.organizacion_id = d.organizacion_id and m.empresa_id = d.empresa_id and m.producto_id = d.producto_id and m.fecha = d.fecha
    where d.margen is distinct from m.margen or d.vendido is distinct from m.vendido or d.costo is distinct from m.costo
       or d.costos_adicionales is distinct from m.costos_adicionales or d.margen_pct is distinct from m.margen_pct
       or d.categoria is distinct from m.categoria or d.unidades is distinct from m.unidades),
  0, 'las columnas heredadas son idénticas al margen real, fila por fila'
);
select is(
  (select count(*)::int from analitica.margen_despues_costos_fijos where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  (select count(*)::int from analitica.margen_real_categoria where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'una fila por fila del margen real: el cruce no multiplica ni pierde filas'
);

-- ============================================================================
-- «Sin atribuir» (D7, CA-GAS-19, SC-002)
-- ============================================================================

select is(
  (select sin_atribuir from analitica.margen_costos_fijos_empresa_mes where empresa_id = 'e1000000-0000-0000-0000-000000000001' and mes = '2027-10-01'),
  1700000::numeric, 'San Javucho octubre: sin atribuir = 2.000.000 − 300.000 (la parte de las ventas sin costo guardado)'
);
select is(
  (select cargo_atribuido + sin_atribuir from analitica.margen_costos_fijos_empresa_mes where empresa_id = 'e1000000-0000-0000-0000-000000000001' and mes = '2027-10-01'),
  2000000::numeric, 'cargo atribuido + sin atribuir = costo fijo del mes'
);
select is(
  (select count(*)::int from analitica.margen_costos_fijos_empresa_mes
    where cargo_atribuido + sin_atribuir is distinct from costos_fijos),
  0, 'SC-002 en TODOS los meses y empresas: cargo + sin atribuir = costos fijos'
);
select is(
  (select ventas_netas from analitica.margen_costos_fijos_empresa_mes where empresa_id = 'e1000000-0000-0000-0000-000000000001' and mes = '2027-10-01'),
  10000000::numeric, 'ventas netas del mes: 10.000.000 (con la línea sin costo, sin el borrador)'
);
select is(
  (select margen_despues_fijos from analitica.margen_costos_fijos_empresa_mes where empresa_id = 'e1000000-0000-0000-0000-000000000001' and mes = '2027-10-01'),
  75000::numeric, 'tarjeta del mes: margen vigente 375.000 − cargo 300.000 = 75.000'
);

-- ============================================================================
-- Solo gastos variables / mes sin gastos (CA-GAS-17)
-- ============================================================================

select is(pg_temp.fila('e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000a', '2027-09-10', 'cargo_costos_fijos'), 0::numeric, 'setiembre (solo un gasto variable): cargo 0');
select is(
  pg_temp.fila('e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000a', '2027-09-10', 'margen_despues_fijos'),
  pg_temp.fila('e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000a', '2027-09-10', 'margen'),
  'la medida iguala al margen vigente'
);
select is(
  (select tasa_fija from analitica.margen_despues_costos_fijos where empresa_id = 'e1000000-0000-0000-0000-000000000001' and fecha = '2027-09-10'),
  0::numeric, 'la tasa de un mes sin fijos es 0 (hay ventas para repartir)'
);

-- ============================================================================
-- Mes sin ventas (CA-GAS-18): sin tasa, sin cargo, el tablero ve el monto de fijos
-- ============================================================================

select is(
  (select count(*)::int from analitica.margen_despues_costos_fijos where empresa_id = 'e1000000-0000-0000-0000-000000000001' and mes = '2027-11-01'),
  0, 'noviembre no tiene filas de producto (no hubo ventas)'
);
select is(
  (select sin_ventas from analitica.margen_costos_fijos_empresa_mes where empresa_id = 'e1000000-0000-0000-0000-000000000001' and mes = '2027-11-01'),
  true, 'noviembre: sin_ventas = true'
);
select is(
  (select tasa_fija from analitica.margen_costos_fijos_empresa_mes where empresa_id = 'e1000000-0000-0000-0000-000000000001' and mes = '2027-11-01'),
  null::numeric, 'noviembre: no hay tasa (sin división por cero)'
);
select is(
  (select costos_fijos from analitica.margen_costos_fijos_empresa_mes where empresa_id = 'e1000000-0000-0000-0000-000000000001' and mes = '2027-11-01'),
  50000::numeric, 'noviembre: el monto de fijos igual se informa (50.000)'
);
select is(
  (select sin_atribuir from analitica.margen_costos_fijos_empresa_mes where empresa_id = 'e1000000-0000-0000-0000-000000000001' and mes = '2027-11-01'),
  50000::numeric, 'noviembre: todo el fijo queda sin atribuir'
);

-- Ventas netas que suman cero o menos (todo devuelto): tampoco hay tasa ni error.
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva)
values
  ('a1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'factura', '00000009', 9, '2027-12-02', 'confirmada', 100, 121);
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva, comprobante_origen_id, nc_tipo)
values
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'nota_credito', '00000010', 10, '2027-12-03', 'confirmada', 100, 121, 'a1000000-0000-0000-0000-000000000009', 'devolucion_importe');
insert into dominio.comprobantes_venta_lineas
  (organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad, precio_unitario, escala, deposito_id, subtotal_sin_iva, iva, costo_unitario) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000009', 1, 'b1000000-0000-0000-0000-00000000000a', 'A', 'A', 1, 100, 'x1', 'd1000000-0000-0000-0000-000000000001', 100, 21, 60),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 1, 'b1000000-0000-0000-0000-00000000000a', 'A', 'A', 1, 100, 'x1', 'd1000000-0000-0000-0000-000000000001', 100, 21, 60);
insert into dominio.gastos (organizacion_id, empresa_id, fecha, categoria, tipo_costo, importe, moneda, importe_pesos) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', '2027-12-05', 'Alquiler', 'fijo', 1000, 'ARS', 1000);
select is(
  (select tasa_fija from analitica.margen_despues_costos_fijos where empresa_id = 'e1000000-0000-0000-0000-000000000001' and mes = '2027-12-01' limit 1),
  null::numeric, 'ventas netas del mes = 0 (factura menos nota de crédito): tasa null'
);
select is(
  (select sum(cargo_costos_fijos) from analitica.margen_despues_costos_fijos where empresa_id = 'e1000000-0000-0000-0000-000000000001' and mes = '2027-12-01'),
  0::numeric, 'y el cargo es 0 (sin división por cero)'
);
select is(
  (select sin_atribuir from analitica.margen_costos_fijos_empresa_mes where empresa_id = 'e1000000-0000-0000-0000-000000000001' and mes = '2027-12-01'),
  1000::numeric, 'el fijo del mes queda sin atribuir'
);

-- ============================================================================
-- Nota de crédito (CA-GAS-20) y gasto en USD (D8): Mundo JC, octubre
-- ============================================================================

select is(
  (select tasa_fija from analitica.margen_despues_costos_fijos where empresa_id = 'e1000000-0000-0000-0000-000000000002' limit 1),
  0.2::numeric, 'Mundo JC: tasa 160.000 (40.000 + USD 100 × 1.200) ÷ 800.000 (1.000.000 − 200.000) = 20 %'
);
select is(pg_temp.fila('e1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-00000000000a', '2027-10-05', 'cargo_costos_fijos'), 200000::numeric, 'la factura carga 200.000');
select is(pg_temp.fila('e1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-00000000000a', '2027-10-20', 'cargo_costos_fijos'), -40000::numeric, 'la nota de crédito RESTA el cargo (−40.000) con el mismo signo que el margen real');
select is(pg_temp.fila('e1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-00000000000a', '2027-10-20', 'margen_despues_fijos'), -40000::numeric, 'nota de crédito: margen −80.000 − cargo (−40.000) = −40.000');
select is(pg_temp.fila('e1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-00000000000a', '2027-10-20', 'margen_despues_fijos_pct'), null::numeric, 'vendido ≤ 0: el porcentaje es null (sin división por cero)');
select is(
  (select sin_atribuir from analitica.margen_costos_fijos_empresa_mes where empresa_id = 'e1000000-0000-0000-0000-000000000002'),
  0::numeric, 'Mundo JC: todo el fijo queda atribuido (todas sus líneas tienen costo)'
);

-- El dólar cambia después: lo ya cargado no se reescribe (importe_pesos congelado).
insert into dominio.cotizacion_inicial (organizacion_id, valor) values ('11111111-1111-1111-1111-111111111111', 9999);
select is(
  (select costos_fijos from analitica.margen_costos_fijos_empresa_mes where empresa_id = 'e1000000-0000-0000-0000-000000000002'),
  160000::numeric, 'un cambio posterior de la cotización no mueve el costo fijo del gasto en USD'
);

-- ============================================================================
-- Anular un gasto recalcula al leer (CA-GAS-21); los cortes suman lo mismo (CA-GAS-24)
-- ============================================================================

update dominio.gastos set anulado_en = now(), motivo_anulacion = 'Prueba'
 where empresa_id = 'e1000000-0000-0000-0000-000000000001' and categoria = 'Sueldos';
select is(
  pg_temp.fila('e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000a', '2027-10-10', 'cargo_costos_fijos'),
  (920000::numeric / 10000000) * 1000000, 'anular Sueldos (1.080.000): la tasa pasa a 9,2 % y el cargo de A a 92.000'
);
select is(
  (select round(sum(cargo_costos_fijos), 2) from analitica.margen_despues_costos_fijos where empresa_id = 'e1000000-0000-0000-0000-000000000001' and mes = '2027-10-01'),
  138000.00, 'los cargos de octubre suman 92.000 + 46.000'
);
select is(
  (select sum(cargo_costos_fijos) + (select sin_atribuir from analitica.margen_costos_fijos_empresa_mes where empresa_id = 'e1000000-0000-0000-0000-000000000001' and mes = '2027-10-01')
     from analitica.margen_despues_costos_fijos where empresa_id = 'e1000000-0000-0000-0000-000000000001' and mes = '2027-10-01'),
  920000::numeric, 'y cargo + sin atribuir sigue dando el fijo vigente (920.000)'
);
-- Cortes: por producto, por categoría y por empresa suman lo mismo (CA-GAS-24).
select is(
  (select count(distinct t)::int from (
     select round(sum(cargo_costos_fijos), 6) as t from analitica.margen_despues_costos_fijos where organizacion_id = '11111111-1111-1111-1111-111111111111' group by organizacion_id
     union all select round(sum(c), 6) from (select sum(cargo_costos_fijos) c from analitica.margen_despues_costos_fijos where organizacion_id = '11111111-1111-1111-1111-111111111111' group by categoria) x
     union all select round(sum(c), 6) from (select sum(cargo_costos_fijos) c from analitica.margen_despues_costos_fijos where organizacion_id = '11111111-1111-1111-1111-111111111111' group by empresa_id) x
     union all select round(sum(c), 6) from (select sum(cargo_costos_fijos) c from analitica.margen_despues_costos_fijos where organizacion_id = '11111111-1111-1111-1111-111111111111' group by producto_id) x
     union all select round(sum(cargo_atribuido), 6) from analitica.margen_costos_fijos_empresa_mes where organizacion_id = '11111111-1111-1111-1111-111111111111'
   ) z),
  1, 'producto, categoría, tienda y tarjeta mensual suman el mismo cargo total'
);

-- ============================================================================
-- Mes en curso y aislamiento por organización
-- ============================================================================

insert into dominio.gastos (organizacion_id, empresa_id, fecha, categoria, tipo_costo, importe, moneda, importe_pesos) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001',
   (now() at time zone 'America/Argentina/Buenos_Aires')::date, 'Servicios', 'fijo', 10, 'ARS', 10);
select is(
  (select mes_en_curso from analitica.costos_fijos_empresa_mes
    where empresa_id = 'e1000000-0000-0000-0000-000000000001' and mes = date_trunc('month', (now() at time zone 'America/Argentina/Buenos_Aires'))::date),
  true, 'el mes de hoy (Buenos Aires) se marca como mes en curso'
);
insert into dominio.gastos (organizacion_id, empresa_id, fecha, categoria, tipo_costo, importe, moneda, importe_pesos) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001',
   (date_trunc('month', (now() at time zone 'America/Argentina/Buenos_Aires')) - interval '1 month')::date, 'Servicios', 'fijo', 10, 'ARS', 10);
select is(
  (select bool_or(mes_en_curso) from analitica.margen_costos_fijos_empresa_mes
    where empresa_id = 'e1000000-0000-0000-0000-000000000001'
      and mes = (date_trunc('month', (now() at time zone 'America/Argentina/Buenos_Aires')) - interval '1 month')::date),
  false, 'un mes ya cerrado no se marca como en curso'
);
select is(
  (select tasa_fija from analitica.margen_despues_costos_fijos where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  0.5::numeric, 'otra organización: su tasa sale solo de sus ventas y gastos (500 ÷ 1.000)'
);
select is(
  (select count(*)::int from analitica.margen_despues_costos_fijos d
    where d.organizacion_id = '22222222-2222-2222-2222-222222222222' and d.empresa_id <> 'e2000000-0000-0000-0000-000000000003'),
  0, 'las filas de otra organización solo traen sus propias empresas (el token filtra por organizacion_id y empresa_id)'
);

-- Superset (rol de solo lectura) lee la vista nueva con la bandera encendida.
do $$ begin execute format('grant superset_analitica to %I', current_user); end $$;
create temp table resultado_superset (n integer);
grant all on resultado_superset to public;
set local role superset_analitica;
insert into resultado_superset select count(*)::int from analitica.margen_despues_costos_fijos where organizacion_id = '11111111-1111-1111-1111-111111111111';
reset role;
select is((select n from resultado_superset), 7, 'superset_analitica lee la medida nueva con la bandera encendida (sin permission denied)');

select * from finish();
rollback;
