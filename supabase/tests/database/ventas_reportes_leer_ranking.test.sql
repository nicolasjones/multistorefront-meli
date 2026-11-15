-- F-VTA-23 (MSF-358, épica MSF-338, spec 20270104-100000-ventas-reportes-basicos, FR-009, SC-005):
-- RPC de lectura del ranking de clientes para la exportación a Excel (`public.leer_ranking_ventas`).
--
-- Cubre FR-009: la RPC lee la MISMA vista que el tablero (`analitica.ventas_ranking_clientes`), con
-- el filtro del usuario (organización activa + empresas accesibles) y con los filtros de la
-- pantalla (período, tienda y «Consumidor final»); devuelve el ranking por páginas con el total de
-- filas del alcance.
--
-- SC-005 (CA-VTA-23-2): el SERVIDOR rechaza la exportación sin la sección `reportes` (42501): no
-- alcanza con ocultar el botón.
--
-- El fixture corre como postgres (RLS no aplica); las verificaciones que necesitan sesión usan el
-- rol `authenticated` con el JWT de quien corresponde.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'admin-dos@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'consulta-uno@example.com'),
  ('f1000000-0000-0000-0000-000000000004', 'administracion-uno@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'administracion', 'activo');

-- El «Consumidor final» de la organización Uno: el disparador
-- `organizaciones_crear_consumidor_final` ya lo creó (nombre 'Consumidor final', tipo 'minorista',
-- `es_consumidor_final = true`); el fixture lo usa tal cual y no crea otro (el índice
-- `clientes_consumidor_final_uq` admite uno por organización).
insert into public.clientes (id, organizacion_id, nombre, tipo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Distribuidora Ñandú', 'mayorista'),
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Kiosco La Esquina', 'minorista'),
  ('c5000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Cliente Solo Notas', 'minorista'),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Cliente de la Dos', 'minorista');

-- San Javucho y Mundo JC (organización Uno); Empresa Dos (organización Dos).
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-0000000000e1', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- Administración tiene la sección `reportes`, pero solo una tienda: el alcance de la RPC son las
-- empresas accesibles del usuario (las mismas que acotan la cláusula `rls` del guest token).
insert into public.usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111', 'administracion');

-- Comprobantes de la organización Uno (los mismos del pgTAP de la vista,
-- `ventas_reportes_ranking.test.sql`, para que las cifras sean comparables):
--   V1  factura de Ñandú (5/9)     700 + 147 =   847
--   V2  factura de Ñandú (5/10)  1.000 + 210 = 1.210
--   V3  nota de crédito de Ñandú (6/10) 500 + 105 = 605 (resta)
--   V4  factura del Consumidor final (5/10) 300 + 63 = 363
--   V5  factura de Kiosco (20/9)    200 +  42 =   242
--   V6  nota de crédito de Kiosco (5/10) 100 + 21 = 121 (resta)
--   V7  factura de Solo Notas (25/9) 400 + 84 = 484
--   V8  nota de crédito de Solo Notas (7/10) 500 + 105 = 605 (resta)
--   V9  presupuesto de Ñandú (5/10) (no cuenta)
--   V10 factura anulada de Ñandú (5/10) (no cuenta)
--   V11 factura borrador de Ñandú (5/10) (no cuenta)
--   V12-V14 presupuesto, anulada y borrador de «Cliente Sin Ventas» (no cuentan)
insert into dominio.comprobantes_venta
  (organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva)
values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'factura',      '00000001',  1, '2026-09-05', 'confirmada',  700,   847),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'factura',      '00000002',  2, '2026-10-05', 'confirmada', 1000,  1210),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', (select id from public.clientes where organizacion_id = '11111111-1111-1111-1111-111111111111' and es_consumidor_final), 'factura', '00000004', 4, '2026-10-05', 'confirmada', 300, 363),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000002', 'factura',      '00000005',  5, '2026-09-20', 'confirmada',  200,   242),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000003', 'factura',      '00000007',  7, '2026-09-25', 'confirmada',  400,   484),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'presupuesto',  '00000009',  9, '2026-10-05', 'pendiente', 2000,  2420),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'factura',      '00000010', 10, '2026-10-05', 'anulada',    3000,  3630),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'factura',      '00000011', 11, '2026-10-05', 'borrador',   4000,  4840);

-- Las notas de crédito cuelgan de su factura (una nota siempre acredita una factura).
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

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Ejecuta una sentencia como un usuario y devuelve 'ok' o el SQLSTATE con el que falló.
create function pg_temp.resultado(p_user uuid, p_sql text) returns text language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.como(p_user);
  begin
    execute p_sql;
    v := 'ok';
  exception when others then
    v := sqlstate;
  end;
  reset role;
  return v;
end $$;

-- ============================================================================
-- Superficie de acceso de la RPC (FR-009 / SC-005)
-- ============================================================================

select ok(
  not has_function_privilege('anon', 'public.leer_ranking_ventas(date,date,boolean,uuid,integer,integer)', 'execute'),
  'anon no ejecuta la lectura del ranking'
);
select ok(
  has_function_privilege('authenticated', 'public.leer_ranking_ventas(date,date,boolean,uuid,integer,integer)', 'execute'),
  'authenticated ejecuta la lectura del ranking'
);
select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'leer_ranking_ventas'),
  'la RPC es security definer con el search_path vacío (lee la vista de `analitica`, cerrada para `authenticated`)'
);

-- SC-005 (CA-VTA-23-2): sin la sección `reportes` el SERVIDOR rechaza la exportación.
select is(
  pg_temp.resultado('f1000000-0000-0000-0000-000000000003', $$select * from public.leer_ranking_ventas('2026-10-01', '2026-10-31')$$),
  '42501', 'un rol sin la sección reportes no puede exportar (lo rechaza el servidor)'
);

-- ============================================================================
-- Las mismas filas y totales que la pantalla (misma fuente que el tablero)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');

-- Septiembre: 847 (Ñandú) + 484 (Solo Notas) + 242 (Kiosco) = 1.573.
select is(
  (select count(*)::int from public.leer_ranking_ventas('2026-09-01', '2026-09-30')),
  3, 'el ranking de septiembre tiene los tres clientes que compraron'
);
select is(
  (select row(posicion, nombre, tipo, comprobantes, facturado)::text
     from public.leer_ranking_ventas('2026-09-01', '2026-09-30')
    where nombre = 'Distribuidora Ñandú'),
  '(1,"Distribuidora Ñandú",mayorista,1,847.00)', 'Ñandú es el primero del ranking con su facturación neta'
);
select is(
  (select row(posicion, nombre, comprobantes, facturado)::text
     from public.leer_ranking_ventas('2026-09-01', '2026-09-30')
    where nombre = 'Cliente Solo Notas'),
  '(2,"Cliente Solo Notas",1,484.00)', 'el segundo es «Cliente Solo Notas»'
);
select is(
  (select row(posicion, nombre, comprobantes, facturado)::text
     from public.leer_ranking_ventas('2026-09-01', '2026-09-30')
    where nombre = 'Kiosco La Esquina'),
  '(3,"Kiosco La Esquina",1,242.00)', 'el tercero es «Kiosco La Esquina»'
);
select is(
  (select round(sum(participacion), 2) from public.leer_ranking_ventas('2026-09-01', '2026-09-30')),
  100.00::numeric, 'las participaciones suman el 100 % del total del período'
);
select is(
  (select total_filas from public.leer_ranking_ventas('2026-09-01', '2026-09-30') limit 1),
  3::bigint, 'la RPC informa cuántas filas tiene el alcance'
);

-- Octubre: Ñandú 1.210 − 605 + 12.705 = 13.310 (dos facturas y una nota de crédito que resta),
-- Kiosco −121 y Solo Notas −605: 13.310 − 121 − 605 = 12.584.
select is(
  (select row(posicion, nombre, comprobantes, facturado)::text
     from public.leer_ranking_ventas('2026-10-01', '2026-10-31')
    where nombre = 'Distribuidora Ñandú'),
  '(1,"Distribuidora Ñandú",2,13310.00)', 'en octubre Ñandú suma 13.310 en dos facturas (la nota de crédito resta y no cuenta)'
);
select is(
  (select row(nombre, comprobantes, facturado)::text
     from public.leer_ranking_ventas('2026-10-01', '2026-10-31')
    where nombre = 'Kiosco La Esquina'),
  '("Kiosco La Esquina",0,-121.00)', 'el cliente con solo notas de crédito tiene facturación negativa'
);
select is(
  (select sum(facturado) from public.leer_ranking_ventas('2026-10-01', '2026-10-31')),
  12584::numeric, 'el total del alcance de octubre es 12.584'
);
select is(
  (select ultimo_comprador from public.leer_ranking_ventas('2026-10-01', '2026-10-31')
    where nombre = 'Distribuidora Ñandú'),
  '2026-10-06'::date, 'el último comprador de Ñandú es su nota de crédito del 6/10'
);

reset role;

-- El total de la RPC es el de la vista con los mismos filtros (misma fuente que el tablero).
select is(
  (select sum(facturado) from analitica.ventas_ranking_clientes
    where organizacion_id = '11111111-1111-1111-1111-111111111111'
      and fecha between '2026-10-01' and '2026-10-31'
      and not consumidor_final),
  12584::numeric, 'la vista y la RPC dan el mismo total de octubre (12.584): el Excel coincide con la pantalla'
);

-- ============================================================================
-- Filtros de la pantalla: período, tienda y «Consumidor final»
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');

-- El «Consumidor final» arranca excluido (FR-008) y la RPC lo puede incluir (FR-006).
select is(
  (select count(*)::int from public.leer_ranking_ventas('2026-10-01', '2026-10-31')),
  3, 'con el «Consumidor final» excluido el ranking tiene tres clientes'
);
select is(
  (select count(*)::int from public.leer_ranking_ventas('2026-10-01', '2026-10-31', true)),
  4, 'con el «Consumidor final» incluido el ranking tiene cuatro clientes'
);
select is(
  (select sum(facturado) from public.leer_ranking_ventas('2026-10-01', '2026-10-31', true)),
  12947::numeric, 'el total con el «Consumidor final» incluido es 12.947 (12.584 + 363)'
);

-- La tienda filtrada acota el ranking.
select is(
  (select row(nombre, comprobantes, facturado)::text
     from public.leer_ranking_ventas('2026-10-01', '2026-10-31', false, 'a1000000-0000-0000-0000-0000000000e2')),
  '("Distribuidora Ñandú",1,12705.00)', 'con la tienda Mundo JC el ranking trae solo su venta'
);
select is(
  (select count(*)::int from public.leer_ranking_ventas('2026-10-01', '2026-10-31', false, 'a2000000-0000-0000-0000-0000000000e1')),
  0, 'una tienda de otra organización no trae filas (el filtro no amplía el alcance)'
);

-- Un período sin ventas no trae filas.
select is(
  (select count(*)::int from public.leer_ranking_ventas('2026-08-01', '2026-08-31')),
  0, 'un período sin ventas no trae filas'
);

-- Paginación: la primera página trae el total del alcance.
select is(
  (select count(*)::int from public.leer_ranking_ventas('2026-09-01', '2026-09-30', false, null::uuid, 1, 1)),
  1, 'la RPC devuelve la página pedida'
);
select is(
  (select total_filas from public.leer_ranking_ventas('2026-09-01', '2026-09-30', false, null::uuid, 1, 1)),
  3::bigint, 'la página informa el total de filas del alcance'
);
select is(
  (select nombre from public.leer_ranking_ventas('2026-09-01', '2026-09-30', false, null::uuid, 2, 1)),
  'Cliente Solo Notas', 'la segunda página sigue el orden del ranking'
);

-- Parámetros inválidos: se rechazan, no se devuelven filas raras.
select is(
  pg_temp.resultado('f1000000-0000-0000-0000-000000000001', $$select * from public.leer_ranking_ventas('2026-10-31', '2026-10-01')$$),
  '22023', 'un rango invertido se rechaza'
);
select is(
  pg_temp.resultado('f1000000-0000-0000-0000-000000000001', $$select * from public.leer_ranking_ventas('2026-10-01', '2026-10-31', false, null::uuid, 0, 10)$$),
  '22023', 'una página cero se rechaza'
);
select is(
  pg_temp.resultado('f1000000-0000-0000-0000-000000000001', $$select * from public.leer_ranking_ventas('2026-10-01', '2026-10-31', false, null::uuid, 1, 5001)$$),
  '22023', 'un lote más grande que el tope se rechaza'
);

reset role;

-- ============================================================================
-- Aislamiento: organización y empresas accesibles del usuario
-- ============================================================================

-- Otra organización: el administrador de la Dos solo ve lo suyo.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.leer_ranking_ventas('2026-09-01', '2026-10-31')),
  1, 'el administrador de la otra organización ve solo su cliente'
);
select is(
  (select sum(facturado) from public.leer_ranking_ventas('2026-09-01', '2026-10-31')),
  7260::numeric, 'y suma solo lo suyo (7.260)'
);
reset role;

-- Administración con una sola tienda asignada: la RPC acota a las empresas accesibles.
select pg_temp.como('f1000000-0000-0000-0000-000000000004');
select is(
  (select count(*)::int from public.leer_ranking_ventas('2026-09-01', '2026-10-31')),
  1, 'con una sola tienda accesible el ranking trae un cliente'
);
select is(
  (select row(nombre, comprobantes, facturado)::text
     from public.leer_ranking_ventas('2026-09-01', '2026-10-31')),
  '("Distribuidora Ñandú",1,12705.00)', 'y es el de su tienda: las ventas de la otra no se ven'
);
reset role;

select * from finish();
rollback;
