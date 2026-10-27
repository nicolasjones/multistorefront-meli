-- F-VTA-22 (MSF-347, épica MSF-338, spec 20270104-100000-ventas-reportes-basicos, SC-001):
-- vista `analitica.ventas_producto_mas_vendido` (Productos más vendidos).
--
-- Cubre FR-001 (columnas del contrato, grano empresa × producto × depósito × fecha, stock vigente y
-- su estado) y FR-002 (el cálculo cuenta solo lo que cumple `private.comprobante_cuenta_como_facturado`
-- y aplica `private.signo_comprobante`: las notas de crédito restan, presupuestos/borradores/anuladas no
-- cuentan), y el aislamiento: la vista no la leen `anon` ni `authenticated`, solo el rol de Superset, y
-- cada fila expone `organizacion_id`/`empresa_id` para la cláusula `rls` del guest token.
--
-- CA-VTA-22-1: con facturas de ejemplo, la vista suma solo la empresa filtrada y coincide con el
-- listado exportado de comprobantes (`public.exportar_comprobantes`).
--
-- El fixture corre como postgres (RLS no aplica); las verificaciones que necesitan sesión usan el
-- rol `authenticated` con el JWT de quien corresponde.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into public.clientes (id, organizacion_id, nombre, tipo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Distribuidora Ñandú', 'mayorista'),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Cliente de la Dos', 'minorista');

-- San Javucho y Mundo JC (organización Uno); Empresa Dos (organización Dos).
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-0000000000e1', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('ca100000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Periféricos'),
  ('ca100000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Accesorios'),
  ('ca200000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Accesorios');

insert into dominio.productos (id, organizacion_id, nombre, sku, categoria_id, precio_lista) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Teclado', 'TEC-1', 'ca100000-0000-0000-0000-000000000001', 1000),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mouse', 'MOU-1', 'ca100000-0000-0000-0000-000000000002', 500),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Teclado Dos', 'TEC-2', 'ca200000-0000-0000-0000-000000000001', 1000);

insert into dominio.depositos (id, organizacion_id, nombre, por_defecto) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Central', true),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Sucursal', false),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Depósito Dos', true);

-- Stock vigente: Teclado disponible, Mouse bajo (3 ≤ 5), Teclado Dos sin stock.
-- Se escriben explícitos (y no se espera el trigger que crea la existencia al dar de alta el
-- producto): el fixture no depende de ese trigger.
insert into dominio.existencias (producto_id, organizacion_id, cantidad, minimo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 5),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 3, 5),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 0, 0)
on conflict (producto_id) do update
  set cantidad = excluded.cantidad, minimo = excluded.minimo;

-- Comprobantes de la organización Uno.
--   V1 factura confirmada      (Teclado ×2, Central)      1.000 + 210 = 1.210
--   V2 nota de crédito confirmada (Teclado ×1, Central)     500 + 105 =   605
--   V3 presupuesto             (Mouse ×4, Central)       2.000 + 420 = 2.420
--   V4 factura anulada         (Mouse ×3, Sucursal)      3.000 + 630 = 3.630
--   V5 factura borrador        (Mouse ×4, Sucursal)      4.000 + 840 = 4.840
--   V6 factura confirmada de Mundo JC (Teclado ×9 + Mouse ×3, Central) 10.500 + 2.205 = 12.705
--   V7 factura confirmada de San Javucho del mes anterior (Teclado ×7, Sucursal) 7.000 + 1.470 = 8.470
insert into dominio.comprobantes_venta
  (organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva)
values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'factura',      '00000001', 1, '2026-10-05', 'confirmada', 1000, 1210),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'presupuesto',  '00000001', 1, '2026-10-07', 'pendiente',  2000, 2420),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'factura',      '00000003', 3, '2026-10-08', 'anulada',    3000, 3630),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'factura',      '00000004', 4, '2026-10-09', 'borrador',   4000, 4840),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e2', 'c5000000-0000-0000-0000-000000000001', 'factura',      '00000001', 1, '2026-10-05', 'confirmada', 10500, 12705),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'factura',      '00000005', 5, '2026-09-01', 'confirmada', 7000, 8470),
  -- Otra organización: no se mezcla con la de arriba.
  ('22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-0000000000e1', 'c6000000-0000-0000-0000-000000000001', 'factura',      '00000001', 1, '2026-10-05', 'confirmada', 6000, 7260);

-- La nota de crédito cuelga de su factura (una nota siempre acredita una factura).
insert into dominio.comprobantes_venta
  (organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva, comprobante_origen_id, nc_tipo)
values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'nota_credito', '00000002', 2, '2026-10-06', 'confirmada', 500, 605,
   (select id from dominio.comprobantes_venta
     where organizacion_id = '11111111-1111-1111-1111-111111111111'
       and empresa_id = 'a1000000-0000-0000-0000-0000000000e1'
       and tipo = 'factura' and numero = '00000001'),
   'devolucion_productos');

insert into dominio.comprobantes_venta_lineas
  (organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad, precio_unitario, escala, deposito_id, subtotal_sin_iva, iva)
values
  ('11111111-1111-1111-1111-111111111111', (select id from dominio.comprobantes_venta where organizacion_id = '11111111-1111-1111-1111-111111111111' and numero = '00000001' and empresa_id = 'a1000000-0000-0000-0000-0000000000e1' and tipo = 'factura'),    1, 'b1000000-0000-0000-0000-000000000001', 'Teclado', 'TEC-1', 2, 500, 'x1', 'd1000000-0000-0000-0000-000000000001', 1000, 210),
  ('11111111-1111-1111-1111-111111111111', (select id from dominio.comprobantes_venta where organizacion_id = '11111111-1111-1111-1111-111111111111' and numero = '00000002' and empresa_id = 'a1000000-0000-0000-0000-0000000000e1' and tipo = 'nota_credito'), 1, 'b1000000-0000-0000-0000-000000000001', 'Teclado', 'TEC-1', 1, 500, 'x1', 'd1000000-0000-0000-0000-000000000001',  500, 105),
  ('11111111-1111-1111-1111-111111111111', (select id from dominio.comprobantes_venta where organizacion_id = '11111111-1111-1111-1111-111111111111' and numero = '00000001' and empresa_id = 'a1000000-0000-0000-0000-0000000000e1' and tipo = 'presupuesto'),  1, 'b1000000-0000-0000-0000-000000000002', 'Mouse',   'MOU-1', 4, 500, 'x1', 'd1000000-0000-0000-0000-000000000001', 2000, 420),
  ('11111111-1111-1111-1111-111111111111', (select id from dominio.comprobantes_venta where organizacion_id = '11111111-1111-1111-1111-111111111111' and numero = '00000003' and empresa_id = 'a1000000-0000-0000-0000-0000000000e1' and tipo = 'factura'),    1, 'b1000000-0000-0000-0000-000000000002', 'Mouse',   'MOU-1', 3, 1000, 'x1', 'd1000000-0000-0000-0000-000000000002', 3000, 630),
  ('11111111-1111-1111-1111-111111111111', (select id from dominio.comprobantes_venta where organizacion_id = '11111111-1111-1111-1111-111111111111' and numero = '00000004' and empresa_id = 'a1000000-0000-0000-0000-0000000000e1' and tipo = 'factura'),    1, 'b1000000-0000-0000-0000-000000000002', 'Mouse',   'MOU-1', 4, 1000, 'x1', 'd1000000-0000-0000-0000-000000000002', 4000, 840),
  ('11111111-1111-1111-1111-111111111111', (select id from dominio.comprobantes_venta where organizacion_id = '11111111-1111-1111-1111-111111111111' and numero = '00000001' and empresa_id = 'a1000000-0000-0000-0000-0000000000e2' and tipo = 'factura'),    1, 'b1000000-0000-0000-0000-000000000001', 'Teclado', 'TEC-1', 9, 1000, 'x1', 'd1000000-0000-0000-0000-000000000001', 9000, 1890),
  ('11111111-1111-1111-1111-111111111111', (select id from dominio.comprobantes_venta where organizacion_id = '11111111-1111-1111-1111-111111111111' and numero = '00000001' and empresa_id = 'a1000000-0000-0000-0000-0000000000e2' and tipo = 'factura'),    2, 'b1000000-0000-0000-0000-000000000002', 'Mouse',   'MOU-1', 3, 500, 'x1', 'd1000000-0000-0000-0000-000000000001', 1500,  315),
  ('11111111-1111-1111-1111-111111111111', (select id from dominio.comprobantes_venta where organizacion_id = '11111111-1111-1111-1111-111111111111' and numero = '00000005' and empresa_id = 'a1000000-0000-0000-0000-0000000000e1' and tipo = 'factura'),    1, 'b1000000-0000-0000-0000-000000000001', 'Teclado', 'TEC-1', 7, 1000, 'x1', 'd1000000-0000-0000-0000-000000000002', 7000, 1470),
  ('22222222-2222-2222-2222-222222222222', (select id from dominio.comprobantes_venta where organizacion_id = '22222222-2222-2222-2222-222222222222' and numero = '00000001' and empresa_id = 'a2000000-0000-0000-0000-0000000000e1' and tipo = 'factura'),    1, 'b2000000-0000-0000-0000-000000000001', 'Teclado Dos', 'TEC-2', 6, 1000, 'x1', 'd2000000-0000-0000-0000-000000000001', 6000, 1260);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Contrato de la vista (FR-001) y superficie de acceso
-- ============================================================================

select columns_are(
  'analitica', 'ventas_producto_mas_vendido',
  array['organizacion_id', 'empresa_id', 'empresa_nombre', 'producto_id', 'producto_nombre', 'sku',
        'categoria', 'deposito_id', 'deposito_nombre', 'unidades', 'facturado', 'stock_hoy',
        'stock_estado', 'fecha'],
  'la vista expone exactamente las columnas del contrato'
);

select ok(
  not has_table_privilege('anon', 'analitica.ventas_producto_mas_vendido', 'select')
  and not has_table_privilege('authenticated', 'analitica.ventas_producto_mas_vendido', 'select'),
  'anon ni authenticated leen la vista'
);
select ok(
  has_table_privilege('superset_analitica', 'analitica.ventas_producto_mas_vendido', 'select'),
  'el rol de Superset lee la vista'
);

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from analitica.ventas_producto_mas_vendido$$,
  '42501', null, 'authenticated no puede leer la vista ni siquiera con sesión'
);
reset role;

-- Las funciones de apoyo son `security definer` y solo las ejecuta el rol de Superset.
select is(
  (select count(*)::int from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'analitica'
     and p.proname in ('comprobante_cuenta_como_facturado', 'signo_comprobante', 'stock_de_producto')
     and p.prosecdef),
  3, 'las tres funciones de apoyo de `analitica` son security definer'
);
select is(
  (select count(*)::int from unnest(array[
    'analitica.comprobante_cuenta_como_facturado(text,text)',
    'analitica.signo_comprobante(text)',
    'analitica.stock_de_producto(uuid,uuid)'
  ]) as f where has_function_privilege('anon', f::regprocedure, 'execute')
     or has_function_privilege('authenticated', f::regprocedure, 'execute')),
  0, 'anon ni authenticated ejecutan las funciones de apoyo'
);
select is(
  (select count(*)::int from unnest(array[
    'analitica.comprobante_cuenta_como_facturado(text,text)',
    'analitica.signo_comprobante(text)',
    'analitica.stock_de_producto(uuid,uuid)'
  ]) as f where has_function_privilege('superset_analitica', f::regprocedure, 'execute')),
  3, 'el rol de Superset ejecuta las funciones de apoyo'
);

-- Sin tablas nuevas: `analitica` no tiene tablas y ninguna tabla expuesta quedó sin RLS
-- (la prueba `rls_en_toda_tabla` sigue verde).
select is(
  (select count(*)::int from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'analitica' and c.relkind in ('r', 'p')),
  0, 'el esquema analitica no tiene tablas (la vista es solo lectura)'
);
select is(
  (select coalesce(array_agg(n.nspname || '.' || c.relname order by n.nspname, c.relname), array[]::text[])
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'dominio')
      and c.relkind in ('r', 'p')
      and not c.relispartition
      and not c.relrowsecurity
      and not exists (
        select 1 from pg_depend d
         where d.classid = 'pg_class'::regclass
           and d.objid = c.oid
           and d.deptype = 'e')),
  array[]::text[], 'ninguna tabla de public ni de dominio quedó sin RLS'
);

-- ============================================================================
-- Lo que cuenta y lo que no (FR-002)
-- ============================================================================

select is(
  (select count(*)::int from analitica.ventas_producto_mas_vendido),
  6, 'la vista tiene una fila por empresa × producto × depósito × fecha con ventas que cuentan'
);

-- El Mouse solo aparece en un presupuesto, una anulada y un borrador de San Javucho: no cuenta.
select is(
  (select count(*)::int from analitica.ventas_producto_mas_vendido
    where producto_id = 'b1000000-0000-0000-0000-000000000002'
      and empresa_id = 'a1000000-0000-0000-0000-0000000000e1'),
  0, 'presupuestos, anuladas y borradores no cuentan: el Mouse no tiene filas en San Javucho'
);

-- La nota de crédito resta: su fila va con unidades y monto negativos.
select is(
  (select row(unidades, facturado)::text from analitica.ventas_producto_mas_vendido
    where empresa_id = 'a1000000-0000-0000-0000-0000000000e1'
      and producto_id = 'b1000000-0000-0000-0000-000000000001'
      and fecha = '2026-10-06'),
  '(-1,-605.00)', 'la nota de crédito resta una unidad y 605 (el total con IVA de la nota)'
);

-- ============================================================================
-- Suma por empresa y coincidencia con el listado exportado (CA-VTA-22-1)
-- ============================================================================

select is(
  (select row(sum(unidades), sum(facturado))::text from analitica.ventas_producto_mas_vendido
    where empresa_id = 'a1000000-0000-0000-0000-0000000000e1'),
  '(8,9075.00)', 'San Javucho: 2 − 1 + 7 unidades y 1.210 − 605 + 8.470 de facturado'
);
select is(
  (select row(sum(unidades), sum(facturado))::text from analitica.ventas_producto_mas_vendido
    where empresa_id = 'a1000000-0000-0000-0000-0000000000e2'),
  '(12,12705.00)', 'Mundo JC: solo sus propias ventas (9 + 3 unidades, 10.890 + 1.815)'
);

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select is(
  (select sum(total) from public.exportar_comprobantes('comprobantes', p_estado => 'confirmada', p_empresa_id => 'a1000000-0000-0000-0000-0000000000e1')),
  (select sum(facturado) from analitica.ventas_producto_mas_vendido where empresa_id = 'a1000000-0000-0000-0000-0000000000e1'),
  'San Javucho: el facturado de la vista coincide con el listado exportado de comprobantes'
);
select is(
  (select sum(total) from public.exportar_comprobantes('comprobantes', p_estado => 'confirmada', p_empresa_id => 'a1000000-0000-0000-0000-0000000000e2')),
  (select sum(facturado) from analitica.ventas_producto_mas_vendido where empresa_id = 'a1000000-0000-0000-0000-0000000000e2'),
  'Mundo JC: el facturado de la vista coincide con el listado exportado de comprobantes'
);
select is(
  (select total from public.exportar_comprobantes('comprobantes', p_estado => 'confirmada', p_empresa_id => 'a1000000-0000-0000-0000-0000000000e1')
    where numero = '00000002'),
  (-605)::numeric, 'la nota de crédito aparece con el total negativo en el listado exportado'
);
reset role;

-- ============================================================================
-- Filtros del tablero: período, categoría y ubicación de stock
-- ============================================================================

select is(
  (select row(sum(unidades), sum(facturado))::text from analitica.ventas_producto_mas_vendido
    where empresa_id = 'a1000000-0000-0000-0000-0000000000e1'
      and fecha between '2026-10-01' and '2026-10-31'),
  '(1,605.00)', 'el filtro de período deja solo octubre: la venta de septiembre queda afuera'
);
select is(
  (select count(*)::int from analitica.ventas_producto_mas_vendido where categoria = 'Periféricos'),
  4, 'el filtro de categoría deja las cuatro filas del Teclado (tres de San Javucho y una de Mundo JC)'
);
select is(
  (select count(*)::int from analitica.ventas_producto_mas_vendido where categoria = 'Accesorios'),
  2, 'el filtro de categoría deja las filas del Mouse y del Teclado Dos'
);
select is(
  (select count(*)::int from analitica.ventas_producto_mas_vendido
    where empresa_id = 'a1000000-0000-0000-0000-0000000000e1' and deposito_nombre = 'Sucursal'),
  1, 'el filtro de ubicación de stock deja solo la venta de la Sucursal'
);
select is(
  (select count(*)::int from analitica.ventas_producto_mas_vendido
    where empresa_id = 'a1000000-0000-0000-0000-0000000000e1' and deposito_nombre = 'Central'),
  2, 'el filtro de ubicación de stock deja las dos ventas del Central'
);

-- ============================================================================
-- Identidad visible y stock (FR-001)
-- ============================================================================

select is(
  (select row(producto_nombre, sku, empresa_nombre, deposito_nombre)::text
     from analitica.ventas_producto_mas_vendido
    where empresa_id = 'a1000000-0000-0000-0000-0000000000e1'
      and producto_id = 'b1000000-0000-0000-0000-000000000001'
      and fecha = '2026-10-05'),
  '(Teclado,TEC-1,"San Javucho",Central)', 'la fila muestra producto, SKU, tienda y depósito'
);
select is(
  (select row(stock_hoy, stock_estado)::text from analitica.ventas_producto_mas_vendido
    where producto_id = 'b1000000-0000-0000-0000-000000000001' and fecha = '2026-10-05'),
  '(10,disponible)', 'el Teclado trae su stock vigente y su estado'
);
select is(
  (select row(stock_hoy, stock_estado)::text from analitica.ventas_producto_mas_vendido
    where producto_id = 'b1000000-0000-0000-0000-000000000002'),
  '(3,stock_bajo)', 'el Mouse trae su stock vigente y su estado'
);
select is(
  (select row(stock_hoy, stock_estado)::text from analitica.ventas_producto_mas_vendido
    where producto_id = 'b2000000-0000-0000-0000-000000000001'),
  '(0,sin_stock)', 'el Teclado Dos trae su stock vigente y su estado'
);

-- ============================================================================
-- Aislamiento por organización (la cláusula `rls` del token separa por esta columna)
-- ============================================================================

select is(
  (select count(*)::int from analitica.ventas_producto_mas_vendido
    where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  5, 'la organización Uno tiene sus cinco filas'
);
select is(
  (select count(*)::int from analitica.ventas_producto_mas_vendido
    where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  1, 'la organización Dos tiene su propia fila, sin mezclas'
);
select is(
  (select sum(facturado) from analitica.ventas_producto_mas_vendido
    where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  7260::numeric, 'la organización Dos suma solo lo suyo'
);

select * from finish();
rollback;
