-- F-REN-02 (MSF-221, épica MSF-120): resumen por empresa y consolidado de rentabilidad.
-- Cubre FR-011, FR-012, FR-015 / SC-005: columnas de las vistas, ponderación Σ márgenes ÷ Σ netos
-- (caso donde difiere del promedio simple), productos distintos, conteos por peor estado, umbral
-- vigente, aislamiento por organización, vistas cerradas para `anon`/`authenticated` y coherencia de
-- `public.rentabilidad_conteo_margen()` con la vista (con su control de rol y organización).
begin;

select plan(26);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'administracion@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'operador@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

-- E1 Mundo JC (neto = lista) · E2 San Javucho (+10 %) · E3 Empresa Dos (org 2).
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Mundo JC', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'San Javucho', true),
  ('e2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Empresa Dos', true);

insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct) values
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'central_ajuste', 10);

-- Org 1: A1 costo 6.000 · A4 costo 9.500 · A6 costo 10.500 (todos de lista 10.000) · A3 sin costo.
-- Org 2: B1 de lista 500 sin costo (no hay ninguna fila de margen).
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 10000, true),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Sin costo', 'SIN-1', 'ARS', 5000, true),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Margen bajo', 'BAJ-1', 'ARS', 10000, true),
  ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Margen negativo', 'NEG-1', 'ARS', 10000, true),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Teclado', 'TEC-1', 'ARS', 500, true);

insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 6000),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 9500),
  ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 10500);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Contrato de las vistas
-- ============================================================================

select columns_are(
  'analitica', 'rentabilidad_resumen_empresa',
  array['organizacion_id', 'empresa_id', 'empresa_nombre', 'productos', 'margen_promedio_pct',
        'margen_por_unidad', 'con_margen_bajo', 'con_margen_negativo'],
  'el resumen por empresa expone exactamente las columnas del contrato'
);
select columns_are(
  'analitica', 'rentabilidad_consolidado',
  array['organizacion_id', 'productos_con_margen', 'margen_promedio_ponderado_pct', 'con_margen_bajo',
        'con_margen_negativo', 'umbral_margen_bajo'],
  'el consolidado expone exactamente las columnas del contrato'
);

-- ============================================================================
-- Resumen por empresa (FR-011)
-- Mundo JC: A1 10.000/6.000 (ok) · A4 10.000/9.500 (bajo) · A6 10.000/10.500 (negativo)
-- San Javucho: A1 11.000/6.000 (ok) · A4 11.000/9.500 (ok) · A6 11.000/10.500 (bajo)
-- ============================================================================

select is(
  (select count(*)::int from analitica.rentabilidad_resumen_empresa where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  2, 'una fila por empresa con margen de la organización 1'
);
select is(
  (select productos from analitica.rentabilidad_resumen_empresa where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  3, 'Mundo JC: 3 productos con margen (el que no tiene costo no cuenta)'
);
select is(
  (select round(margen_promedio_pct, 4) from analitica.rentabilidad_resumen_empresa where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  0.1333, 'Mundo JC: margen promedio = 4.000 ÷ 30.000'
);
select is(
  (select round(margen_por_unidad, 2) from analitica.rentabilidad_resumen_empresa where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  1333.33, 'Mundo JC: margen por unidad = 4.000 ÷ 3'
);
select is(
  (select row(con_margen_bajo, con_margen_negativo)::text from analitica.rentabilidad_resumen_empresa where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  '(1,1)', 'Mundo JC: 1 margen bajo y 1 negativo'
);
select is(
  (select round(margen_promedio_pct, 4) from analitica.rentabilidad_resumen_empresa where empresa_id = 'e1000000-0000-0000-0000-000000000002'),
  0.2121, 'San Javucho: margen promedio = 7.000 ÷ 33.000'
);
select is(
  (select row(con_margen_bajo, con_margen_negativo)::text from analitica.rentabilidad_resumen_empresa where empresa_id = 'e1000000-0000-0000-0000-000000000002'),
  '(1,0)', 'San Javucho: 1 margen bajo y ningún negativo'
);

-- ============================================================================
-- Consolidado (FR-012)
-- ============================================================================

select is(
  (select count(*)::int from analitica.rentabilidad_consolidado),
  1, 'una sola fila de consolidado: la organización 2 no tiene ningún margen calculado'
);
select is(
  (select productos_con_margen from analitica.rentabilidad_consolidado where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  3, 'productos DISTINTOS con margen (6 filas producto × tienda)'
);
select is(
  (select round(margen_promedio_ponderado_pct, 4) from analitica.rentabilidad_consolidado where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  0.1746, 'margen ponderado = Σ márgenes 11.000 ÷ Σ netos 63.000'
);
select isnt(
  (select round(margen_promedio_ponderado_pct, 4) from analitica.rentabilidad_consolidado where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  (select round(avg(margen_pct), 4) from analitica.margen_producto_canal where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'la ponderación difiere del promedio simple de los porcentajes'
);
select is(
  (select row(con_margen_bajo, con_margen_negativo)::text from analitica.rentabilidad_consolidado where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  '(1,1)', 'A4 es bajo y A6 negativo (negativo en una tienda y bajo en otra cuenta solo como negativo)'
);
select is(
  (select umbral_margen_bajo from analitica.rentabilidad_consolidado where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  0.10, 'el consolidado muestra el umbral por defecto (0,10)'
);

-- Con el umbral en 15 %: A4 (5 %), A1 en San Javucho no cambia, A4 en San Javucho (13,6 %) pasa a bajo.
insert into dominio.rentabilidad_config (organizacion_id, umbral_margen_bajo)
  values ('11111111-1111-1111-1111-111111111111', 0.15);

select is(
  (select row(con_margen_bajo, con_margen_negativo, umbral_margen_bajo)::text from analitica.rentabilidad_consolidado
    where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  '(1,1,0.1500)', 'con umbral 15 % el consolidado recalcula y muestra el umbral vigente'
);
select is(
  (select con_margen_bajo from analitica.rentabilidad_resumen_empresa where empresa_id = 'e1000000-0000-0000-0000-000000000002'),
  2, 'con umbral 15 % San Javucho pasa a 2 márgenes bajos (A4 al 13,6 % y A6)'
);

-- ============================================================================
-- Aislamiento y cierre de las vistas
-- ============================================================================

select is(
  (select count(*)::int from analitica.rentabilidad_resumen_empresa where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  0, 'la organización 2 no tiene filas en el resumen (sin datos de la 1 mezclados)'
);
select ok(
  not has_table_privilege('authenticated', 'analitica.rentabilidad_consolidado', 'select')
  and not has_table_privilege('authenticated', 'analitica.rentabilidad_resumen_empresa', 'select')
  and not has_table_privilege('anon', 'analitica.rentabilidad_consolidado', 'select')
  and not has_table_privilege('anon', 'analitica.rentabilidad_resumen_empresa', 'select'),
  'anon y authenticated no leen las vistas nuevas'
);
select ok(
  has_table_privilege('superset_analitica', 'analitica.rentabilidad_consolidado', 'select')
  and has_table_privilege('superset_analitica', 'analitica.rentabilidad_resumen_empresa', 'select'),
  'el rol de Superset lee las vistas nuevas'
);

-- ============================================================================
-- public.rentabilidad_conteo_margen() (FR-015)
-- ============================================================================

select ok(
  not has_function_privilege('anon', 'public.rentabilidad_conteo_margen()', 'execute')
  and has_function_privilege('authenticated', 'public.rentabilidad_conteo_margen()', 'execute'),
  'la RPC la ejecuta authenticated y no anon'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  (select row(con_margen_bajo, con_margen_negativo, productos_con_margen)::text from public.rentabilidad_conteo_margen()),
  '(1,1,3)', 'el Administrador cuenta lo mismo que el consolidado (1 bajo, 1 negativo, 3 productos)'
);
reset role;
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(
  (select row(con_margen_bajo, con_margen_negativo)::text from public.rentabilidad_conteo_margen()),
  '(1,1)', 'Administración (lectura) también lo cuenta'
);
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select * from public.rentabilidad_conteo_margen()$$,
  '42501', null, 'Operador (sin la sección rentabilidad) es rechazado'
);
reset role;

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(
  (select row(con_margen_bajo, con_margen_negativo, productos_con_margen)::text from public.rentabilidad_conteo_margen()),
  '(0,0,0)', 'otra organización sin márgenes cuenta cero (no ve los de la primera)'
);
reset role;

-- Sin organización activa (sin sesión) → rechazo.
select pg_temp.como('00000000-0000-0000-0000-0000000000ff');
select throws_ok(
  $$select * from public.rentabilidad_conteo_margen()$$,
  '42501', null, 'un usuario sin organización es rechazado'
);
reset role;

select * from finish();
rollback;
