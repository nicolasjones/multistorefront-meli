-- MSF-352 (revisión independiente de F-PRE-06/F-PRE-08): umbral contra la cotización aplicada, confirmación explícita de
-- la variación inusual en el servidor, valor anterior y nuevo en la actividad de la configuración, alertas de Inicio que
-- se recalculan al guardar la configuración o cambiar el alcance, vistas previas con precio propio y precio de la
-- tienda independiente de la sesión. Corre como postgres para armar el fixture y como «authenticated» para verificar.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda Dos'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Tres');

-- Joystick USD 10 · Teclado USD 10 con precio propio en pesos · Mouse USD 10 con precio propio en pesos · Cable ARS 100 con
-- precio propio en USD (en Mundo JC). Ninguno tiene regla de empresa: rige «central».
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'USD', 10, true),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Teclado', 'TEC-1', 'USD', 10, true),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Mouse', 'MOU-1', 'USD', 10, true),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 'ARS', 100, true);
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
  ('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111')
on conflict do nothing;
insert into dominio.precios_propios_empresa (producto_id, empresa_id, organizacion_id, moneda, importe) values
  ('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ARS', 5000),
  ('a1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ARS', 6000),
  ('a1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'USD', 4);
insert into dominio.cotizacion_inicial (organizacion_id, valor) values ('11111111-1111-1111-1111-111111111111', 1000);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Umbral medido contra la cotización APLICADA (sin deriva silenciosa)
-- ============================================================================
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok($$select public.guardar_configuracion_cotizacion(10, 5, 15, true)$$, 'umbral 5 %, confirmación 15 %');

select lives_ok($$select public.cargar_cotizacion(1040)$$, 'cargar 1040 (+4 % sobre la aplicada 1.000)');
select is((public.confirmar_cotizacion() ->> 'recalculo_aplicado')::boolean, false, '1040 está bajo el umbral: solo se registra');
select is(private.cotizacion_para('11111111-1111-1111-1111-111111111111', null), 1000::numeric, 'la aplicada sigue en 1.000');

select lives_ok($$select public.cargar_cotizacion(1081)$$, 'cargar 1081 (+4 % sobre 1.040 pero +8,1 % sobre la aplicada)');
select is((public.estado_cotizacion() ->> 'aplicada')::numeric, 1000::numeric, 'el estado informa la aplicada (1.000), aunque la última carga sea 1.040');
select is((public.previsualizar_cotizacion() ->> 'variacion_pct')::numeric, 8.1::numeric, 'la vista previa mide +8,1 % contra la aplicada');
select is((public.previsualizar_cotizacion() ->> 'recalcula')::boolean, true, 'la vista previa recalcula');
select is((public.confirmar_cotizacion() ->> 'recalculo_aplicado')::boolean, true, '1081 se aplica: la deriva no se acumula sin aviso');
select is(private.cotizacion_para('11111111-1111-1111-1111-111111111111', null), 1081::numeric, 'la aplicada pasa a 1.081');
select is((select valor_anterior from dominio.cotizaciones order by cargada_en desc, id desc limit 1), 1040::numeric,
  'el historial guarda la carga anterior (1.040), coherente con listar_cotizaciones');
select is((select (f ->> 'variacion_pct')::numeric from jsonb_array_elements(public.listar_cotizaciones(10, null) -> 'filas') f
            order by f ->> 'cargada_en' desc limit 1), (select variacion_pct from dominio.cotizaciones order by cargada_en desc, id desc limit 1),
  'la variación del historial guardada y la que lista listar_cotizaciones coinciden');

-- ============================================================================
-- Variación inusual: confirmación explícita en el servidor
-- ============================================================================
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok($$select public.cargar_cotizacion(149000)$$, 'cargar 149000 por error (en vez de 1490)');
select throws_ok($$select public.confirmar_cotizacion()$$, '22023', null, 'sin confirmación explícita una variación inusual no se aplica');
select throws_like($$select public.confirmar_cotizacion()$$, 'La variación de la cotización%supera el 15%configurado: confirmala explícitamente',
  'el error es claro');
select throws_ok($$select public.confirmar_cotizacion(null, false)$$, '22023', null, 'p_confirmado = false tampoco la aplica');
select is(private.cotizacion_para('11111111-1111-1111-1111-111111111111', null), 1081::numeric, 'la aplicada no se movió');
reset role;
select is((select count(*)::int from dominio.cotizacion_pendiente where organizacion_id = '11111111-1111-1111-1111-111111111111'), 1,
  'la pendiente sigue ahí (no se escribió nada)');
select is((select count(*)::int from dominio.cotizaciones where organizacion_id = '11111111-1111-1111-1111-111111111111'), 2, 'ni el historial');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok($$select public.descartar_cotizacion()$$, 'se descarta el valor mal tipeado');

select lives_ok($$select public.cargar_cotizacion(1490)$$, 'cargar 1490 (+37,8 %)');
select throws_ok($$select public.confirmar_cotizacion()$$, '22023', null, 'una suba grande también pide confirmación');
select lives_ok($$select public.confirmar_cotizacion(null, true)$$, 'con p_confirmado = true se aplica');
select is(private.cotizacion_para('11111111-1111-1111-1111-111111111111', null), 1490::numeric, 'la aplicada pasa a 1.490');

select lives_ok($$select public.cargar_cotizacion(1713.5)$$, 'cargar 1713,5 (justo +15 %)');
select lives_ok($$select public.confirmar_cotizacion()$$, 'una variación igual a la confirmación configurada no exige confirmación explícita');
select lives_ok($$select public.cargar_cotizacion(1370.8)$$, 'cargar 1370,8 (−20 %)');
select throws_ok($$select public.confirmar_cotizacion()$$, '22023', null, 'una baja inusual también exige confirmación');
select lives_ok($$select public.descartar_cotizacion()$$, 'se descarta');

-- ============================================================================
-- La configuración deja el valor anterior y el nuevo en la actividad (registro inalterable)
-- ============================================================================
reset role;
select is((select (valor_anterior ->> 'umbral_pct')::numeric from public.registro_actividad
            where tipo = 'cotizacion.configuracion_guardada' order by creado_en desc limit 1), 1::numeric,
  'actividad de la configuración: valor anterior (umbral 1 %)');
select is((select (valor_nuevo ->> 'umbral_pct')::numeric from public.registro_actividad
            where tipo = 'cotizacion.configuracion_guardada' order by creado_en desc limit 1), 5::numeric,
  'actividad de la configuración: valor nuevo (umbral 5 %)');
select is((select valor_nuevo ->> 'redondeo_pesos' from public.registro_actividad
            where tipo = 'cotizacion.configuracion_guardada' order by creado_en desc limit 1), '10',
  'y el redondeo');

-- ============================================================================
-- Alertas de Inicio: guardar la configuración o cambiar el alcance las recalcula
-- ============================================================================
-- Organización Dos: nunca se cargó el dólar ⇒ la alerta existe mientras el aviso esté activo.
select public.recalcular_alertas_inicio('22222222-2222-2222-2222-222222222222');
select is((select count(*)::int from dominio.alertas_inicio where organizacion_id = '22222222-2222-2222-2222-222222222222' and tipo = 'dolar_sin_cargar'), 1,
  'sin carga hoy y con aviso activo hay alerta de dólar sin cargar');
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select lives_ok($$select public.guardar_configuracion_cotizacion(10, 1, 15, false)$$, 'apagar el aviso en Inicio');
reset role;
select is((select count(*)::int from dominio.alertas_inicio where organizacion_id = '22222222-2222-2222-2222-222222222222' and tipo = 'dolar_sin_cargar'), 0,
  'al apagar el aviso la alerta desaparece sin esperar al barrido');
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select lives_ok($$select public.guardar_configuracion_cotizacion(10, 1, 15, true)$$, 'volver a activar el aviso');
reset role;
select is((select count(*)::int from dominio.alertas_inicio where organizacion_id = '22222222-2222-2222-2222-222222222222' and tipo = 'dolar_sin_cargar'), 1,
  'al reactivarlo la alerta vuelve');

-- Organización Uno: hay una carga general de hoy ⇒ sin alerta; con alcance «empresa» ninguna empresa cargó hoy ⇒ alerta.
select public.recalcular_alertas_inicio('11111111-1111-1111-1111-111111111111');
select is((select count(*)::int from dominio.alertas_inicio where organizacion_id = '11111111-1111-1111-1111-111111111111' and tipo = 'dolar_sin_cargar'), 0,
  'con alcance sistema y una carga de hoy no hay alerta');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok($$select public.cambiar_alcance_cotizacion('empresa', true)$$, 'pasar a una cotización por empresa');
reset role;
select is((select count(*)::int from dominio.alertas_inicio where organizacion_id = '11111111-1111-1111-1111-111111111111' and tipo = 'dolar_sin_cargar'), 1,
  'al cambiar el alcance la alerta se recalcula (ninguna empresa cargó hoy)');
select is((select valor_anterior ->> 'alcance' from public.registro_actividad where tipo = 'cotizacion.alcance_cambiado' order by creado_en desc limit 1),
  'sistema', 'la actividad del cambio de alcance deja el alcance anterior');
select is((select valor_nuevo ->> 'alcance' from public.registro_actividad where tipo = 'cotizacion.alcance_cambiado' order by creado_en desc limit 1),
  'empresa', 'y el nuevo');

-- ============================================================================
-- Vista previa del cambio de alcance con precio propio (alcance «empresa»: general 1.000, Mundo JC 1.500)
-- ============================================================================
update dominio.cotizacion_aplicada set valor = 1000 where organizacion_id = '11111111-1111-1111-1111-111111111111' and empresa_id is null;
update dominio.cotizacion_aplicada set valor = 1500 where organizacion_id = '11111111-1111-1111-1111-111111111111' and empresa_id = 'e1000000-0000-0000-0000-000000000001';
update dominio.cotizacion_aplicada set valor = 1000 where organizacion_id = '11111111-1111-1111-1111-111111111111' and empresa_id = 'e1000000-0000-0000-0000-000000000002';
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is((select (e ->> 'precios_que_cambian')::int from jsonb_array_elements((public.previsualizar_cambio_alcance('sistema') -> 'empresas')) e
            where e ->> 'empresa_id' = 'e1000000-0000-0000-0000-000000000001'), 2,
  'Mundo JC: cambian Joystick (USD) y Cable (precio propio en USD); Teclado y Mouse tienen precio propio en pesos y no se cuentan');
select is((select (e ->> 'precios_que_cambian')::int from jsonb_array_elements((public.previsualizar_cambio_alcance('sistema') -> 'empresas')) e
            where e ->> 'empresa_id' = 'e1000000-0000-0000-0000-000000000002'), 0, 'Tienda Dos ya usa la general: no cambia nada');
select ok(exists (select 1 from jsonb_array_elements((public.previsualizar_cambio_alcance('sistema') -> 'muestra')) m where m ->> 'producto' = 'Cable'),
  'la muestra incluye el producto en ARS con precio propio en USD');
select is((select (e -> 'hoy')::numeric from jsonb_array_elements((public.previsualizar_cambio_alcance('sistema') -> 'muestra')) m,
            jsonb_array_elements(m -> 'por_empresa') e where m ->> 'producto' = 'Cable' and e ->> 'empresa_id' = 'e1000000-0000-0000-0000-000000000001'),
  6000::numeric, 'Cable en Mundo JC hoy: USD 4 × 1.500');
select is((select (e -> 'nuevo')::numeric from jsonb_array_elements((public.previsualizar_cambio_alcance('sistema') -> 'muestra')) m,
            jsonb_array_elements(m -> 'por_empresa') e where m ->> 'producto' = 'Cable' and e ->> 'empresa_id' = 'e1000000-0000-0000-0000-000000000001'),
  4000::numeric, 'Cable en Mundo JC nuevo: USD 4 × la general destino (1.000), no × el alcance actual');
select is((select (e -> 'nuevo')::numeric from jsonb_array_elements((public.previsualizar_cambio_alcance('sistema') -> 'muestra')) m,
            jsonb_array_elements(m -> 'por_empresa') e where m ->> 'producto' = 'Teclado' and e ->> 'empresa_id' = 'e1000000-0000-0000-0000-000000000001'),
  5000::numeric, 'Teclado con precio propio en pesos no cambia');
select is((select (e -> 'nuevo')::numeric from jsonb_array_elements((public.previsualizar_cambio_alcance('sistema') -> 'muestra')) m,
            jsonb_array_elements(m -> 'por_empresa') e where m ->> 'producto' = 'Joystick' and e ->> 'empresa_id' = 'e1000000-0000-0000-0000-000000000001'),
  10000::numeric, 'Joystick en Mundo JC nuevo: USD 10 × 1.000');

-- Vista previa del dólar de una empresa: incluye el producto en ARS con precio propio en USD y deja afuera el de pesos.
select lives_ok($$select public.cargar_cotizacion(1600, 'e1000000-0000-0000-0000-000000000001')$$, 'cargar 1.600 para Mundo JC');
select is((select (e ->> 'precios')::int from jsonb_array_elements((public.previsualizar_cotizacion('e1000000-0000-0000-0000-000000000001') -> 'empresas')) e), 2,
  'Mundo JC: 2 precios dependen del dólar (Joystick y el precio propio en USD de Cable)');
select is(jsonb_array_length(public.previsualizar_cotizacion('e1000000-0000-0000-0000-000000000001') -> 'muestra'), 2,
  'la muestra coincide con precios_usd_por_empresa: 2 productos para Mundo JC');
select ok(exists (select 1 from jsonb_array_elements((public.previsualizar_cotizacion('e1000000-0000-0000-0000-000000000001') -> 'muestra')) m where m ->> 'producto' = 'Cable'),
  'la muestra incluye Cable (ARS con precio propio en USD)');
select ok(not exists (select 1 from jsonb_array_elements((public.previsualizar_cotizacion('e1000000-0000-0000-0000-000000000001') -> 'muestra')) m where m ->> 'producto' in ('Teclado', 'Mouse')),
  'y deja afuera los productos en USD con precio propio en pesos (no cambian con el dólar)');
select is((select (e -> 'nuevo')::numeric from jsonb_array_elements((public.previsualizar_cotizacion('e1000000-0000-0000-0000-000000000001') -> 'muestra')) m,
            jsonb_array_elements(m -> 'por_empresa') e where m ->> 'producto' = 'Cable'),
  6400::numeric, 'Cable nuevo: USD 4 × 1.600');
select is((select (e -> 'usd')::numeric from jsonb_array_elements((public.previsualizar_cotizacion('e1000000-0000-0000-0000-000000000001') -> 'muestra')) m,
            jsonb_array_elements(m -> 'por_empresa') e where m ->> 'producto' = 'Cable'),
  4::numeric, 'y muestra su precio propio en USD');
select lives_ok($$select public.descartar_cotizacion('e1000000-0000-0000-0000-000000000001')$$, 'descartar');

-- cambiar_alcance informa los mismos precios afectados que la vista previa.
select is((public.cambiar_alcance_cotizacion('sistema', true) ->> 'precios_afectados')::int, 2, 'cambiar a sistema: 2 precios afectados (con precio propio)');
reset role;

-- ============================================================================
-- El precio de la tienda no depende de quién mira (alcance «empresa»: Mundo JC 1.500, general 1.000)
-- ============================================================================
update dominio.cotizacion_configuracion set alcance = 'empresa' where organizacion_id = '11111111-1111-1111-1111-111111111111';
insert into dominio.cotizacion_aplicada (organizacion_id, empresa_id, valor) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 1500)
on conflict (organizacion_id, (coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid))) do update set valor = excluded.valor;
update dominio.cotizacion_aplicada set valor = 1000 where organizacion_id = '11111111-1111-1111-1111-111111111111' and empresa_id is null;

select set_config('request.jwt.claims', '{}', true);
select is(private.precio_final_publico('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001'), 15000::numeric,
  'visitante anónimo: Mundo JC cobra con su cotización (USD 10 × 1.500)');
select is(private.precio_final_publico('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002'), 10000::numeric,
  'visitante anónimo: Tienda Dos cae en la general');
select set_config('request.jwt.claims', json_build_object('sub', 'd2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select is(private.precio_final_publico('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001'), 15000::numeric,
  'sesión de OTRA organización: el mismo precio que el visitante anónimo (antes caía en la general: 10.000)');
select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select is(private.precio_final_publico('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001'), 15000::numeric,
  'sesión de la propia organización: el mismo precio');
select is(private.cotizacion_alcance('11111111-1111-1111-1111-111111111111'), 'empresa', 'cotizacion_alcance lee el alcance sin depender de la sesión');
select is(private.cotizacion_alcance('33333333-3333-3333-3333-333333333333'), 'sistema', 'sin configuración el alcance es sistema');
select is(has_function_privilege('anon', 'private.cotizacion_alcance(uuid)', 'execute'), false, 'anon no ejecuta cotizacion_alcance');


-- ============================================================================
-- estado_cotizacion para un rol con cotizacion_dolar pero SIN productos: la aplicada no llega nula
-- ============================================================================
insert into auth.users (id, email) values ('d1000000-0000-0000-0000-000000000002', 'consulta@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta');
insert into permisos_rol (organizacion_id, rol_id, seccion, nivel) values
  ('11111111-1111-1111-1111-111111111111', 'consulta', 'cotizacion_dolar', 'lectura'),
  ('11111111-1111-1111-1111-111111111111', 'consulta', 'productos', 'ninguno')
on conflict (organizacion_id, rol_id, seccion) do update set nivel = excluded.nivel;
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from dominio.cotizacion_aplicada), 0, 'el rol sin productos no lee cotizacion_aplicada directamente (RLS)');
select is((public.estado_cotizacion() ->> 'aplicada')::numeric, 1000::numeric, 'pero estado_cotizacion le informa la aplicada (1.000)');
select is(jsonb_typeof(public.estado_cotizacion() -> 'pendiente'), 'null', 'y no ve una pendiente (solo la ve quien edita)');
select throws_ok($$select public.estado_cotizacion('e2000000-0000-0000-0000-000000000001')$$, 'P0002', null, 'una empresa ajena se rechaza');
reset role;

-- Privilegios de las funciones nuevas o con firma nueva.
select is(has_function_privilege('anon', 'public.confirmar_cotizacion(uuid, boolean)', 'execute'), false, 'anon no confirma');
select is(has_function_privilege('authenticated', 'public.confirmar_cotizacion(uuid, boolean)', 'execute'), true, 'authenticated confirma');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'confirmar_cotizacion'), 1, 'queda una sola confirmar_cotizacion (la firma vieja se reemplazó)');

select * from finish();
rollback;
