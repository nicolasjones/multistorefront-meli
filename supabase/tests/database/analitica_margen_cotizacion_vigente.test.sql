-- MSF-352 (revisión de F-PRE-06/F-PRE-08, hallazgo ALTO): la rentabilidad convierte el dólar con la cotización que
-- usa la tienda (la aplicada de la empresa según el alcance), no con la inicial. Cubre `analitica.margen_producto_canal`
-- (margen actual, alerta `margen_negativo`) y `analitica.margen_historico_producto_canal` (cargas generales y de la
-- empresa), y que el rol de solo lectura de Superset las consulta sin permisos de `private`.
begin;

select no_plan();

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda Dos');
-- P1: USD 12 con precio propio USD 12 en Mundo JC y costo USD 10. P2: USD 12 con precio propio $ 14.000 en Mundo JC y costo USD 10.
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'USD', 12, true),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Teclado', 'TEC-1', 'USD', 12, true);
insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 10);
insert into dominio.precios_propios_empresa (producto_id, empresa_id, organizacion_id, moneda, importe) values
  ('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'USD', 12),
  ('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ARS', 14000);
-- Cotización inicial 1.000 y aplicada 1.500 (la que usa la tienda).
insert into dominio.cotizacion_inicial (organizacion_id, valor) values ('11111111-1111-1111-1111-111111111111', 1000);
insert into dominio.cotizacion_aplicada (organizacion_id, empresa_id, valor) values ('11111111-1111-1111-1111-111111111111', null, 1500);

create function pg_temp.margen(p_empresa uuid, p_producto uuid, p_columna text) returns numeric language plpgsql as $$
declare v numeric;
begin
  execute format('select %I from analitica.margen_producto_canal where empresa_id = $1 and producto_id = $2', p_columna)
    into v using p_empresa, p_producto;
  return v;
end $$;

select is(has_function_privilege('superset_analitica', 'analitica.cotizacion_para(uuid, uuid)', 'execute'), true, 'Superset ejecuta cotizacion_para');
select is(has_function_privilege('authenticated', 'analitica.cotizacion_para(uuid, uuid)', 'execute'), false, 'authenticated no');
select is(has_function_privilege('anon', 'analitica.cotizacion_para(uuid, uuid)', 'execute'), false, 'anon no');
select is(has_function_privilege('superset_analitica', 'analitica.cotizacion_cercana(uuid, timestamptz, uuid)', 'execute'), true, 'Superset ejecuta cotizacion_cercana por empresa');

-- ============================================================================
-- Alcance «sistema»: inicial 1.000, aplicada 1.500
-- ============================================================================
select is(pg_temp.margen('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'precio_neto'), 18000::numeric,
  'precio propio USD 12: neto $ 18.000 (× la aplicada 1.500, no la inicial)');
select is(pg_temp.margen('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'costo'), 15000::numeric,
  'costo USD 10: $ 15.000 (no $ 10.000)');
select is(pg_temp.margen('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'margen'), 3000::numeric, 'margen $ 3.000');
select is(pg_temp.margen('e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'precio_neto'), 18000::numeric,
  'sin precio propio: lista USD 12 × 1.500');
-- Precio propio en pesos $ 14.000 con costo real $ 15.000: margen negativo (−7,14 %); con la cotización inicial se veía +28,6 %.
select is(pg_temp.margen('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'margen'), -1000::numeric,
  'precio propio $ 14.000 y costo $ 15.000: margen −$ 1.000');
select is(round(pg_temp.margen('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'margen_pct'), 4), -0.0714::numeric,
  'margen −7,14 %');
select is((select estado from analitica.margen_producto_canal where empresa_id = 'e1000000-0000-0000-0000-000000000001' and producto_id = 'a1000000-0000-0000-0000-000000000002'),
  'negativo', 'el estado es negativo');
select public.recalcular_alertas_inicio('11111111-1111-1111-1111-111111111111');
select is((select cantidad from dominio.alertas_inicio where tipo = 'margen_negativo' and empresa_id = 'e1000000-0000-0000-0000-000000000001'), 1,
  'salta la alerta margen_negativo de Mundo JC');
select is((select count(*)::int from dominio.alertas_inicio where tipo = 'margen_negativo' and empresa_id = 'e1000000-0000-0000-0000-000000000002'), 0,
  'y no la de Tienda Dos (sin precio propio)');

-- ============================================================================
-- Alcance «empresa»: Mundo JC 1.700, Tienda Dos sin fila propia (cae en la general 1.500)
-- ============================================================================
insert into dominio.cotizacion_configuracion (organizacion_id, alcance) values ('11111111-1111-1111-1111-111111111111', 'empresa');
insert into dominio.cotizacion_aplicada (organizacion_id, empresa_id, valor) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 1700);
select is(pg_temp.margen('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'precio_neto'), 20400::numeric,
  'Mundo JC: precio propio USD 12 × 1.700');
select is(pg_temp.margen('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'costo'), 17000::numeric,
  'Mundo JC: costo USD 10 × 1.700');
select is(pg_temp.margen('e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'costo'), 15000::numeric,
  'Tienda Dos sin fila propia: costo con la general 1.500');
select is(pg_temp.margen('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'margen'), -3000::numeric,
  'Mundo JC: precio propio $ 14.000 contra costo $ 17.000');
select is((select count(*)::int from analitica.margen_producto_canal), 4, 'una fila por producto y empresa: la cotización por empresa no duplica filas');

-- ============================================================================
-- Rol de solo lectura de Superset: consulta las vistas sin permisos de `private`
-- ============================================================================
-- El rol de CI no es miembro de superset_analitica: se lo agrega dentro de la transacción (el rollback lo deshace).
do $$ begin execute format('grant superset_analitica to %I', current_user); end $$;
create temp table resultado_superset (n integer);
grant all on resultado_superset to public;
set local role superset_analitica;
insert into resultado_superset select count(*)::int from analitica.margen_producto_canal;
reset role;
select is((select n from resultado_superset), 4, 'Superset consulta el margen actual sin permission denied');
delete from resultado_superset;

-- ============================================================================
-- Historia: la carga más cercana entre las generales y las de la empresa
-- ============================================================================
-- Generales: hace 2 días 1.000. Mundo JC: hace 1 día 1.700. Costo de Joystick USD 10 desde hace 3 días.
insert into dominio.cotizaciones (organizacion_id, empresa_id, valor, valor_anterior, variacion_pct, cargada_por_nombre, cargada_en, recalculo_aplicado) values
  ('11111111-1111-1111-1111-111111111111', null, 1000, null, null, 'Javier', now() - interval '2 days', true),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 1700, null, null, 'Emilse', now() - interval '1 day', true),
  -- Confirmada bajo el umbral (NO se aplicó): la tienda nunca cobró con 1.040.
  ('11111111-1111-1111-1111-111111111111', null, 1040, 1000, 4, 'Javier', now() - interval '12 hours', false);
insert into dominio.producto_costos_historial (organizacion_id, producto_id, costo, vigente_desde) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 10, now() - interval '3 days');

create function pg_temp.hist(p_empresa uuid, p_desde interval, p_hasta interval, p_columna text) returns numeric language plpgsql as $$
declare v numeric;
begin
  execute format('select %I from analitica.margen_historico_producto_canal where empresa_id = $1 and producto_id = ''a1000000-0000-0000-0000-000000000001'' and fecha between now() - $2 and now() - $3', p_columna)
    into v using p_empresa, p_desde, p_hasta;
  return v;
end $$;

select is(pg_temp.hist('e1000000-0000-0000-0000-000000000001', interval '1 day 1 minute', interval '1 day -1 minute', 'cotizacion'), 1700::numeric,
  'historia, Mundo JC el día de su carga: su cotización 1.700');
select is((select count(*)::int from analitica.margen_historico_producto_canal
            where empresa_id = 'e1000000-0000-0000-0000-000000000002' and producto_id = 'a1000000-0000-0000-0000-000000000001'
              and fecha between now() - interval '1 day 1 minute' and now() - interval '1 day -1 minute'), 0,
  'historia: la carga de Mundo JC no genera una fila de Tienda Dos');
select is(pg_temp.hist('e1000000-0000-0000-0000-000000000001', interval '3 days 1 minute', interval '3 days -1 minute', 'cotizacion'), 1000::numeric,
  'historia, Mundo JC hace 3 días: la general 1.000 (más cercana)');
select is(pg_temp.hist('e1000000-0000-0000-0000-000000000001', interval '1 minute', interval '-1 minute', 'cotizacion'), 1700::numeric,
  'historia, Mundo JC hoy: su última carga APLICADA 1.700 (no la 1.040 confirmada bajo el umbral)');
select is((select count(*)::int from analitica.margen_historico_producto_canal
            where producto_id = 'a1000000-0000-0000-0000-000000000001' and fecha between now() - interval '12 hours 1 minute' and now() - interval '11 hours 59 minutes'), 0,
  'una carga sin aplicar no genera fila en la historia');
select is(pg_temp.hist('e1000000-0000-0000-0000-000000000002', interval '1 minute', interval '-1 minute', 'cotizacion'), 1000::numeric,
  'historia, Tienda Dos hoy: solo las generales (1.000), no la carga de Mundo JC');
select is(pg_temp.hist('e1000000-0000-0000-0000-000000000001', interval '1 minute', interval '-1 minute', 'costo'), 17000::numeric,
  'y el costo en USD se convierte con esa cotización (USD 10 × 1.700)');
set local role superset_analitica;
insert into resultado_superset select count(*)::int from analitica.margen_historico_producto_canal;
reset role;
select ok((select n from resultado_superset) > 0, 'Superset consulta la historia sin permission denied');
select is(analitica.cotizacion_cercana('11111111-1111-1111-1111-111111111111', now(), 'e1000000-0000-0000-0000-000000000001'), 1700::numeric,
  'cotizacion_cercana por empresa devuelve la carga de Mundo JC');

select * from finish();
rollback;
