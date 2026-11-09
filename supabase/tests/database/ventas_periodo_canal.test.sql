-- F-REP-05 (MSF-248, épica MSF-192, spec 20270201-100000-rentabilidad-real-y-reportes-de-ventas, SC-010):
-- vista `analitica.ventas_periodo_canal` (Ventas por período y canal).
--
-- Cubre FR-012: columnas del contrato, grano empresa (canal) × fecha, `comprobantes` = solo facturas,
-- `unidades` y `facturado` netos (la nota de crédito resta), el cuadre del facturado con `total_con_iva`
-- de los comprobantes, la exclusión de presupuestos / borradores / anuladas, el rango, el vacío y que no
-- exista un canal de Mercado Libre. Sin costo ni margen y sin acceso para `anon`/`authenticated`.
--
-- Fechas relativas al reloj de la base (`current_date - n`): el test no depende del día en que corre.
-- El fixture corre como postgres (RLS no aplica); la verificación de acceso usa el rol `authenticated`.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'admin-uno@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');

insert into public.clientes (id, organizacion_id, nombre, tipo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Distribuidora Ñandú', 'mayorista'),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Cliente de la Dos', 'minorista');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a1000000-0000-0000-0000-0000000000e3', '11111111-1111-1111-1111-111111111111', 'Tienda Sin Ventas'),
  ('a2000000-0000-0000-0000-0000000000e1', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Teclado', 'TEC-1', 1000),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Teclado Dos', 'TEC-2', 1000);

-- Se reemplazan los depósitos principales sembrados (un solo `por_defecto` por organización).
delete from dominio.depositos
 where por_defecto
   and organizacion_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

insert into dominio.depositos (id, organizacion_id, nombre, por_defecto) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Central', true),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Depósito Dos', true);

-- Comprobantes de la organización Uno (día = hoy − n).
--   V1  factura  San Javucho  (hoy−3)   1.000 + 210 = 1.210   2 u
--   V2  factura  San Javucho  (hoy−3)     500 + 105 =   605   1 u   (mismo día que V1: se suman)
--   V3  nota de crédito San Javucho (hoy−2)  200 + 42 = 242    1 u   (resta)
--   V4  presupuesto San Javucho (hoy−3)    2.000 + 420 = 2.420  4 u   (no cuenta)
--   V5  factura anulada San Javucho (hoy−3) 3.000 + 630 = 3.630  3 u   (no cuenta)
--   V6  factura borrador San Javucho (hoy−3) 4.000 + 840 = 4.840 4 u   (no cuenta)
--   V7  factura  Mundo JC     (hoy−3)  10.500 + 2.205 = 12.705 12 u
--   V8  factura  San Javucho  (hoy−40)  7.000 + 1.470 = 8.470   7 u   (fuera del rango del mes)
insert into dominio.comprobantes_venta
  (organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva)
values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'factura',     '00000001', 1, current_date - 3,  'confirmada', 1000, 1210),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'factura',     '00000002', 2, current_date - 3,  'confirmada',  500,  605),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'presupuesto', '00000004', 4, current_date - 3,  'pendiente',  2000, 2420),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'factura',     '00000005', 5, current_date - 3,  'anulada',    3000, 3630),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'factura',     '00000006', 6, current_date - 3,  'borrador',   4000, 4840),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e2', 'c5000000-0000-0000-0000-000000000001', 'factura',     '00000001', 1, current_date - 3,  'confirmada', 10500, 12705),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'factura',     '00000008', 8, current_date - 40, 'confirmada', 7000, 8470),
  -- Otra organización: no se mezcla con la de arriba.
  ('22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-0000000000e1', 'c6000000-0000-0000-0000-000000000001', 'factura',     '00000001', 1, current_date - 3,  'confirmada', 6000, 7260);

-- La nota de crédito cuelga de su factura (una nota siempre acredita una factura).
insert into dominio.comprobantes_venta
  (organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva, comprobante_origen_id, nc_tipo)
values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'nota_credito', '00000003', 3, current_date - 2, 'confirmada', 200, 242,
   (select id from dominio.comprobantes_venta
     where organizacion_id = '11111111-1111-1111-1111-111111111111'
       and empresa_id = 'a1000000-0000-0000-0000-0000000000e1'
       and tipo = 'factura' and numero = '00000001'),
   'devolucion_productos');

-- Una línea por comprobante o más: se busca el comprobante por organización, empresa, tipo y número.
create function pg_temp.linea(p_org uuid, p_empresa uuid, p_tipo text, p_numero text, p_orden int, p_producto uuid, p_deposito uuid, p_cantidad numeric, p_neto numeric, p_iva numeric)
returns void language sql as $$
  insert into dominio.comprobantes_venta_lineas
    (organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad, precio_unitario, escala, deposito_id, subtotal_sin_iva, iva)
  select p_org, v.id, p_orden, p_producto, 'Línea', 'COD', p_cantidad, p_neto / p_cantidad, 'x1', p_deposito, p_neto, p_iva
    from dominio.comprobantes_venta v
   where v.organizacion_id = p_org and v.empresa_id = p_empresa and v.tipo = p_tipo and v.numero = p_numero
$$;

select pg_temp.linea('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'factura',      '00000001', 1, 'b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 2, 1000, 210);
select pg_temp.linea('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'factura',      '00000002', 1, 'b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 1, 500, 105);
select pg_temp.linea('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'nota_credito', '00000003', 1, 'b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 1, 200, 42);
select pg_temp.linea('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'presupuesto',  '00000004', 1, 'b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 4, 2000, 420);
select pg_temp.linea('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'factura',      '00000005', 1, 'b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 3, 3000, 630);
select pg_temp.linea('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'factura',      '00000006', 1, 'b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 4, 4000, 840);
-- Dos líneas en el mismo comprobante: el total con IVA de la cabecera NO se multiplica por sus líneas.
select pg_temp.linea('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e2', 'factura',      '00000001', 1, 'b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 9, 9000, 1890);
select pg_temp.linea('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e2', 'factura',      '00000001', 2, 'b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 3, 1500, 315);
select pg_temp.linea('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'factura',      '00000008', 1, 'b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 7, 7000, 1470);
select pg_temp.linea('22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-0000000000e1', 'factura',      '00000001', 1, 'b2000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 6, 6000, 1260);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Contrato de la vista (FR-012) y superficie de acceso
-- ============================================================================

select columns_are(
  'analitica', 'ventas_periodo_canal',
  array['organizacion_id', 'empresa_id', 'empresa_nombre', 'fecha', 'comprobantes', 'unidades', 'facturado'],
  'la vista expone exactamente las columnas del contrato, sin costo ni margen'
);

select ok(
  not has_table_privilege('anon', 'analitica.ventas_periodo_canal', 'select')
  and not has_table_privilege('authenticated', 'analitica.ventas_periodo_canal', 'select'),
  'anon ni authenticated leen la vista'
);
select ok(
  has_table_privilege('superset_analitica', 'analitica.ventas_periodo_canal', 'select'),
  'el rol de Superset lee la vista'
);

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from analitica.ventas_periodo_canal$$,
  '42501', null, 'authenticated no puede leer la vista ni siquiera con sesión'
);
reset role;

select is(
  (select count(*)::int from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'analitica' and c.relkind in ('r', 'p')),
  0, 'el esquema analitica no tiene tablas (la vista es solo lectura)'
);

-- ============================================================================
-- Qué cuenta y cómo se suma (FR-012)
-- ============================================================================

-- Grano: una fila por empresa × fecha. San Javucho: hoy−3, hoy−2 (la nota de crédito) y hoy−40; Mundo JC:
-- hoy−3. Presupuesto, anulada y borrador no suman filas. «Tienda Sin Ventas» no tiene filas.
select is(
  (select count(*)::int from analitica.ventas_periodo_canal
    where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  4, 'una fila por empresa × fecha con comprobantes que cuentan'
);
select is(
  (select count(*)::int from analitica.ventas_periodo_canal
    where empresa_id = 'a1000000-0000-0000-0000-0000000000e3'),
  0, 'una tienda sin ventas no tiene filas (estado vacío)'
);

-- Dos facturas el mismo día: 2 comprobantes, 3 unidades, 1.210 + 605 = 1.815. Presupuesto, anulada y
-- borrador de ese día (con 4 + 3 + 4 unidades) no cuentan.
select is(
  (select row(comprobantes, unidades, facturado)::text from analitica.ventas_periodo_canal
    where empresa_id = 'a1000000-0000-0000-0000-0000000000e1' and fecha = current_date - 3),
  '(2,3,1815.00)', 'dos facturas del día: 2 comprobantes, 3 unidades y 1.815 con IVA; presupuesto, anulada y borrador fuera'
);

-- La nota de crédito resta importe y unidades y NO suma un comprobante.
select is(
  (select row(comprobantes, unidades, facturado)::text from analitica.ventas_periodo_canal
    where empresa_id = 'a1000000-0000-0000-0000-0000000000e1' and fecha = current_date - 2),
  '(0,-1,-242.00)', 'la nota de crédito resta 242 con IVA y 1 unidad, y no suma un comprobante'
);

-- Dos líneas en el comprobante de Mundo JC: el facturado es el total_con_iva de la cabecera, una vez.
select is(
  (select row(comprobantes, unidades, facturado)::text from analitica.ventas_periodo_canal
    where empresa_id = 'a1000000-0000-0000-0000-0000000000e2' and fecha = current_date - 3),
  '(1,12,12705.00)', 'un comprobante con dos líneas: 1 comprobante, 12 unidades y su total_con_iva sin duplicar'
);

-- ============================================================================
-- Cuadre con los comprobantes (SC-010) y rango
-- ============================================================================

-- El facturado neto de la organización Uno cuadra con Σ signo × total_con_iva de sus comprobantes
-- (factura +, nota de crédito −) que cuentan como venta: 1.210 + 605 − 242 + 12.705 + 8.470 = 22.748.
select is(
  (select sum(facturado) from analitica.ventas_periodo_canal
    where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  (select sum(case when v.tipo = 'nota_credito' then -v.total_con_iva else v.total_con_iva end)
     from dominio.comprobantes_venta v
    where v.organizacion_id = '11111111-1111-1111-1111-111111111111'
      and v.tipo in ('factura', 'nota_credito')
      and v.estado = 'confirmada'),
  'el facturado de la vista cuadra con el total_con_iva de los comprobantes que cuentan'
);
select is(
  (select sum(facturado) from analitica.ventas_periodo_canal
    where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  22748.00::numeric, 'el facturado neto de la organización Uno es 22.748'
);

-- Rango de fechas (el que aplica el filtro nativo del tablero): el último mes deja afuera la factura de hoy−40.
select is(
  (select sum(facturado) from analitica.ventas_periodo_canal
    where organizacion_id = '11111111-1111-1111-1111-111111111111'
      and fecha between current_date - 30 and current_date),
  14278.00::numeric, 'el rango del último mes suma 14.278 (sin la factura de hace 40 días)'
);
select is(
  (select count(*)::int from analitica.ventas_periodo_canal
    where organizacion_id = '11111111-1111-1111-1111-111111111111'
      and fecha between current_date - 200 and current_date - 100),
  0, 'un rango sin ventas no devuelve filas'
);

-- Canal = tienda de la empresa: solo hay canales que son empresas; no existe Mercado Libre.
select is(
  (select count(*)::int from analitica.ventas_periodo_canal v
    where not exists (select 1 from dominio.empresas e
                       where e.id = v.empresa_id and e.organizacion_id = v.organizacion_id
                         and e.nombre = v.empresa_nombre)),
  0, 'todo canal de la vista es una tienda (empresa) de la organización'
);
select is(
  (select count(*)::int from analitica.ventas_periodo_canal where empresa_nombre ilike '%mercado%'),
  0, 'no existe el canal Mercado Libre'
);

select * from finish();
rollback;
