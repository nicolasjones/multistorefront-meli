-- F-INI-04 (MSF-820, épica MSF-824, FR-001..FR-006): `public.resumen_inicio_periodo`.
-- Cubre: la nota de crédito resta, presupuestos/anuladas no cuentan, variación contra el período
-- anterior, filtro por tienda y por depósito, aislamiento entre organizaciones, bloque de ventas
-- null sin permiso (rol sin `ventas`) y `anon` sin ejecución.
begin;

select plan(23);

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
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Cliente Uno', 'mayorista'),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Cliente Dos', 'minorista');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-0000000000e1', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Teclado', 'TEC-1', 1000, true),
  ('b1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'Producto viejo', 'VIE-1', 100, false),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Teclado Dos', 'TEC-2', 1000, true);

delete from dominio.depositos
 where por_defecto
   and organizacion_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
insert into dominio.depositos (id, organizacion_id, nombre, por_defecto) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Central', true),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Sucursal', false),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Depósito Dos', true);

insert into dominio.existencias (producto_id, organizacion_id, cantidad, minimo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 5),
  ('b1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 0, 0),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 99, 0)
on conflict (producto_id) do update set cantidad = excluded.cantidad, minimo = excluded.minimo;

-- Movimientos de octubre (Central). Teclado (activo): salida de 3 el 10/10 y entrada de 5 el 12/10.
-- «Producto viejo» (inactivo) tiene +100 el 20/10: NO debe correr la serie ni el stock de hoy.
insert into dominio.motivos_movimiento (id, organizacion_id, nombre) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Motivo de prueba');
insert into dominio.movimientos_stock
  (organizacion_id, producto_id, tipo, cantidad, diferencia, saldo, motivo_id, fecha, deposito_id)
values
  ('11111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-000000000001', 'salida', 3, -3, 7, 'a0000000-0000-0000-0000-000000000001', '2026-10-10', 'd1000000-0000-0000-0000-000000000001'),
  ('11111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-000000000001', 'entrada', 5, 5, 12, 'a0000000-0000-0000-0000-000000000001', '2026-10-12', 'd1000000-0000-0000-0000-000000000001'),
  ('11111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-000000000009', 'entrada', 100, 100, 100, 'a0000000-0000-0000-0000-000000000001', '2026-10-20', 'd1000000-0000-0000-0000-000000000001');

-- Octubre 2026 (período) y septiembre (anterior). Organización Uno:
--   F1 factura San Javucho 05/10  Teclado ×2 Central   1.000 + 210 = 1.210
--   N1 nota de crédito SJ 06/10   Teclado ×1 Central     500 + 105 =   605
--   P1 presupuesto SJ 07/10       (no cuenta)
--   A1 factura anulada SJ 08/10   (no cuenta)
--   F2 factura Mundo JC 09/10     Teclado ×3 Sucursal  3.000 + 630 = 3.630
--   F0 factura SJ 15/09 (período anterior) ×1 Central   1.000 + 210 = 1.210
insert into dominio.comprobantes_venta
  (organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva)
values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'factura',     '00000001', 1, '2026-10-05', 'confirmada', 1000, 1210),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'presupuesto', '00000001', 1, '2026-10-07', 'pendiente',  2000, 2420),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'factura',     '00000003', 3, '2026-10-08', 'anulada',    3000, 3630),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e2', 'c5000000-0000-0000-0000-000000000001', 'factura',     '00000001', 1, '2026-10-09', 'confirmada', 3000, 3630),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'factura',     '00000005', 5, '2026-09-15', 'confirmada', 1000, 1210),
  ('22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-0000000000e1', 'c6000000-0000-0000-0000-000000000001', 'factura',     '00000001', 1, '2026-10-05', 'confirmada', 9000, 10890);

insert into dominio.comprobantes_venta
  (organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva, comprobante_origen_id, nc_tipo)
values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'nota_credito', '00000002', 2, '2026-10-06', 'confirmada', 500, 605,
   (select id from dominio.comprobantes_venta where organizacion_id = '11111111-1111-1111-1111-111111111111'
      and empresa_id = 'a1000000-0000-0000-0000-0000000000e1' and tipo = 'factura' and numero = '00000001'),
   'devolucion_productos');

create function pg_temp.linea(p_org uuid, p_emp uuid, p_tipo text, p_num text, p_prod uuid, p_cant int, p_dep uuid, p_sub numeric, p_iva numeric)
returns void language sql as $$
  insert into dominio.comprobantes_venta_lineas
    (organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad, precio_unitario, escala, deposito_id, subtotal_sin_iva, iva)
  values (p_org, (select id from dominio.comprobantes_venta where organizacion_id = p_org and empresa_id = p_emp and tipo = p_tipo and numero = p_num),
          1, p_prod, 'Teclado', 'TEC-1', p_cant, 500, 'x1', p_dep, p_sub, p_iva);
$$;
select pg_temp.linea('11111111-1111-1111-1111-111111111111','a1000000-0000-0000-0000-0000000000e1','factura','00000001','b1000000-0000-0000-0000-000000000001',2,'d1000000-0000-0000-0000-000000000001',1000,210);
select pg_temp.linea('11111111-1111-1111-1111-111111111111','a1000000-0000-0000-0000-0000000000e1','nota_credito','00000002','b1000000-0000-0000-0000-000000000001',1,'d1000000-0000-0000-0000-000000000001',500,105);
select pg_temp.linea('11111111-1111-1111-1111-111111111111','a1000000-0000-0000-0000-0000000000e2','factura','00000001','b1000000-0000-0000-0000-000000000001',3,'d1000000-0000-0000-0000-000000000002',3000,630);
select pg_temp.linea('11111111-1111-1111-1111-111111111111','a1000000-0000-0000-0000-0000000000e1','factura','00000005','b1000000-0000-0000-0000-000000000001',1,'d1000000-0000-0000-0000-000000000001',1000,210);
select pg_temp.linea('22222222-2222-2222-2222-222222222222','a2000000-0000-0000-0000-0000000000e1','factura','00000001','b2000000-0000-0000-0000-000000000001',9,'d2000000-0000-0000-0000-000000000001',9000,1890);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Ventas = 1.210 (F1) − 605 (N1) + 3.630 (F2) = 4.235; 2 facturas; unidades 2 − 1 + 3 = 4.
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select is((public.resumen_inicio_periodo('2026-10-01', '2026-10-31') -> 'ventas' ->> 'monto')::numeric, 4235::numeric,
  'monto del período: la nota de crédito resta y presupuestos/anuladas no cuentan');
select is((public.resumen_inicio_periodo('2026-10-01', '2026-10-31') -> 'ventas' ->> 'comprobantes')::int, 2,
  'comprobantes = solo facturas del período');
select is((public.resumen_inicio_periodo('2026-10-01', '2026-10-31') -> 'ventas' ->> 'unidades')::int, 4,
  'unidades vendidas netas de devoluciones');
select is((public.resumen_inicio_periodo('2026-10-01', '2026-10-31') -> 'ventas' ->> 'ticket_promedio')::numeric, 2117.50::numeric,
  'ticket promedio = monto / comprobantes');
select is((public.resumen_inicio_periodo('2026-10-01', '2026-10-31') -> 'ventas' ->> 'devoluciones_monto')::numeric, 605::numeric,
  'devoluciones = notas de crédito del período');
select is((public.resumen_inicio_periodo('2026-10-01', '2026-10-31') -> 'ventas' ->> 'anterior_monto')::numeric, 1210::numeric,
  'período anterior de igual largo (31 días hacia atrás)');
select is((public.resumen_inicio_periodo('2026-10-01', '2026-10-31', 'a1000000-0000-0000-0000-0000000000e2') -> 'ventas' ->> 'monto')::numeric, 3630::numeric,
  'filtro por tienda: solo Mundo JC');
select is((public.resumen_inicio_periodo('2026-10-01', '2026-10-31', null, 'd1000000-0000-0000-0000-000000000002') -> 'ventas' ->> 'unidades')::int, 3,
  'filtro por depósito: solo lo que salió de Sucursal');
select is((public.resumen_inicio_periodo('2026-10-01', '2026-10-31') -> 'stock' ->> 'unidades')::int, 10,
  'stock hoy de la organización (no mezcla la otra organización)');
select is(jsonb_array_length(public.resumen_inicio_periodo('2026-10-01', '2026-10-31') -> 'serie'), 31,
  'la serie trae un punto por día del período');
select throws_ok($$select public.resumen_inicio_periodo('2026-10-31', '2026-10-01')$$, '22023', null,
  'un rango invertido se rechaza');


-- Serie de stock (stock de hoy = 10, solo productos activos): al cierre del 09/10 = 10 − (−3 + 5) = 8; del 11/10 = 10 − 5 = 5; del 31/10 = 10.
select is((select (e ->> 'stock')::int from jsonb_array_elements(public.resumen_inicio_periodo('2026-10-01', '2026-10-31') -> 'serie') e where e ->> 'dia' = '2026-10-09'), 8,
  'serie de stock: cierre del 09/10 (descuenta lo movido después)');
select is((select (e ->> 'stock')::int from jsonb_array_elements(public.resumen_inicio_periodo('2026-10-01', '2026-10-31') -> 'serie') e where e ->> 'dia' = '2026-10-11'), 5,
  'serie de stock: cierre del 11/10');
select is((select (e ->> 'stock')::int from jsonb_array_elements(public.resumen_inicio_periodo('2026-10-01', '2026-10-31') -> 'serie') e where e ->> 'dia' = '2026-10-31'), 10,
  'serie de stock: el último día coincide con el stock de hoy aunque un producto inactivo tenga movimientos');
select is((public.resumen_inicio_periodo('2026-10-01', '2026-10-31') -> 'stock' ->> 'entradas_unidades')::int, 5,
  'entradas del período: solo productos activos y motivo común (la entrada de 100 del producto inactivo no cuenta)');
select is((public.resumen_inicio_periodo('2026-10-01', '2026-10-31') -> 'ventas' ->> 'anterior_comprobantes')::int, 1,
  'comprobantes del período anterior');
select is(public.resumen_inicio_periodo('2026-10-01', '2026-10-31', null, 'd2000000-0000-0000-0000-000000000001') -> 'ventas', 'null'::jsonb,
  'un depósito de otra organización apaga ventas');
select is(public.resumen_inicio_periodo('2026-10-01', '2026-10-31', null, 'd2000000-0000-0000-0000-000000000001') -> 'stock', 'null'::jsonb,
  'un depósito de otra organización apaga stock');
select is(public.resumen_inicio_periodo('2026-10-01', '2026-10-31', 'a2000000-0000-0000-0000-0000000000e1') -> 'ventas', 'null'::jsonb,
  'una tienda de otra organización no devuelve ventas');
select throws_ok($$select public.resumen_inicio_periodo('2025-01-01', '2026-10-31')$$, '22023', null, 'más de 366 días se rechaza');

-- El técnico no tiene `ventas`: el bloque de ventas vuelve null; sí ve stock.
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select is(public.resumen_inicio_periodo('2026-10-01', '2026-10-31') -> 'ventas', 'null'::jsonb,
  'sin permiso sobre ventas el bloque vuelve null (no solo se oculta en pantalla)');

-- Otra organización: no ve nada de la Uno.
select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select is((public.resumen_inicio_periodo('2026-10-01', '2026-10-31') -> 'ventas' ->> 'monto')::numeric, 10890::numeric,
  'aislamiento entre organizaciones: la Dos ve solo lo suyo');

reset role;
select ok(not has_function_privilege('anon', 'public.resumen_inicio_periodo(date,date,uuid,uuid)', 'EXECUTE'),
  'anon no ejecuta la RPC');

select * from finish();
rollback;
