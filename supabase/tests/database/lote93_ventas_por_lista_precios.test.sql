-- MSF-975 (lote 93): `public.ventas_por_lista_precios`, analítica de ventas por lista de precios.
-- Cubre: agrupación por lista y fila sin lista, notas de crédito que restan, borradores/anuladas/presupuestos fuera, período,
-- ajuste otorgado, tiendas fuera de alcance (cero filas), validaciones (22023), permisos (42501) y `anon` sin acceso.
begin;

select plan(17);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'ventas-uno@example.com'),
  ('a1000000-0000-0000-0000-000000000002', 'ventas-dos@example.com'),
  ('a1000000-0000-0000-0000-000000000003', 'tecnico@example.com'),
  ('a2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'tecnico', 'activo'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda Uno'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda Dos'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');
-- `ventas-uno` solo ve Tienda Uno; `ventas-dos` ve las dos tiendas; `tecnico` tiene Ventas en «ninguno».
insert into public.usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('a1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'tecnico');

insert into dominio.listas_precios (id, organizacion_id, nombre, ajuste_pct) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Revendedores', -20),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Recargo', 25);
insert into dominio.clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista');
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Auricular', 'AUR-1', 'ARS', 1000);

-- F1 y F2 (Tienda Uno) y NC1 cuentan; F3 es borrador; F4 está en Tienda Dos; F5 es de septiembre (fuera del período).
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva)
values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000001', '2026-10-05', 'confirmada', 1300, 1573),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000002', '2026-10-15', 'confirmada', 400, 484),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000003', '2026-10-20', 'borrador', 999, 999),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'factura', '0002-00000001', '2026-10-10', 'confirmada', 2500, 3025),
  ('f1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000005', '2026-09-30', 'confirmada', 777, 777);
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, comprobante_origen_id, nc_tipo, nc_concepto)
values
  ('f1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'nota_credito', '0001-00000006', '2026-10-25', 'confirmada', 400, 484,
   'f1000000-0000-0000-0000-000000000002', 'devolucion_productos', 'Devolución');

insert into dominio.comprobantes_venta_lineas
  (organizacion_id, comprobante_id, orden, producto_id, descripcion, cantidad, precio_unitario, escala, deposito_id, subtotal_sin_iva, iva,
   lista_precio_id, lista_ajuste_pct)
select '11111111-1111-1111-1111-111111111111'::uuid, v.comprobante::uuid, v.orden, 'b1000000-0000-0000-0000-000000000001'::uuid, 'Auricular',
       v.cantidad, v.subtotal / v.cantidad, 'x1', d.id, v.subtotal, 0, v.lista::uuid, v.pct
  from (values
    ('f1000000-0000-0000-0000-000000000001', 1, 2, 800.00, 'a1000000-0000-0000-0000-000000000001', -20.00),
    ('f1000000-0000-0000-0000-000000000001', 2, 1, 500.00, null, null),
    ('f1000000-0000-0000-0000-000000000002', 1, 1, 400.00, 'a1000000-0000-0000-0000-000000000001', -20.00),
    ('f1000000-0000-0000-0000-000000000003', 1, 5, 999.00, 'a1000000-0000-0000-0000-000000000001', -20.00),
    ('f1000000-0000-0000-0000-000000000004', 1, 2, 2500.00, 'a1000000-0000-0000-0000-000000000002', 25.00),
    ('f1000000-0000-0000-0000-000000000005', 1, 1, 777.00, 'a1000000-0000-0000-0000-000000000001', -20.00),
    ('f1000000-0000-0000-0000-000000000006', 1, 1, 400.00, 'a1000000-0000-0000-0000-000000000001', -20.00)
  ) as v(comprobante, orden, cantidad, subtotal, lista, pct)
  join dominio.depositos d on d.organizacion_id = '11111111-1111-1111-1111-111111111111' and d.por_defecto;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Tienda Uno sola (ventas-uno): L1 con F1, F2 y la nota; sin lista con F1.
select pg_temp.como('a1000000-0000-0000-0000-000000000001');

select results_eq(
  $$select lista_nombre, ajuste_pct_actual, comprobantes, unidades, ventas_netas, ajuste_otorgado
      from public.ventas_por_lista_precios('2026-10-01', '2026-10-31')$$,
  $$values ('Revendedores'::text, -20.00::numeric, 3::bigint, 2::bigint, 800.00::numeric, -200.00::numeric),
           (null::text, null::numeric, 1::bigint, 1::bigint, 500.00::numeric, 0.00::numeric)$$,
  'agrupa por lista (las notas de crédito restan), deja la fila sin lista al final y no cuenta borradores, otras tiendas ni otro período');
select is((select count(*)::int from public.ventas_por_lista_precios('2026-10-01', '2026-10-31') where lista_id is null), 1, 'la fila sin lista tiene lista_id nulo');
select is((select count(*)::int from public.ventas_por_lista_precios('2026-10-01', '2026-10-31', 'e1000000-0000-0000-0000-000000000002')), 0,
  'una tienda fuera de su alcance devuelve cero filas');
select is((select ventas_netas from public.ventas_por_lista_precios('2026-09-30', '2026-09-30') where lista_nombre = 'Revendedores'), 777.00::numeric,
  'el período es inclusivo en ambos extremos (solo el 30/09)');
select is((select count(*)::int from public.ventas_por_lista_precios('2026-10-06', '2026-10-14')), 0, 'sin ventas en el período, cero filas');
select is((select ventas_netas from public.ventas_por_lista_precios('2026-10-05', '2026-10-05') where lista_nombre = 'Revendedores'), 800.00::numeric,
  'un solo día (frontera inferior)');

-- Las dos tiendas (ventas-dos): suma Recargo, que va primero por ventas.
select pg_temp.como('a1000000-0000-0000-0000-000000000002');
select results_eq(
  $$select lista_nombre, ventas_netas, ajuste_otorgado from public.ventas_por_lista_precios('2026-10-01', '2026-10-31')$$,
  $$values ('Recargo'::text, 2500.00::numeric, 500.00::numeric),
           ('Revendedores'::text, 800.00::numeric, -200.00::numeric),
           (null::text, 500.00::numeric, 0.00::numeric)$$,
  'con las dos tiendas: un recargo positivo se informa como ajuste positivo y las listas se ordenan por ventas');
select is((select count(*)::int from public.ventas_por_lista_precios('2026-10-01', '2026-10-31', 'e1000000-0000-0000-0000-000000000002')), 1,
  'filtrando por Tienda Dos: solo Recargo');

-- Validaciones (cada frontera)
select throws_ok($$select * from public.ventas_por_lista_precios(null, '2026-10-31')$$, '22023', 'Indicá las fechas Desde y Hasta.', 'falta Desde');
select throws_ok($$select * from public.ventas_por_lista_precios('2026-10-01', null)$$, '22023', 'Indicá las fechas Desde y Hasta.', 'falta Hasta');
select throws_ok($$select * from public.ventas_por_lista_precios('2026-10-31', '2026-10-01')$$, '22023', 'Hasta no puede ser anterior a Desde.', 'Hasta anterior a Desde');
select lives_ok($$select * from public.ventas_por_lista_precios('2026-10-01', '2026-10-01')$$, 'Desde = Hasta es válido');
select lives_ok($$select * from public.ventas_por_lista_precios('2021-10-01', '2026-10-01')$$, 'exactamente 5 años es válido');
select throws_ok($$select * from public.ventas_por_lista_precios('2021-10-01', '2026-10-02')$$, '22023', 'El rango máximo es de 5 años.', 'cinco años y un día');

-- Permisos
select pg_temp.como('a1000000-0000-0000-0000-000000000003');
select throws_ok($$select * from public.ventas_por_lista_precios('2026-10-01', '2026-10-31')$$, '42501', 'Sin permiso para ver las ventas por lista de precios.',
  'sin Ventas no hay analítica por lista');

select pg_temp.como('a2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.ventas_por_lista_precios('2026-10-01', '2026-10-31')), 0, 'otra organización no ve nada de la primera');

reset role;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
select throws_ok($$select * from public.ventas_por_lista_precios('2026-10-01', '2026-10-31')$$, '42501', null, 'anon no ejecuta');

select * from finish();
rollback;
