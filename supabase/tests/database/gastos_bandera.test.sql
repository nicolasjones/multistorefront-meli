-- F-GAS-03 (MSF-469), RF-GAS-10 / RF-GAS-11 / CA-GAS-15 / CA-GAS-22: la bandera `margen_costos_fijos` nace APAGADA, la
-- función `analitica.bandera_activa` solo la ejecuta `superset_analitica`, y las vistas nuevas no devuelven NINGUNA fila con la
-- bandera apagada aunque haya gastos y ventas cargados. Con la bandera encendida exponen solo totales (sin detalle de gastos).
-- El fixture corre como postgres; las verificaciones de acceso, con el rol que corresponda.
begin;

select plan(25);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

-- E1 San Javucho (ejemplo de la spec) · E2 Mundo JC (nota de crédito y USD) · E3 de la otra organización.
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('e2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into dominio.clientes (id, organizacion_id, nombre, tipo) values
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

-- ============================================================================
-- La bandera: existe, apagada por defecto, reaplicar no la pisa
-- ============================================================================

select is(
  (select activa from public.banderas_plataforma where clave = 'margen_costos_fijos'),
  false, 'la bandera margen_costos_fijos existe y está APAGADA por defecto'
);
select is((select count(*)::int from public.banderas_plataforma where clave = 'margen_costos_fijos'), 1, 'hay una sola fila de la bandera');

-- `on conflict do nothing`: reaplicar la inserción de la migración con la bandera encendida no la apaga ni la duplica.
update public.banderas_plataforma set activa = true where clave = 'margen_costos_fijos';
insert into public.banderas_plataforma (clave, activa, descripcion) values ('margen_costos_fijos', false, 'otra')
on conflict (clave) do nothing;
select is((select activa from public.banderas_plataforma where clave = 'margen_costos_fijos'), true, 'reaplicar la migración no pisa una bandera encendida');
update public.banderas_plataforma set activa = false where clave = 'margen_costos_fijos';

select is(analitica.bandera_activa('margen_costos_fijos'), false, 'bandera_activa: apagada → false');
select is(analitica.bandera_activa('no_existe_esta_clave'), false, 'bandera_activa: una clave desconocida cuenta como apagada');

-- ============================================================================
-- Privilegios de la función y de las vistas
-- ============================================================================

select is(
  (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'analitica.bandera_activa(text)'::regprocedure),
  true, 'bandera_activa es security definer con search_path vacío'
);
select is(
  has_function_privilege('anon', 'analitica.bandera_activa(text)', 'execute')
  or has_function_privilege('authenticated', 'analitica.bandera_activa(text)', 'execute')
  or has_function_privilege('public', 'analitica.bandera_activa(text)', 'execute'),
  false, 'anon, authenticated y public NO ejecutan bandera_activa'
);
select is(has_function_privilege('superset_analitica', 'analitica.bandera_activa(text)', 'execute'), true, 'superset_analitica ejecuta bandera_activa');

select is(
  (select count(*)::int
     from unnest(array['analitica.costos_fijos_empresa_mes', 'analitica.ventas_netas_empresa_mes',
                       'analitica.margen_despues_costos_fijos', 'analitica.margen_costos_fijos_empresa_mes']) v
    where has_table_privilege('anon', v, 'select') or has_table_privilege('authenticated', v, 'select')
       or has_table_privilege('public', v, 'select')),
  0, 'anon, authenticated y public no leen ninguna de las cuatro vistas nuevas'
);
select is(
  (select count(*)::int
     from unnest(array['analitica.costos_fijos_empresa_mes', 'analitica.ventas_netas_empresa_mes',
                       'analitica.margen_despues_costos_fijos', 'analitica.margen_costos_fijos_empresa_mes']) v
    where has_table_privilege('superset_analitica', v, 'select')),
  4, 'superset_analitica lee las cuatro vistas'
);
select is(
  (select count(*)::int
     from unnest(array['analitica.costos_fijos_empresa_mes', 'analitica.ventas_netas_empresa_mes',
                       'analitica.margen_despues_costos_fijos', 'analitica.margen_costos_fijos_empresa_mes']) v
    where has_table_privilege('superset_analitica', v, 'insert') or has_table_privilege('superset_analitica', v, 'update')
       or has_table_privilege('superset_analitica', v, 'delete')),
  0, 'superset_analitica no escribe en las vistas nuevas'
);
select is(has_table_privilege('superset_analitica', 'dominio.gastos', 'select'), false, 'superset_analitica NO lee dominio.gastos: solo ve totales por empresa y mes');

-- ============================================================================
-- Bandera APAGADA: ninguna vista nueva devuelve filas (con gastos y ventas cargados)
-- ============================================================================

select is((select count(*)::int from dominio.gastos), 10, 'hay 10 gastos cargados (fixture)');
select is((select count(*)::int from analitica.margen_real_categoria where organizacion_id = '11111111-1111-1111-1111-111111111111'), 5,
  'el margen real tiene filas (el cruce tendría con qué trabajar)');
select is((select count(*)::int from analitica.costos_fijos_empresa_mes), 0, 'apagada: costos_fijos_empresa_mes sin filas');
select is((select count(*)::int from analitica.ventas_netas_empresa_mes), 0, 'apagada: ventas_netas_empresa_mes sin filas');
select is((select count(*)::int from analitica.margen_despues_costos_fijos), 0, 'apagada: margen_despues_costos_fijos sin filas');
select is((select count(*)::int from analitica.margen_costos_fijos_empresa_mes), 0, 'apagada: margen_costos_fijos_empresa_mes sin filas');

-- ============================================================================
-- Bandera ENCENDIDA: filas; solo totales por empresa y mes (CA-GAS-22)
-- ============================================================================

update public.banderas_plataforma set activa = true where clave = 'margen_costos_fijos';

select is(analitica.bandera_activa('margen_costos_fijos'), true, 'encendida: bandera_activa devuelve true');
select is(
  (select array_agg(attname::text order by attnum) from pg_attribute where attrelid = 'analitica.costos_fijos_empresa_mes'::regclass and attnum > 0 and not attisdropped),
  array['organizacion_id', 'empresa_id', 'empresa_nombre', 'mes', 'mes_en_curso', 'costos_fijos'],
  'costos_fijos_empresa_mes expone solo totales: ni categoría, ni detalle, ni importe individual'
);
select is(
  (select costos_fijos from analitica.costos_fijos_empresa_mes where empresa_id = 'e1000000-0000-0000-0000-000000000001' and mes = '2027-10-01'),
  2000000.00::numeric, 'costos fijos de octubre: solo fijos vigentes (sin variables ni anulados)'
);
select is(
  (select count(*)::int from analitica.costos_fijos_empresa_mes where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  2, 'San Javucho tiene costos fijos en octubre y noviembre; setiembre (solo variables) no tiene fila'
);
select is(
  (select costos_fijos from analitica.costos_fijos_empresa_mes where empresa_id = 'e1000000-0000-0000-0000-000000000002'),
  160000.00::numeric, 'el gasto en USD entra con la cotización congelada (40.000 + 100 × 1.200)'
);
select is(
  (select ventas_netas from analitica.ventas_netas_empresa_mes where empresa_id = 'e1000000-0000-0000-0000-000000000001' and mes = '2027-10-01'),
  10000000.00::numeric, 'ventas netas de octubre: incluye la línea sin costo y excluye el borrador'
);
select is(
  (select ventas_netas from analitica.ventas_netas_empresa_mes where empresa_id = 'e1000000-0000-0000-0000-000000000002'),
  800000.00::numeric, 'la nota de crédito resta de las ventas netas (1.000.000 − 200.000)'
);

select * from finish();
rollback;
