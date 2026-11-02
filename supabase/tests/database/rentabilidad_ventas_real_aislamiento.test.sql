-- F-REN-09 (MSF-223, épica MSF-192, SC-005): aislamiento de la rentabilidad de ventas reales. Dos organizaciones con
-- ventas propias: el costo guardado y la vista de A nunca traen filas de B (la cláusula `rls` del guest token filtra por
-- `organizacion_id`, que cada fila expone); y los roles sin la sección `rentabilidad` (Operador, Consulta, Mostrador)
-- no leen costo ni margen: ni el costo guardado de las líneas ni la vista. El 403 del token es de Superset y se prueba
-- en el Vitest de la pestaña; acá se prueba lo que la base garantiza.
-- Las fechas son relativas al reloj de la base (`current_date - 1`).
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización A'),
  ('22222222-2222-2222-2222-222222222222', 'Organización B');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'administrador-a@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'operador-a@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'consulta-a@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'administrador-b@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda B');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente A', 'minorista', null),
  ('c5000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 10, 'Cliente B', 'minorista', null);

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Producto de A', 'A-1', 'ARS', 10000, true),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto de B', 'B-1', 'ARS', 10000, true);
insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 6000),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 7000);

create temp table datos as
  select (select id from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as dep_a,
         (select id from dominio.depositos where organizacion_id = '22222222-2222-2222-2222-222222222222' and por_defecto) as dep_b;
grant select on datos to public;

insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select dep_a, 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111' from datos
union all
select dep_b, 'a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222' from datos
on conflict do nothing;

insert into dominio.existencias (producto_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 0),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 10, 0)
on conflict (producto_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;
insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000001', (select dep_a from datos), '11111111-1111-1111-1111-111111111111', 10, 0),
  ('b2000000-0000-0000-0000-000000000001', (select dep_b from datos), '22222222-2222-2222-2222-222222222222', 10, 0)
on conflict (producto_id, deposito_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table comps (clave text primary key, id uuid);
grant select, insert, update on comps to public;

create function pg_temp.vender(p_clave text, p_empresa uuid, p_cliente uuid, p_producto uuid, p_deposito uuid, p_cantidad int)
returns void language plpgsql as $$
declare v_c dominio.comprobantes_venta;
begin
  v_c := public.crear_comprobante('factura', p_empresa, p_cliente, 'mostrador', (current_date - 1));
  insert into comps (clave, id) values (p_clave, v_c.id);
  perform public.guardar_lineas_comprobante(v_c.id,
    jsonb_build_array(jsonb_build_object('producto_id', p_producto, 'cantidad', p_cantidad, 'deposito_id', p_deposito)), v_c.updated_at);
  perform public.confirmar_comprobante(v_c.id);
end $$;

-- Cada administrador vende en su organización.
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select pg_temp.vender('VA', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001',
      'b1000000-0000-0000-0000-000000000001', (select dep_a from datos), 2)$$,
  'A confirma una venta');
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select pg_temp.vender('VB', 'a2000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002',
      'b2000000-0000-0000-0000-000000000001', (select dep_b from datos), 3)$$,
  'B confirma una venta');
reset role;

-- La vista expone `organizacion_id` y cada fila es de su organización (lo que filtra el token).
select is((select count(*)::int from analitica.rentabilidad_ventas_real), 2, 'hay una fila por organización');
select is(
  (select count(*)::int from analitica.rentabilidad_ventas_real
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and producto_id = 'b1000000-0000-0000-0000-000000000001'
      and empresa_id = 'a1000000-0000-0000-0000-000000000001' and costo = 12000),
  1, 'con el filtro del token de A solo está lo de A (2 × $ 6.000)');
select is(
  (select count(*)::int from analitica.rentabilidad_ventas_real
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and empresa_id = 'a2000000-0000-0000-0000-000000000001'),
  0, 'A no ve ninguna fila de la tienda de B');
select is(
  (select costo from analitica.rentabilidad_ventas_real where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  21000.00, 'B ve su propio costo guardado (3 × $ 7.000), sin mezclar el de A');
select is(
  (select count(*)::int from analitica.rentabilidad_ventas_real v
    where not exists (select 1 from dominio.empresas e where e.id = v.empresa_id and e.organizacion_id = v.organizacion_id)),
  0, 'toda fila cuelga de una empresa de su propia organización');

-- Costos adicionales de A no entran en el margen real de B.
insert into dominio.costos_adicionales_canal (organizacion_id, empresa_id, nombre, tipo, valor) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'Impuestos A', 'porcentaje', 10);
select is(
  (select costos_adicionales from analitica.rentabilidad_ventas_real where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  0::numeric, 'los costos adicionales de A no se descuentan en B');

-- Roles sin `rentabilidad`: ni el costo guardado de las líneas ni la vista.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok($$select costo_unitario from dominio.comprobantes_venta_lineas$$, '42501', null, 'Operador no lee el costo guardado');
select throws_ok($$select * from analitica.rentabilidad_ventas_real$$, '42501', null, 'Operador no lee la vista');
select lives_ok($$select cantidad, subtotal_sin_iva from dominio.comprobantes_venta_lineas$$, 'Operador sigue leyendo las líneas sin el costo');
select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select throws_ok($$select cotizacion from dominio.comprobantes_venta_lineas$$, '42501', null, 'Consulta no lee la cotización guardada');
select throws_ok($$select * from analitica.rentabilidad_ventas_real$$, '42501', null, 'Consulta no lee la vista');
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select throws_ok($$select * from analitica.rentabilidad_ventas_real$$, '42501', null, 'ni siquiera el administrador de B lee la vista desde la app: va por el tablero con token');
reset role;

select is(has_table_privilege('anon', 'analitica.rentabilidad_ventas_real', 'select'), false, 'anon sin acceso a la vista');
select is(has_column_privilege('anon', 'dominio.comprobantes_venta_lineas', 'costo_unitario', 'select'), false, 'anon sin acceso al costo guardado');

select * from finish();
rollback;
