-- MSF-361 · F-INI-02 (épica MSF-156, SC-004): alertas accionables de Inicio.
-- Cubre FR-020 (esquema `dominio`, RLS, sin escritura de la app), FR-021 (los cinco tipos, margen solo si
-- existe la vista), FR-022 (idempotencia: recalcular dos veces = mismo conjunto, sin duplicados),
-- FR-023 (lectura por sección y empresa, aislamiento entre organizaciones, `anon` sin acceso),
-- FR-025 (enlaces de lista cerrada) y FR-027 (sin alertas de Mercado Libre / precios en revisión).
-- El fixture corre como postgres (RLS no aplica); las verificaciones, como «authenticated», «anon» o
-- «service_role», igual que PostgREST. Las fechas son relativas al reloj de la base (now()).
begin;

select plan(40);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'deposito-uno@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'consulta-uno@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- Depósito y Consulta trabajan en San Javucho; Mundo JC no es de ninguno.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'consulta');
insert into usuario_empresa_activa (user_id, empresa_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-00000000000a'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-00000000000a');

-- Org 1: P1 sin stock, P2 bajo el mínimo, P3 normal (costo mayor al precio: margen negativo), P4 inactivo sin
-- stock. Org 2: P5 sin stock.
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Zapato', 'P-1', 'ARS', 10000),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Aro', 'P-2', 'ARS', 10000),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Cinto', 'P-3', 'ARS', 10000),
  ('b1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Inactivo', 'P-4', 'ARS', 10000),
  ('b2000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', 'Producto Dos', 'P-5', 'ARS', 10000);
update dominio.productos set activo = false where id = 'b1000000-0000-0000-0000-000000000004';
update dominio.existencias set cantidad = 0, minimo = 5 where producto_id = 'b1000000-0000-0000-0000-000000000001';
update dominio.existencias set cantidad = 2, minimo = 5 where producto_id = 'b1000000-0000-0000-0000-000000000002';
update dominio.existencias set cantidad = 10, minimo = 5 where producto_id = 'b1000000-0000-0000-0000-000000000003';
update dominio.existencias set cantidad = 0, minimo = 5 where producto_id = 'b1000000-0000-0000-0000-000000000004';
update dominio.existencias set cantidad = 0, minimo = 5 where producto_id = 'b2000000-0000-0000-0000-000000000005';

insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 50000);

-- Consultas: San Javucho 2 nuevas y 1 en curso; Mundo JC 1 nueva; Empresa Dos 1 nueva.
insert into dominio.consultas (organizacion_id, empresa_id, origen, nombre, contacto, mensaje, estado) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'formulario', 'Ana', 'ana@example.com', 'Hola', 'nueva'),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'formulario', 'Beto', 'beto@example.com', 'Hola', 'nueva'),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'formulario', 'Cora', 'cora@example.com', 'Hola', 'en_curso'),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'formulario', 'Dani', 'dani@example.com', 'Hola', 'nueva'),
  ('22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-00000000000c', 'formulario', 'Eva', 'eva@example.com', 'Hola', 'nueva');

-- Dólar: la organización Dos cargó hoy; la Uno no cargó nunca.
insert into dominio.cotizaciones (organizacion_id, valor, cargada_por_nombre, cargada_en) values
  ('22222222-2222-2222-2222-222222222222', 1200, 'Admin Dos', now());

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Esquema (Principio VII) y privilegios (FR-020)
-- ============================================================================

select ok(
  exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'dominio' and c.relname = 'alertas_inicio' and c.relrowsecurity),
  'alertas_inicio vive en «dominio» y tiene RLS activada'
);
select ok(
  exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'dominio' and c.relname = 'alertas_inicio_calculos' and c.relrowsecurity),
  'alertas_inicio_calculos vive en «dominio» y tiene RLS activada'
);
select ok(
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relname in ('alertas_inicio', 'alertas_inicio_calculos')),
  'no existen copias de las tablas en «public»'
);
select is(has_table_privilege('anon', 'dominio.alertas_inicio', 'select'), false, 'anon no lee alertas_inicio');
select is(has_table_privilege('anon', 'public.alertas_inicio_visibles', 'select'), false, 'anon no lee la vista de alertas');
select is(has_table_privilege('authenticated', 'dominio.alertas_inicio', 'insert'), false, 'authenticated no inserta alertas');
select is(has_table_privilege('authenticated', 'dominio.alertas_inicio', 'update'), false, 'authenticated no actualiza alertas');
select is(has_table_privilege('authenticated', 'dominio.alertas_inicio', 'delete'), false, 'authenticated no borra alertas');
select is(has_table_privilege('authenticated', 'dominio.alertas_inicio_calculos', 'insert'), false, 'authenticated no escribe los cálculos');
select is(has_column_privilege('authenticated', 'dominio.alertas_inicio_calculos', 'alertas', 'select'), false,
  'authenticated no lee la cantidad total del cálculo');
select is(has_function_privilege('anon', 'public.recalcular_alertas_inicio(uuid)', 'execute'), false, 'anon no ejecuta el recálculo');
select is(has_function_privilege('authenticated', 'public.recalcular_alertas_inicio(uuid)', 'execute'), false,
  'authenticated no ejecuta el recálculo');
select is(has_function_privilege('service_role', 'public.recalcular_alertas_inicio(uuid)', 'execute'), true,
  'service_role ejecuta el recálculo');

-- ============================================================================
-- Recálculo: los cinco tipos (FR-021) y registro del cálculo (FR-022)
-- ============================================================================

select is(public.recalcular_alertas_inicio('11111111-1111-1111-1111-111111111111') ->> 'alertas', '7',
  'la organización Uno calcula 7 alertas (stock x2, consultas x2, dólar, margen x2)');

select is(
  (select cantidad from dominio.alertas_inicio where organizacion_id = '11111111-1111-1111-1111-111111111111' and tipo = 'sin_stock'),
  1, 'sin_stock cuenta solo productos activos (el inactivo no)'
);
select is(
  (select cantidad from dominio.alertas_inicio where organizacion_id = '11111111-1111-1111-1111-111111111111' and tipo = 'stock_bajo'),
  1, 'stock_bajo cuenta el producto bajo el mínimo'
);
select is(
  (select array_agg(empresa_id::text || ':' || cantidad order by empresa_id)
     from dominio.alertas_inicio where organizacion_id = '11111111-1111-1111-1111-111111111111' and tipo = 'consultas_sin_atender'),
  array['a1000000-0000-0000-0000-00000000000a:2', 'a1000000-0000-0000-0000-00000000000b:1'],
  'consultas_sin_atender cuenta solo las nuevas, por empresa'
);
select is(
  (select cantidad from dominio.alertas_inicio where organizacion_id = '11111111-1111-1111-1111-111111111111' and tipo = 'dolar_sin_cargar'),
  1, 'dolar_sin_cargar aparece si la organización no cargó el dólar hoy'
);
select is(
  (select count(*)::int from dominio.alertas_inicio where organizacion_id = '11111111-1111-1111-1111-111111111111' and tipo = 'margen_negativo'
      and referencia_id = 'b1000000-0000-0000-0000-000000000003'),
  2, 'margen_negativo aparece por empresa con el producto de costo mayor al neto'
);
select is(public.recalcular_alertas_inicio('22222222-2222-2222-2222-222222222222') ->> 'alertas', '2',
  'la organización Dos calcula 2 alertas: sin_stock y consultas (el dólar sí se cargó hoy)');
select is(
  (select count(*)::int from dominio.alertas_inicio where organizacion_id = '22222222-2222-2222-2222-222222222222' and tipo = 'dolar_sin_cargar'),
  0, 'con el dólar cargado hoy no hay alerta de dólar'
);
select is(
  (select alertas from dominio.alertas_inicio_calculos where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  7, 'el cálculo queda registrado con su cantidad'
);

-- ============================================================================
-- Enlaces de lista cerrada (FR-025) y sin Mercado Libre (FR-027)
-- ============================================================================

select is(
  (select array_agg(distinct tipo || '=' || enlace order by tipo || '=' || enlace) from dominio.alertas_inicio),
  array['consultas_sin_atender=/consultas', 'dolar_sin_cargar=/cotizacion', 'margen_negativo=/rentabilidad/productos',
        'sin_stock=/stock', 'stock_bajo=/stock'],
  'cada tipo enlaza a la pantalla donde se resuelve'
);
select throws_ok(
  $$insert into dominio.alertas_inicio (organizacion_id, tipo, seccion, cantidad, enlace)
    values ('11111111-1111-1111-1111-111111111111', 'sin_stock', 'stock', 1, 'https://ejemplo.com')$$,
  '23514', null, 'un enlace fuera de la lista cerrada no se puede guardar'
);
select throws_ok(
  $$insert into dominio.alertas_inicio (organizacion_id, tipo, seccion, cantidad, enlace)
    values ('11111111-1111-1111-1111-111111111111', 'precios_en_revision', 'mercado_libre', 1, '/stock')$$,
  '23514', null, 'no existe un tipo de alerta de Mercado Libre / precios en revisión (FR-027)'
);

-- ============================================================================
-- Idempotencia (SC-004)
-- ============================================================================

create temp table antes on commit drop as
  select organizacion_id, empresa_id, tipo, seccion, cantidad, referencia_id, enlace from dominio.alertas_inicio;

select public.recalcular_alertas_inicio('11111111-1111-1111-1111-111111111111');
select public.recalcular_alertas_inicio('22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from dominio.alertas_inicio), (select count(*)::int from antes),
  'recalcular otra vez deja la misma cantidad de filas (sin duplicados)'
);
select is(
  (select count(*)::int from (
     (select * from antes except select organizacion_id, empresa_id, tipo, seccion, cantidad, referencia_id, enlace from dominio.alertas_inicio)
     union all
     (select organizacion_id, empresa_id, tipo, seccion, cantidad, referencia_id, enlace from dominio.alertas_inicio except select * from antes)
   ) d),
  0, 'recalcular dos veces deja exactamente el mismo conjunto de alertas'
);
select throws_ok(
  $$insert into dominio.alertas_inicio (organizacion_id, tipo, seccion, cantidad, enlace)
    values ('11111111-1111-1111-1111-111111111111', 'sin_stock', 'stock', 3, '/stock')$$,
  '23505', null, 'no puede haber dos alertas del mismo tipo para la misma organización'
);

-- Un cambio en los datos se refleja y lo resuelto desaparece.
update dominio.existencias set cantidad = 10 where producto_id = 'b1000000-0000-0000-0000-000000000001';
select public.recalcular_alertas_inicio('11111111-1111-1111-1111-111111111111');
select is(
  (select count(*)::int from dominio.alertas_inicio where organizacion_id = '11111111-1111-1111-1111-111111111111' and tipo = 'sin_stock'),
  0, 'al reponer el producto, la alerta de sin stock desaparece'
);
select throws_ok(
  $$select public.recalcular_alertas_inicio('99999999-9999-9999-9999-999999999999')$$,
  '22023', null, 'una organización inexistente se rechaza'
);

-- ============================================================================
-- Lectura por rol, empresa y organización (FR-023)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.alertas_inicio_visibles), 6,
  'el administrador de la Uno ve las 6 alertas vigentes de su organización y ninguna de la Dos');
select is((select count(*)::int from public.alertas_inicio_visibles where seccion = 'rentabilidad'), 2,
  'el administrador ve las alertas de margen de sus dos empresas');

select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.alertas_inicio_visibles), 2, 'la organización Dos ve solo las suyas');
select is((select count(*)::int from public.alertas_inicio_calculo), 1, 'cada organización ve solo la fecha de su propio cálculo');

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is((select array_agg(distinct seccion) from public.alertas_inicio_visibles), array['stock'],
  'Depósito solo ve alertas de Stock: sin consultas, dólar ni rentabilidad');

select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select is(
  (select array_agg(seccion || ':' || coalesce(empresa_id::text, '-') order by seccion, empresa_id) from public.alertas_inicio_visibles),
  array['consultas:a1000000-0000-0000-0000-00000000000a', 'cotizacion_dolar:-', 'stock:-'],
  'Consulta ve stock, dólar y las consultas de SU empresa (no las de Mundo JC) y no ve rentabilidad'
);

select throws_ok(
  $$insert into dominio.alertas_inicio (organizacion_id, tipo, seccion, cantidad, enlace)
    values ('11111111-1111-1111-1111-111111111111', 'dolar_sin_cargar', 'cotizacion_dolar', 1, '/cotizacion')$$,
  '42501', null, 'una persona autenticada no puede escribir alertas'
);
select throws_ok(
  $$select public.recalcular_alertas_inicio('11111111-1111-1111-1111-111111111111')$$,
  '42501', null, 'una persona autenticada no puede disparar el recálculo'
);

reset role;
set local role anon;
select throws_ok($$select count(*) from public.alertas_inicio_visibles$$, '42501', null, 'anon no lee las alertas');

reset role;
set local role service_role;
select is(public.recalcular_alertas_inicio('22222222-2222-2222-2222-222222222222') ->> 'alertas', '2',
  'service_role puede recalcular');

select * from finish();
rollback;
