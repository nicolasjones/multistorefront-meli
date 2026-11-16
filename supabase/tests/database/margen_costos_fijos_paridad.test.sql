-- F-GAS-03 (MSF-469), RF-GAS-13 / CA-GAS-15 / SC-001: PARIDAD. Lo existente devuelve EXACTAMENTE lo mismo antes y después de
-- cargar gastos, con la bandera `margen_costos_fijos` apagada y encendida: todas las vistas de `analitica` que NO son las
-- nuevas (se enumeran del catálogo, así una vista futura también queda cubierta) y las RPC de rentabilidad e Inicio y el
-- armado del resumen semanal. Se compara un hash del contenido completo de cada objeto en cinco etapas:
--   S0 sin gastos, bandera apagada · S1 con gastos, apagada · S2 con gastos, encendida · S3 encendida tras anular y editar
--   gastos y cargar un gasto nuevo · S4 apagada otra vez. Todas deben ser idénticas a S0.
-- Una cobertura impide que la prueba pase en vacío (los objetos tienen filas) y la vista nueva sí cambia al encender (prueba
-- que los gastos efectivamente estaban cargados y que la bandera hace algo).
begin;

select plan(12);

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


insert into auth.users (id, email) values ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');
select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

create temp table foto (etapa text not null, objeto text not null, hash text not null, filas integer not null);

create function pg_temp.sacar_foto(p_etapa text) returns void language plpgsql as $$
declare
  r record;
  v_hash text;
  v_filas integer;
  v_sql text;
begin
  -- Todas las vistas de analitica que no son las nuevas de esta spec.
  for r in
    select v.table_name::text as nombre
      from information_schema.views v
     where v.table_schema = 'analitica'
       and v.table_name not in ('costos_fijos_empresa_mes', 'ventas_netas_empresa_mes', 'margen_despues_costos_fijos', 'margen_costos_fijos_empresa_mes')
  loop
    execute format($f$select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text), '')), count(*)::int from analitica.%I x$f$, r.nombre)
      into v_hash, v_filas;
    insert into foto values (p_etapa, 'analitica.' || r.nombre, v_hash, v_filas);
  end loop;
  -- RPC y funciones de rentabilidad, Inicio y resumen semanal (como un administrador de la organización Uno).
  for r in
    select * from (values
      ('public.leer_umbral_margen_bajo()', 'select * from public.leer_umbral_margen_bajo()'),
      ('public.rentabilidad_conteo_margen()', 'select * from public.rentabilidad_conteo_margen()'),
      ('public.resumen_inicio_bloques(octubre)', $q$select public.resumen_inicio_bloques('2027-10-01', '2027-10-31', null, null, null) as f$q$),
      ('public.resumen_inicio_periodo(octubre)', $q$select public.resumen_inicio_periodo('2027-10-01', '2027-10-31', null, null) as f$q$),
      ('private.armar_resumen_semanal(octubre)', $q$select private.armar_resumen_semanal('11111111-1111-1111-1111-111111111111', '2027-10-01', '2027-10-31') as f$q$)
    ) t(objeto, consulta)
  loop
    v_sql := format($f$select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text), '')), count(*)::int from (%s) x$f$, r.consulta);
    execute v_sql into v_hash, v_filas;
    insert into foto values (p_etapa, r.objeto, v_hash, v_filas);
  end loop;
end $$;

select pg_temp.sacar_foto('S0');
select ok((select count(*) from foto where etapa = 'S0') >= 20, 'la foto cubre todas las vistas existentes de analitica y las RPC (cobertura)');
select ok((select count(*) from foto where etapa = 'S0' and objeto = 'analitica.rentabilidad_ventas_real' and filas > 0) = 1
      and (select count(*) from foto where etapa = 'S0' and objeto = 'analitica.margen_real_categoria' and filas > 0) = 1,
  'el margen real tiene filas en la foto (no pasa en vacío)');

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

select pg_temp.sacar_foto('S1');
select is((select count(*)::int from analitica.margen_despues_costos_fijos), 0, 'con gastos y la bandera apagada la medida nueva no devuelve filas');

update public.banderas_plataforma set activa = true where clave = 'margen_costos_fijos';
select pg_temp.sacar_foto('S2');
select ok((select count(*) from analitica.margen_despues_costos_fijos) > 0, 'al encender, la medida nueva SÍ devuelve filas (los gastos estaban cargados)');

-- Más movimiento: anular, editar y cargar otro gasto fijo grande.
update dominio.gastos set anulado_en = now(), motivo_anulacion = 'Prueba' where categoria = 'Alquiler' and empresa_id = 'e1000000-0000-0000-0000-000000000001';
update dominio.gastos set importe = importe * 3, importe_pesos = importe_pesos * 3, updated_at = now() where categoria = 'Servicios' and moneda = 'ARS';
insert into dominio.gastos (organizacion_id, empresa_id, fecha, categoria, tipo_costo, importe, moneda, importe_pesos) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', '2027-10-09', 'Sueldos', 'fijo', 5000000, 'ARS', 5000000);
select pg_temp.sacar_foto('S3');

update public.banderas_plataforma set activa = false where clave = 'margen_costos_fijos';
select pg_temp.sacar_foto('S4');

-- ============================================================================
-- Cada etapa es idéntica a S0, objeto por objeto
-- ============================================================================

select is((select count(*)::int from foto where etapa = 'S1'), (select count(*)::int from foto where etapa = 'S0'), 'S1 cubre los mismos objetos que S0');
select is((select count(*)::int from foto a join foto b on b.objeto = a.objeto and b.etapa = 'S1' where a.etapa = 'S0' and a.hash is distinct from b.hash), 0,
  'con gastos cargados y bandera apagada NINGÚN objeto existente cambia de resultado');
select is((select count(*)::int from foto a join foto b on b.objeto = a.objeto and b.etapa = 'S2' where a.etapa = 'S0' and a.hash is distinct from b.hash), 0,
  'con la bandera ENCENDIDA tampoco cambia ningún objeto existente');
select is((select count(*)::int from foto a join foto b on b.objeto = a.objeto and b.etapa = 'S3' where a.etapa = 'S0' and a.hash is distinct from b.hash), 0,
  'tras anular, editar y cargar gastos con la bandera encendida, nada existente cambia');
select is((select count(*)::int from foto a join foto b on b.objeto = a.objeto and b.etapa = 'S4' where a.etapa = 'S0' and a.hash is distinct from b.hash), 0,
  'apagarla de nuevo deja todo como al principio');
select is((select count(*)::int from foto a join foto b on b.objeto = a.objeto and b.etapa = 'S3' where a.etapa = 'S0' and a.filas <> b.filas), 0, 'ni siquiera cambia la cantidad de filas');
select is((select count(distinct etapa)::int from foto), 5, 'se sacaron las cinco fotos');
select is(
  (select count(*)::int from analitica.margen_real_categoria m join analitica.rentabilidad_ventas_real r
     on r.organizacion_id = m.organizacion_id and r.empresa_id = m.empresa_id and r.producto_id = m.producto_id and r.fecha = m.fecha
    where m.margen is distinct from r.margen),
  0, 'margen_real_categoria y rentabilidad_ventas_real siguen coincidiendo fila por fila'
);

select * from finish();
rollback;
