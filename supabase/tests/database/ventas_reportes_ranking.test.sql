-- F-VTA-23 (MSF-358, épica MSF-338, spec 20270104-100000-ventas-reportes-basicos, SC-006):
-- vista `analitica.ventas_ranking_clientes` (Ranking de clientes).
--
-- Cubre FR-006 (columnas del contrato, grano empresa × cliente × fecha, `comprobantes` = solo
-- facturas, `facturado` neto con IVA, `participacion` sobre el total, `ultimo_comprador`, la marca
-- `consumidor_final` para la exclusión opcional) y el mismo predicado y signo de FR-002 (las notas de
-- crédito restan y no suman un comprobante; presupuestos, borradores y anuladas no cuentan), y el
-- aislamiento: la vista no la leen `anon` ni `authenticated`, solo el rol de Superset, y cada fila
-- expone `organizacion_id`/`empresa_id` para la cláusula `rls` del guest token.
--
-- SC-006 (CA-VTA-23-3): un cliente con solo notas de crédito en el período aparece con facturación
-- neta NEGATIVA (el neto real, sin piso en cero).
--
-- El fixture corre como postgres (RLS no aplica); las verificaciones que necesitan sesión usan el
-- rol `authenticated`.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

-- El disparador `organizaciones_crear_consumidor_final` ya creó el «Consumidor final» de cada
-- organización (nombre 'Consumidor final', tipo 'minorista', `es_consumidor_final = true`): el
-- fixture lo usa tal cual y no crea otro (el índice `clientes_consumidor_final_uq` admite uno por
-- organización).
insert into public.clientes (id, organizacion_id, nombre, tipo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Distribuidora Ñandú', 'mayorista'),
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Kiosco La Esquina', 'minorista'),
  ('c5000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Cliente Solo Notas', 'minorista'),
  ('c5000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Cliente Sin Ventas', 'minorista'),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Cliente de la Dos', 'minorista');

-- San Javucho y Mundo JC (organización Uno); Empresa Dos (organización Dos).
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-0000000000e1', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- Comprobantes de San Javucho (organización Uno). Todos con IVA (el total con IVA es el número que
-- muestra el listado y la exportación de comprobantes).
--   V1  factura de Ñandú (septiembre)          700 + 147 =   847
--   V2  factura de Ñandú (5/10)              1.000 + 210 = 1.210
--   V3  nota de crédito de Ñandú (6/10)        500 + 105 =   605 (resta)
--   V4  factura del Consumidor final (5/10)     300 +  63 =   363
--   V5  factura de Kiosco (septiembre)          200 +  42 =   242
--   V6  nota de crédito de Kiosco (5/10)        100 +  21 =   121 (resta)
--   V7  factura de Solo Notas (septiembre)      400 +  84 =   484
--   V8  nota de crédito de Solo Notas (7/10)    500 + 105 =   605 (resta)
--   V9  presupuesto de Ñandú (5/10)          2.000 + 420 = 2.420  (no cuenta)
--   V10 factura anulada de Ñandú (5/10)       3.000 + 630 = 3.630  (no cuenta)
--   V11 factura borrador de Ñandú (5/10)      4.000 + 840 = 4.840  (no cuenta)
--   V12 presupuesto de «Cliente Sin Ventas»   1.000 + 210 = 1.210  (no cuenta)
--   V13 factura anulada de «Cliente Sin Ventas»1.000 + 210 = 1.210 (no cuenta)
--   V14 factura borrador de «Cliente Sin Ventas»1.000 + 210 = 1.210 (no cuenta)
insert into dominio.comprobantes_venta
  (organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva)
values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'factura',      '00000001',  1, '2026-09-05', 'confirmada',  700,   847),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'factura',      '00000002',  2, '2026-10-05', 'confirmada', 1000,  1210),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', (select id from public.clientes where organizacion_id = '11111111-1111-1111-1111-111111111111' and es_consumidor_final), 'factura', '00000004', 4, '2026-10-05', 'confirmada', 300, 363),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000002', 'factura',      '00000005',  5, '2026-09-20', 'confirmada',  200,   242),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000003', 'factura',      '00000007',  7, '2026-09-25', 'confirmada',  400,   484),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'presupuesto',  '00000009',  9, '2026-10-05', 'pendiente',  2000,  2420),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'factura',      '00000010', 10, '2026-10-05', 'anulada',    3000,  3630),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'factura',      '00000011', 11, '2026-10-05', 'borrador',   4000,  4840),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000004', 'presupuesto',  '00000012', 12, '2026-10-05', 'pendiente',  1000,  1210),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000004', 'factura',      '00000013', 13, '2026-10-05', 'anulada',    1000,  1210),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000004', 'factura',      '00000014', 14, '2026-10-05', 'borrador',   1000,  1210);

-- Las notas de crédito cuelgan de su factura (una nota siempre acredita una factura) y traen su tipo.
insert into dominio.comprobantes_venta
  (organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva, comprobante_origen_id, nc_tipo)
values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'nota_credito', '00000003', 3, '2026-10-06', 'confirmada', 500, 605,
   (select id from dominio.comprobantes_venta
     where organizacion_id = '11111111-1111-1111-1111-111111111111'
       and empresa_id = 'a1000000-0000-0000-0000-0000000000e1'
       and tipo = 'factura' and numero = '00000002'),
   'devolucion_productos'),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000002', 'nota_credito', '00000006', 6, '2026-10-05', 'confirmada', 100, 121,
   (select id from dominio.comprobantes_venta
     where organizacion_id = '11111111-1111-1111-1111-111111111111'
       and empresa_id = 'a1000000-0000-0000-0000-0000000000e1'
       and tipo = 'factura' and numero = '00000005'),
   'devolucion_importe'),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000003', 'nota_credito', '00000008', 8, '2026-10-07', 'confirmada', 500, 605,
   (select id from dominio.comprobantes_venta
     where organizacion_id = '11111111-1111-1111-1111-111111111111'
       and empresa_id = 'a1000000-0000-0000-0000-0000000000e1'
       and tipo = 'factura' and numero = '00000007'),
   'descuento');

-- Mundo JC: otra tienda de la organización Uno (su factura suma al ranking de Ñandú).
insert into dominio.comprobantes_venta
  (organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva)
values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e2', 'c5000000-0000-0000-0000-000000000001', 'factura', '00000001', 1, '2026-10-05', 'confirmada', 10500, 12705);

-- Otra organización: no se mezcla con la de arriba.
insert into dominio.comprobantes_venta
  (organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva)
values
  ('22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-0000000000e1', 'c6000000-0000-0000-0000-000000000001', 'factura', '00000001', 1, '2026-10-05', 'confirmada', 6000, 7260);

create function pg_temp.como() returns void language plpgsql as $$
begin
  reset role;
  set local role authenticated;
end $$;

-- ============================================================================
-- Contrato de la vista (FR-006) y superficie de acceso
-- ============================================================================

select columns_are(
  'analitica', 'ventas_ranking_clientes',
  array['organizacion_id', 'empresa_id', 'empresa_nombre', 'posicion', 'cliente_id', 'numero',
        'nombre', 'tipo', 'consumidor_final', 'fecha', 'comprobantes', 'facturado',
        'participacion', 'ultimo_comprador'],
  'la vista expone exactamente las columnas del contrato'
);

select ok(
  not has_table_privilege('anon', 'analitica.ventas_ranking_clientes', 'select')
  and not has_table_privilege('authenticated', 'analitica.ventas_ranking_clientes', 'select'),
  'anon ni authenticated leen la vista'
);
select ok(
  has_table_privilege('superset_analitica', 'analitica.ventas_ranking_clientes', 'select'),
  'el rol de Superset lee la vista'
);

select pg_temp.como();
select throws_ok(
  $$select * from analitica.ventas_ranking_clientes$$,
  '42501', null, 'authenticated no puede leer la vista ni siquiera con sesión'
);
reset role;

-- Los helpers del predicado y del signo son `security definer` y solo los ejecuta el rol de Superset
-- (los creó F-VTA-22; esta vista los usa tal cual).
select is(
  (select count(*)::int from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'analitica'
     and p.proname in ('comprobante_cuenta_como_facturado', 'signo_comprobante')
     and p.prosecdef),
  2, 'las dos funciones de apoyo que usa la vista son security definer'
);
select is(
  (select count(*)::int from unnest(array[
    'analitica.comprobante_cuenta_como_facturado(text,text)',
    'analitica.signo_comprobante(text)'
  ]) as f where has_function_privilege('anon', f::regprocedure, 'execute')
     or has_function_privilege('authenticated', f::regprocedure, 'execute')),
  0, 'anon ni authenticated ejecutan las funciones de apoyo'
);
select is(
  (select count(*)::int from unnest(array[
    'analitica.comprobante_cuenta_como_facturado(text,text)',
    'analitica.signo_comprobante(text)'
  ]) as f where has_function_privilege('superset_analitica', f::regprocedure, 'execute')),
  2, 'el rol de Superset ejecuta las funciones de apoyo'
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
-- Qué cuenta y lo que no (FR-002 / FR-006)
-- ============================================================================

-- Grano: una fila por empresa × cliente × fecha. «Cliente Sin Ventas» no tiene filas (sus únicos
-- comprobantes son un presupuesto, una anulada y un borrador) y las notas de crédito suman filas
-- propias con el importe negativo.
select is(
  (select count(*)::int from analitica.ventas_ranking_clientes),
  10, 'la vista tiene una fila por empresa × cliente × fecha con comprobantes que cuentan'
);
select is(
  (select count(*)::int from analitica.ventas_ranking_clientes
    where cliente_id = 'c5000000-0000-0000-0000-000000000004'),
  0, 'presupuestos, anuladas y borradores no cuentan: «Cliente Sin Ventas» no tiene filas'
);

-- La nota de crédito resta y NO suma un comprobante.
select is(
  (select row(comprobantes, facturado)::text from analitica.ventas_ranking_clientes
    where empresa_id = 'a1000000-0000-0000-0000-0000000000e1'
      and cliente_id = 'c5000000-0000-0000-0000-000000000001'
      and fecha = '2026-10-06'),
  '(0,-605.00)', 'la nota de crédito resta 605 y no suma un comprobante'
);

-- ============================================================================
-- Orden del ranking y participación sobre el total (FR-006)
-- ============================================================================

-- Total del alcance visible de la organización Uno: 847 + 1.210 − 605 + 12.705 (Ñandú) + 363
-- (Consumidor final) + 242 − 121 (Kiosco) + 484 − 605 (Solo Notas) = 14.520.
select is(
  (select posicion from analitica.ventas_ranking_clientes
    where cliente_id = 'c5000000-0000-0000-0000-000000000001'
      and empresa_id = 'a1000000-0000-0000-0000-0000000000e1'
      and fecha = '2026-10-05'),
  1::bigint, 'Ñandú (14.157) es la primera del ranking por facturación neta'
);
select is(
  (select posicion from analitica.ventas_ranking_clientes
    where cliente_id = 'c5000000-0000-0000-0000-000000000001'
      and empresa_id = 'a1000000-0000-0000-0000-0000000000e2'
      and fecha = '2026-10-05'),
  1::bigint, 'la posición es del cliente: Ñandú también es la primera en Mundo JC'
);
select is(
  (select posicion from analitica.ventas_ranking_clientes
    where cliente_id = (select id from public.clientes where organizacion_id = '11111111-1111-1111-1111-111111111111' and es_consumidor_final)
      and empresa_id = 'a1000000-0000-0000-0000-0000000000e1'
      and fecha = '2026-10-05'),
  2::bigint, 'el Consumidor final (363) es el segundo'
);
select is(
  (select posicion from analitica.ventas_ranking_clientes
    where cliente_id = 'c5000000-0000-0000-0000-000000000002'
      and empresa_id = 'a1000000-0000-0000-0000-0000000000e1'
      and fecha = '2026-09-20'),
  3::bigint, 'Kiosco (121) es el tercero'
);
select is(
  (select posicion from analitica.ventas_ranking_clientes
    where cliente_id = 'c5000000-0000-0000-0000-000000000003'
      and empresa_id = 'a1000000-0000-0000-0000-0000000000e1'
      and fecha = '2026-09-25'),
  4::bigint, 'el cliente con facturación negativa (−121) es el último'
);

-- Participación: porcentaje (0–100) sobre el total del alcance visible.
select is(
  (select round(participacion, 2) from analitica.ventas_ranking_clientes
    where cliente_id = 'c5000000-0000-0000-0000-000000000001'
      and empresa_id = 'a1000000-0000-0000-0000-0000000000e1'
      and fecha = '2026-10-05'),
  97.50::numeric, 'Ñandú participa con el 97,5 % del total'
);
select is(
  (select round(participacion, 2) from analitica.ventas_ranking_clientes
    where cliente_id = (select id from public.clientes where organizacion_id = '11111111-1111-1111-1111-111111111111' and es_consumidor_final)
      and empresa_id = 'a1000000-0000-0000-0000-0000000000e1'
      and fecha = '2026-10-05'),
  2.50::numeric, 'el Consumidor final participa con el 2,5 % del total'
);
select is(
  (select round(sum(participacion), 2)
     from (select distinct on (cliente_id) cliente_id, participacion
             from analitica.ventas_ranking_clientes
            where organizacion_id = '11111111-1111-1111-1111-111111111111'
            order by cliente_id) t),
  100.00::numeric, 'las participaciones de los clientes suman el 100 % del total'
);

-- ============================================================================
-- «Consumidor final»: la exclusión es opcional (FR-006 / FR-008)
-- ============================================================================

select is(
  (select consumidor_final from analitica.ventas_ranking_clientes
    where cliente_id = (select id from public.clientes where organizacion_id = '11111111-1111-1111-1111-111111111111' and es_consumidor_final)
      and empresa_id = 'a1000000-0000-0000-0000-0000000000e1'
      and fecha = '2026-10-05'),
  true, 'la vista marca al Consumidor final para que la exclusión sea opcional'
);
select is(
  (select count(distinct cliente_id)::int from analitica.ventas_ranking_clientes
    where organizacion_id = '11111111-1111-1111-1111-111111111111'
      and consumidor_final = false),
  3, 'excluyendo al Consumidor final quedan los tres clientes comunes'
);
select is(
  (select count(*)::int from analitica.ventas_ranking_clientes
    where organizacion_id = '11111111-1111-1111-1111-111111111111'
      and consumidor_final = false
      and cliente_id = (select id from public.clientes where organizacion_id = '11111111-1111-1111-1111-111111111111' and es_consumidor_final)),
  0, 'con el Consumidor final excluido no queda ninguna fila suya'
);

-- ============================================================================
-- Filtro de período (FR-008): el rango de fechas acota el ranking
-- ============================================================================

-- Octubre: la factura de septiembre de Ñandú (847) y la de Kiosco (242) quedan afuera.
select is(
  (select row(sum(comprobantes), sum(facturado))::text from analitica.ventas_ranking_clientes
    where cliente_id = 'c5000000-0000-0000-0000-000000000001'
      and fecha between '2026-10-01' and '2026-10-31'),
  '(2,13310.00)', 'en octubre Ñandú suma 13.310 en dos facturas (la nota de crédito resta y no cuenta)'
);
select is(
  (select row(sum(comprobantes), sum(facturado))::text from analitica.ventas_ranking_clientes
    where cliente_id = 'c5000000-0000-0000-0000-000000000002'
      and fecha between '2026-10-01' and '2026-10-31'),
  '(0,-121.00)', 'en octubre Kiosco solo tiene una nota de crédito: su facturación neta es negativa'
);
select is(
  (select row(sum(comprobantes), sum(facturado))::text from analitica.ventas_ranking_clientes
    where cliente_id = 'c5000000-0000-0000-0000-000000000003'
      and fecha between '2026-10-01' and '2026-10-31'),
  '(0,-605.00)', 'en octubre «Cliente Solo Notas» solo tiene una nota de crédito: −605'
);

-- SC-006 (CA-VTA-23-3): un cliente con solo notas de crédito en el período aparece con facturación
-- neta NEGATIVA (el neto real, sin piso en cero).
select ok(
  (select sum(facturado) < 0 from analitica.ventas_ranking_clientes
    where cliente_id = 'c5000000-0000-0000-0000-000000000003'
      and fecha between '2026-10-01' and '2026-10-31'),
  'un cliente con solo notas de crédito en el período aparece con facturación neta negativa (SC-006)'
);

-- ============================================================================
-- Último comprador: la fecha del comprobante más reciente que cuenta
-- ============================================================================

select is(
  (select ultimo_comprador from analitica.ventas_ranking_clientes
    where cliente_id = 'c5000000-0000-0000-0000-000000000001'
      and empresa_id = 'a1000000-0000-0000-0000-0000000000e1'
      and fecha = '2026-10-05'),
  '2026-10-06'::date, 'la última comptable de Ñandú en San Javucho es la nota de crédito del 6/10'
);
select is(
  (select ultimo_comprador from analitica.ventas_ranking_clientes
    where cliente_id = 'c5000000-0000-0000-0000-000000000001'
      and empresa_id = 'a1000000-0000-0000-0000-0000000000e2'
      and fecha = '2026-10-05'),
  '2026-10-05'::date, 'en Mundo JC la última comptable de Ñandú es su factura del 5/10'
);
select is(
  (select ultimo_comprador from analitica.ventas_ranking_clientes
    where cliente_id = 'c5000000-0000-0000-0000-000000000003'
      and empresa_id = 'a1000000-0000-0000-0000-0000000000e1'
      and fecha = '2026-09-25'),
  '2026-10-07'::date, 'la última comptable de «Cliente Solo Notas» es su nota de crédito del 7/10'
);

-- ============================================================================
-- Identidad visible y aislamiento
-- ============================================================================

select is(
  (select row(nombre, tipo, empresa_nombre, numero)::text
     from analitica.ventas_ranking_clientes
    where empresa_id = 'a1000000-0000-0000-0000-0000000000e1'
      and cliente_id = 'c5000000-0000-0000-0000-000000000001'
      and fecha = '2026-10-05'),
  '("Distribuidora Ñandú",mayorista,"San Javucho",2)', 'la fila muestra cliente, tipo, tienda y número'
);

select is(
  (select count(*)::int from analitica.ventas_ranking_clientes
    where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  9, 'la organización Uno tiene sus nueve filas'
);
select is(
  (select count(*)::int from analitica.ventas_ranking_clientes
    where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  1, 'la organización Dos tiene su propia fila, sin mezclas'
);
select is(
  (select sum(facturado) from analitica.ventas_ranking_clientes
    where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  7260::numeric, 'la organización Dos suma solo lo suyo'
);
select is(
  (select sum(facturado) from analitica.ventas_ranking_clientes
    where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  14520::numeric, 'la organización Uno suma solo lo suyo (14.520)'
);

-- Las ventanas se particionan por organización: la otra organización rankea y participa por su cuenta.
select is(
  (select posicion from analitica.ventas_ranking_clientes
    where organizacion_id = '22222222-2222-2222-2222-222222222222'
      and cliente_id = 'c6000000-0000-0000-0000-000000000001'),
  1::bigint, 'la organización Dos tiene su propio puesto 1 (la posición no es global)'
);
select is(
  (select round(participacion, 2) from analitica.ventas_ranking_clientes
    where organizacion_id = '22222222-2222-2222-2222-222222222222'
      and cliente_id = 'c6000000-0000-0000-0000-000000000001'),
  100.00::numeric, 'la organización Dos participa con el 100 % de lo suyo (no se mezcla con Uno)'
);

select * from finish();
rollback;
