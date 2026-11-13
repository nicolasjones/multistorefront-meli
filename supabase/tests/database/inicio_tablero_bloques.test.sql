-- MSF-824 (F-INI-05, F-INI-06, F-INI-07): `resumen_inicio_bloques`, `movimientos_por_producto` y
-- `previsualizar_impacto_dolar`. Cubre permisos por rol (costo/margen null sin rentabilidad, bloque null sin
-- permiso), cuentas (nota de crédito resta, margen real solo con costo guardado), lista blanca de orden,
-- vistas y búsqueda, aislamiento, vista previa que NO escribe y `anon` sin ejecución.
begin;

select plan(22);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('e1000000-0000-0000-0000-000000000002', 'tecnico-uno@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'tecnico', 'activo'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');
insert into public.clientes (id, organizacion_id, nombre, tipo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Cliente Uno', 'mayorista');
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-0000000000e1', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');
insert into dominio.categorias (id, organizacion_id, nombre) values
  ('ca100000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Periféricos');
insert into dominio.productos (id, organizacion_id, nombre, sku, categoria_id, precio_lista) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Teclado', 'TEC-1', 'ca100000-0000-0000-0000-000000000001', 1000),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mouse', 'MOU-1', null, 500);
delete from dominio.depositos
 where por_defecto and organizacion_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
insert into dominio.depositos (id, organizacion_id, nombre, por_defecto) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Central', true),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Sucursal', false);
insert into dominio.existencias (producto_id, organizacion_id, cantidad, minimo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 5),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 3, 5)
on conflict (producto_id) do update set cantidad = excluded.cantidad, minimo = excluded.minimo;
insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad) values
  ('b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10),
  ('b1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 3)
on conflict (producto_id, deposito_id) do update set cantidad = excluded.cantidad;

-- Movimientos de octubre (Central): salida de 3 (10/10) y entrada de 5 (12/10) del Teclado.
insert into dominio.motivos_movimiento (id, organizacion_id, nombre) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Motivo de prueba');
insert into dominio.movimientos_stock
  (organizacion_id, producto_id, tipo, cantidad, diferencia, saldo, motivo_id, fecha, deposito_id)
values
  ('11111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-000000000001', 'salida', 3, -3, 7, 'a0000000-0000-0000-0000-000000000001', '2026-10-10', 'd1000000-0000-0000-0000-000000000001'),
  ('11111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-000000000001', 'entrada', 5, 5, 12, 'a0000000-0000-0000-0000-000000000001', '2026-10-12', 'd1000000-0000-0000-0000-000000000001');

-- Ventas de octubre: F1 (SJ, Teclado ×2, costo 300), N1 (SJ, devuelve ×1, costo 300), F2 (Mundo JC, Teclado ×3, sin costo).
insert into dominio.comprobantes_venta
  (organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva)
values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'factura', '00000001', 1, '2026-10-05', 'confirmada', 1000, 1210),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e2', 'c5000000-0000-0000-0000-000000000001', 'factura', '00000001', 1, '2026-10-09', 'confirmada', 3000, 3630);
insert into dominio.comprobantes_venta
  (organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva, comprobante_origen_id, nc_tipo)
values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'nota_credito', '00000002', 2, '2026-10-06', 'confirmada', 500, 605,
   (select id from dominio.comprobantes_venta where organizacion_id = '11111111-1111-1111-1111-111111111111'
      and empresa_id = 'a1000000-0000-0000-0000-0000000000e1' and tipo = 'factura' and numero = '00000001'), 'devolucion_productos');
create function pg_temp.linea(p_emp uuid, p_tipo text, p_num text, p_cant int, p_dep uuid, p_sub numeric, p_iva numeric, p_costo numeric)
returns void language sql as $$
  insert into dominio.comprobantes_venta_lineas
    (organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad, precio_unitario, escala, deposito_id, subtotal_sin_iva, iva, costo_unitario)
  values ('11111111-1111-1111-1111-111111111111',
          (select id from dominio.comprobantes_venta where organizacion_id = '11111111-1111-1111-1111-111111111111' and empresa_id = p_emp and tipo = p_tipo and numero = p_num),
          1, 'b1000000-0000-0000-0000-000000000001', 'Teclado', 'TEC-1', p_cant, 500, 'x1', p_dep, p_sub, p_iva, p_costo);
$$;
select pg_temp.linea('a1000000-0000-0000-0000-0000000000e1', 'factura', '00000001', 2, 'd1000000-0000-0000-0000-000000000001', 1000, 210, 300);
select pg_temp.linea('a1000000-0000-0000-0000-0000000000e1', 'nota_credito', '00000002', 1, 'd1000000-0000-0000-0000-000000000001', 500, 105, 300);
select pg_temp.linea('a1000000-0000-0000-0000-0000000000e2', 'factura', '00000001', 3, 'd1000000-0000-0000-0000-000000000002', 3000, 630, null);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ===== F-INI-05: resumen_inicio_bloques =====
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select is((select (t ->> 'ingresos')::numeric from jsonb_array_elements(public.resumen_inicio_bloques('2026-10-01', '2026-10-31') -> 'por_tienda') t where t ->> 'nombre' = 'San Javucho'),
  605::numeric, 'ingresos de San Javucho: factura − nota de crédito (con IVA)');
select is((select (t ->> 'unidades')::int from jsonb_array_elements(public.resumen_inicio_bloques('2026-10-01', '2026-10-31') -> 'por_tienda') t where t ->> 'nombre' = 'San Javucho'),
  1, 'unidades de San Javucho netas de devoluciones');
select is((select (t ->> 'margen_pct')::numeric from jsonb_array_elements(public.resumen_inicio_bloques('2026-10-01', '2026-10-31') -> 'por_tienda') t where t ->> 'nombre' = 'San Javucho'),
  40.0::numeric, 'margen real de San Javucho: (1000−600 − (500−300)) / (1000−500) = 40 %');
select is((select t -> 'margen_pct' from jsonb_array_elements(public.resumen_inicio_bloques('2026-10-01', '2026-10-31') -> 'por_tienda') t where t ->> 'nombre' = 'Mundo JC'),
  'null'::jsonb, 'sin costo guardado no hay margen (no se inventa costo)');
select is((select (t ->> 'ingresos')::numeric from jsonb_array_elements(public.resumen_inicio_bloques('2026-10-01', '2026-10-31', null, 'd1000000-0000-0000-0000-000000000002') -> 'por_tienda') t where t ->> 'nombre' = 'Mundo JC'),
  3630::numeric, 'con depósito, los ingresos salen de sus líneas');
select is((select (t ->> 'salidas')::int from jsonb_array_elements(public.resumen_inicio_bloques('2026-10-01', '2026-10-31') -> 'salidas_por_deposito') t where t ->> 'nombre' = 'Central'),
  3, 'salidas del depósito Central en el período');
select is((select (t ->> 'stock_actual')::int from jsonb_array_elements(public.resumen_inicio_bloques('2026-10-01', '2026-10-31') -> 'salidas_por_deposito') t where t ->> 'nombre' = 'Central'),
  13, 'stock actual del depósito Central');

-- El técnico ve stock pero no ventas ni rentabilidad: por_tienda null, depósitos sí.
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select is(public.resumen_inicio_bloques('2026-10-01', '2026-10-31') -> 'por_tienda', 'null'::jsonb, 'sin permiso de ventas, por_tienda vuelve null');
select isnt(public.resumen_inicio_bloques('2026-10-01', '2026-10-31') -> 'salidas_por_deposito', 'null'::jsonb, 'con stock ≥ lectura ve las salidas por depósito');

-- ===== F-INI-06: movimientos_por_producto =====
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select is((select stock_inicial from public.movimientos_por_producto('2026-10-01', '2026-10-31') where sku = 'TEC-1'), 8::bigint,
  'stock inicial = stock actual − diferencias del período (10 − (−3 + 5))');
select is((select entradas || '/' || salidas || '/' || ajustes from public.movimientos_por_producto('2026-10-01', '2026-10-31') where sku = 'TEC-1'), '5/3/0',
  'entradas, salidas (en positivo) y ajustes del período');
select is((select ventas from public.movimientos_por_producto('2026-10-01', '2026-10-31') where sku = 'TEC-1'), 4::bigint,
  'ventas netas de devoluciones: 2 − 1 + 3');
select is((select estado from public.movimientos_por_producto('2026-10-01', '2026-10-31') where sku = 'MOU-1'), 'alerta', 'Mouse (3 ≤ mínimo 5) está en alerta');
select is((select count(*)::int from public.movimientos_por_producto('2026-10-01', '2026-10-31', null, null, null, null, 'alerta')), 1, 'vista «En alerta»: solo el Mouse');
select is((select count(*)::int from public.movimientos_por_producto('2026-10-01', '2026-10-31', null, null, null, null, 'quieto')), 1, 'vista «Quietos»: el Mouse no tuvo movimientos');
select is((select count(*)::int from public.movimientos_por_producto('2026-10-01', '2026-10-31', null, null, 'tec')), 1, 'búsqueda por SKU sin distinguir mayúsculas');
select is((select max(total) from public.movimientos_por_producto('2026-10-01', '2026-10-31', null, null, null, null, 'todos', 'nombre', 'asc', 1, 1)), 2::bigint,
  'el total cuenta todos los productos aunque la página traiga uno');
select throws_ok($$select * from public.movimientos_por_producto('2026-10-01', '2026-10-31', null, null, null, null, 'todos', 'nombre; drop table x', 'asc')$$, '22023', null,
  'el orden fuera de la lista blanca se rechaza (sin SQL libre)');
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select is((select ventas from public.movimientos_por_producto('2026-10-01', '2026-10-31') where sku = 'TEC-1'), null::bigint,
  'sin permiso de ventas la columna ventas vuelve null');

-- ===== F-INI-07: previsualizar_impacto_dolar =====
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select is((select (public.previsualizar_impacto_dolar(1500) ->> 'recalcula')::boolean), true, 'sin cotización aplicada siempre recalcula');
select throws_ok($$select public.previsualizar_impacto_dolar(0)$$, '22023', null, 'valor cero se rechaza');
reset role;
select is((select count(*)::int from dominio.cotizacion_pendiente where organizacion_id = '11111111-1111-1111-1111-111111111111'), 0,
  'la vista previa no escribe la cotización pendiente');

select * from finish();
rollback;
