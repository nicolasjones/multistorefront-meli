-- F-PRE-06 (MSF-419, épica MSF-352) · SC-002: alcance de la cotización y uso de la configuración.
-- Cubre FR-003…FR-007 con dos organizaciones: columnas `empresa_id`, unicidad y FK compuesta, cambio de alcance
-- sistema↔empresa atómico (exige confirmación, deja evento, es idempotente), vista previa del cambio sin escribir,
-- carga por empresa que no mueve a las demás, umbral / redondeo / aviso configurados, comportamiento por defecto
-- igual al de MSF-116, `cotizacion_para` / `a_pesos` con y sin fila propia y permisos por rol.
-- Las fechas salen del reloj de la base (`now()`), nunca de un día fijo.
begin;

select plan(99);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'deposito@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

-- cotizacion_dolar: administrador = edición, operador = lectura, deposito = ninguno.
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

-- Org 1: dos empresas. «Mundo JC» sin regla (central); «Tienda Dos» central + 10 %.
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda Dos'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Tres');
insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct) values
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'central_ajuste', 10);

-- Org 1: 2 productos USD activos (Case 10, Joystick 20), 1 USD inactivo, 1 ARS.
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'USD', 20, true),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Case', 'CAS-1', 'USD', 10, true),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Viejo', 'VIE-1', 'USD', 5, false),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 'ARS', 1000, true),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Teclado', 'TEC-1', 'USD', 10, true);
insert into dominio.cotizacion_inicial (organizacion_id, valor) values
  ('11111111-1111-1111-1111-111111111111', 1000),
  ('22222222-2222-2222-2222-222222222222', 500);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Estructura y privilegios (FR-003, FR-004, FR-005)
-- ============================================================================

select ok(exists (select 1 from information_schema.columns where table_schema = 'dominio' and table_name = 'cotizacion_pendiente' and column_name = 'empresa_id'), 'cotizacion_pendiente tiene empresa_id');
select ok(exists (select 1 from information_schema.columns where table_schema = 'dominio' and table_name = 'cotizacion_aplicada' and column_name = 'empresa_id'), 'cotizacion_aplicada tiene empresa_id');
select ok(exists (select 1 from information_schema.columns where table_schema = 'dominio' and table_name = 'cotizaciones' and column_name = 'empresa_id'), 'cotizaciones tiene empresa_id');
select is(has_function_privilege('anon', 'public.cambiar_alcance_cotizacion(text, boolean)', 'EXECUTE'), false, 'anon no ejecuta cambiar_alcance_cotizacion');
select is(has_function_privilege('anon', 'public.previsualizar_cambio_alcance(text)', 'EXECUTE'), false, 'anon no ejecuta previsualizar_cambio_alcance');
select is(has_function_privilege('authenticated', 'public.cambiar_alcance_cotizacion(text, boolean)', 'EXECUTE'), true, 'authenticated ejecuta cambiar_alcance_cotizacion');
select is(has_table_privilege('anon', 'dominio.cotizacion_pendiente', 'SELECT'), false, 'anon no lee cotizacion_pendiente');

-- ============================================================================
-- Sin configuración: alcance «sistema» y cotización inicial
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is(private.cotizacion_para('11111111-1111-1111-1111-111111111111', null), 1000::numeric, 'cotizacion_para sin fila: la inicial');
select is(private.cotizacion_para('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001'), 1000::numeric, 'alcance sistema: una empresa usa la general');

-- ============================================================================
-- Umbral configurado (FR-006): 2 %, luego 0,5 %
-- ============================================================================

select lives_ok($$select public.guardar_configuracion_cotizacion(10, 2, 20, true)$$, 'umbral 2 %');
select lives_ok($$select public.cargar_cotizacion(1015)$$, 'cargar 1015 (+1,5 %)');
select is((select (public.previsualizar_cotizacion() ->> 'umbral_pct')::numeric), 2::numeric, 'la vista previa informa el umbral configurado');
select is((select (public.previsualizar_cotizacion() ->> 'recalcula')::boolean), false, '+1,5 % con umbral 2 %: sin recálculo');
select is((select (public.confirmar_cotizacion() ->> 'recalculo_aplicado')::boolean), false, 'confirmar +1,5 % con umbral 2 %: solo se registra');
select is(private.a_pesos(20, 'USD', '11111111-1111-1111-1111-111111111111'), 20000::numeric, 'los precios no cambian bajo el umbral configurado');
select is((select umbral_pct from dominio.cotizaciones order by cargada_en desc, id desc limit 1), 2::numeric, 'el historial guarda el umbral usado');

select lives_ok($$select public.guardar_configuracion_cotizacion(10, 0.5, 20, true)$$, 'umbral 0,5 %');
select lives_ok($$select public.cargar_cotizacion(1022)$$, 'cargar 1022 (+0,69 % sobre 1015)');
select is((select (public.previsualizar_cotizacion() ->> 'recalcula')::boolean), true, '+0,69 % con umbral 0,5 %: recalcula');
select is((select (public.confirmar_cotizacion() ->> 'recalculo_aplicado')::boolean), true, 'confirmar +0,69 % con umbral 0,5 %: recalcula');
select is(private.a_pesos(20, 'USD', '11111111-1111-1111-1111-111111111111'), 20440::numeric, 'los precios usan 1022');

-- ============================================================================
-- Redondeo configurado (FR-007): rige el «Nuevo» de la vista previa; el de la empresa no se toca
-- ============================================================================

select lives_ok($$select public.guardar_configuracion_cotizacion(50, 0.5, 20, true)$$, 'redondeo al $ 50');
select lives_ok($$select public.cargar_cotizacion(1030)$$, 'cargar 1030');
select is((select (public.previsualizar_cotizacion() ->> 'redondeo_pesos')::int), 50, 'la vista previa informa el redondeo configurado');
select is((select (public.previsualizar_cotizacion() #>> '{muestra,0,por_empresa,0,nuevo}')::numeric), 10300::numeric, 'empresa sin ajuste: el nuevo es el central');
select is((select (public.previsualizar_cotizacion() #>> '{muestra,0,por_empresa,1,hoy}')::numeric), 11250::numeric, 'empresa con +10 %: hoy redondeado al $ 50 configurado');
select is((select (public.previsualizar_cotizacion() #>> '{muestra,0,por_empresa,1,nuevo}')::numeric), 11350::numeric, 'empresa con +10 %: nuevo redondeado al $ 50 configurado');
select lives_ok($$select public.descartar_cotizacion()$$, 'descartar la pendiente');
select is((select count(*)::int from dominio.cotizacion_pendiente), 0, 'descartar borra la pendiente');
select is((select redondeo_pesos from dominio.precios_empresa where empresa_id = 'e1000000-0000-0000-0000-000000000002'), 10, 'el redondeo de la regla de la empresa no cambia');
select is(private.precio_neto_empresa('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002'), 11240::numeric, 'el neto real sigue redondeando con el de la empresa ($ 10)');

-- ============================================================================
-- Cambio de alcance sistema → empresa (FR-004, FR-005)
-- ============================================================================

select is((select jsonb_array_length(public.previsualizar_cambio_alcance('empresa') -> 'empresas')), 2, 'vista previa del alcance: una fila por empresa activa');
select is((select (public.previsualizar_cambio_alcance('empresa') #>> '{empresas,0,precios_que_cambian}')::int), 0, 'sistema→empresa: cada empresa arranca con la vigente, no cambia ninguno');
select is((select public.obtener_configuracion_cotizacion() ->> 'alcance'), 'sistema', 'la vista previa no cambia el alcance');
select is((select count(*)::int from dominio.cotizacion_aplicada where empresa_id is not null), 0, 'la vista previa no escribe cotizaciones por empresa');
select throws_ok($$select public.cambiar_alcance_cotizacion('empresa', false)$$, '22023', 'Confirmá el cambio de alcance después de ver la vista previa', 'cambiar sin confirmar se rechaza');
select throws_ok($$select public.cambiar_alcance_cotizacion('mundo', true)$$, '22023', 'Elegí un alcance válido', 'alcance inválido');
select is((select public.cambiar_alcance_cotizacion('empresa', true) ->> 'alcance'), 'empresa', 'cambiar a una por empresa');
select is((select count(*)::int from dominio.cotizacion_aplicada where empresa_id is not null), 2, 'cada empresa activa quedó con su cotización');
select is((select count(*)::int from dominio.cotizacion_aplicada where empresa_id is not null and valor = 1022), 2, 'ambas arrancaron con la vigente (1022)');
select is((select count(*)::int from dominio.cotizacion_aplicada where empresa_id is null), 1, 'la general queda intacta');
select is((select (public.cambiar_alcance_cotizacion('empresa', true) ->> 'precios_afectados')::int), 0, 'repetir el cambio no hace nada (idempotente)');

reset role;
select is(
  (select count(*)::int from public.registro_actividad
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and tipo = 'cotizacion.alcance_cambiado'),
  1, 'el cambio de alcance deja un solo evento'
);
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- ============================================================================
-- Alcance «empresa»: la carga es de UNA empresa y no mueve a las demás (FR-006)
-- ============================================================================

select throws_ok($$select public.cargar_cotizacion(1100)$$, '22023', 'Elegí la empresa de la cotización', 'con alcance empresa, cargar exige empresa');
select throws_ok($$select public.cargar_cotizacion(1100, 'e2000000-0000-0000-0000-000000000001')$$, 'P0002', 'La empresa no existe en tu organización', 'una empresa de otra organización se rechaza');
select lives_ok($$select public.cargar_cotizacion(1100, 'e1000000-0000-0000-0000-000000000001')$$, 'cargar 1100 para Mundo JC');
select throws_ok($$select public.previsualizar_cotizacion()$$, '22023', 'Elegí la empresa de la cotización', 'la vista previa exige empresa');
select throws_ok($$select public.previsualizar_cotizacion('e1000000-0000-0000-0000-000000000002')$$, 'P0002', 'sin_cotizacion_pendiente', 'Tienda Dos no tiene pendiente');
select is((select (public.previsualizar_cotizacion('e1000000-0000-0000-0000-000000000001') ->> 'recalcula')::boolean), true, 'vista previa de Mundo JC: recalcula');
select is((select jsonb_array_length(public.previsualizar_cotizacion('e1000000-0000-0000-0000-000000000001') -> 'empresas')), 1, 'la vista previa se acota a la empresa');
select is((select (public.estado_cotizacion('e1000000-0000-0000-0000-000000000001') -> 'pendiente' ->> 'valor')::numeric), 1100::numeric, 'el estado de Mundo JC ve su pendiente');
select is((select jsonb_typeof(public.estado_cotizacion('e1000000-0000-0000-0000-000000000002') -> 'pendiente')), 'null', 'el estado de Tienda Dos no ve la pendiente de Mundo JC');
select is((select (public.confirmar_cotizacion('e1000000-0000-0000-0000-000000000001') ->> 'precios_recalculados')::int), 2, 'confirmar: solo los 2 precios en USD de esa empresa');
select is(private.a_pesos(20, 'USD', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001'), 22000::numeric, 'Mundo JC usa su propio 1100');
select is(private.a_pesos(20, 'USD', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002'), 20440::numeric, 'Tienda Dos conserva su valor (1022)');
select is(private.a_pesos(20, 'USD', '11111111-1111-1111-1111-111111111111'), 20440::numeric, 'a_pesos de tres argumentos sigue leyendo la general');
select is(private.precio_neto_empresa('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001'), 11000::numeric, 'neto de Mundo JC con su dólar');
select is(private.precio_neto_empresa('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002'), 11240::numeric, 'neto de Tienda Dos con el suyo');
select is((select (public.estado_cotizacion('e1000000-0000-0000-0000-000000000001') -> 'vigente' ->> 'valor')::numeric), 1100::numeric, 'vigente de Mundo JC: 1100');
select is((select (public.estado_cotizacion('e1000000-0000-0000-0000-000000000002') -> 'vigente' ->> 'valor')::numeric), 1022::numeric, 'vigente de Tienda Dos: 1022');

-- Historial y aviso acotados a la empresa
select is((select count(*)::int from dominio.cotizaciones where empresa_id = 'e1000000-0000-0000-0000-000000000001'), 1, 'el historial guarda la empresa');
select is((select count(*)::int from dominio.cotizaciones where empresa_id is null), 2, 'el historial general anterior quedó intacto');
select is((select jsonb_array_length(public.listar_cotizaciones(10, null, 'e1000000-0000-0000-0000-000000000001') -> 'filas')), 1, 'historial de Mundo JC: su carga');
select is((select jsonb_array_length(public.listar_cotizaciones(10, null, 'e1000000-0000-0000-0000-000000000002') -> 'filas')), 0, 'historial de Tienda Dos: vacío');
select throws_ok($$select public.listar_cotizaciones(10, null, null)$$, '22023', 'Elegí la empresa de la cotización', 'el historial exige empresa');
select is((select (public.cotizacion_del_dia('e1000000-0000-0000-0000-000000000001') ->> 'cargada_hoy')::boolean), true, 'Mundo JC cargó hoy');
select is((select (public.cotizacion_del_dia('e1000000-0000-0000-0000-000000000002') ->> 'cargada_hoy')::boolean), false, 'Tienda Dos no cargó hoy');
select is((select (public.cotizacion_del_dia() ->> 'cargada_hoy')::boolean), false, 'sin empresa: no están todas cargadas');

-- Aviso configurado
select lives_ok($$select public.guardar_configuracion_cotizacion(10, 0.5, 20, false)$$, 'apagar el aviso en Inicio');
select is((select (public.cotizacion_del_dia() ->> 'aviso_activo')::boolean), false, 'cotizacion_del_dia informa el aviso apagado');

-- ============================================================================
-- Vuelta a «sistema»: se descartan las cotizaciones propias, el historial queda
-- ============================================================================

select is((select (public.previsualizar_cambio_alcance('sistema') #>> '{empresas,0,precios_que_cambian}')::int), 2, 'empresa→sistema: Mundo JC (1100) cambia sus 2 precios');
select is((select (public.previsualizar_cambio_alcance('sistema') #>> '{empresas,1,precios_que_cambian}')::int), 0, 'empresa→sistema: Tienda Dos (1022) no cambia ninguno');
select is((select (public.cambiar_alcance_cotizacion('sistema', true) ->> 'precios_afectados')::int), 2, 'volver a sistema: 2 precios afectados');
select is((select public.obtener_configuracion_cotizacion() ->> 'alcance'), 'sistema', 'el alcance volvió a sistema');
select is((select count(*)::int from dominio.cotizacion_aplicada where empresa_id is not null), 0, 'se descartaron las cotizaciones propias');
select is(private.a_pesos(20, 'USD', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001'), 20440::numeric, 'Mundo JC vuelve a la general (1022)');
select is((select count(*)::int from dominio.cotizaciones where empresa_id = 'e1000000-0000-0000-0000-000000000001'), 1, 'el historial por empresa no se borra');
select is((select jsonb_array_length(public.listar_cotizaciones(10, null) -> 'filas')), 2, 'con alcance sistema el historial es el general');

-- ============================================================================
-- Permisos por rol
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok($$select public.cambiar_alcance_cotizacion('empresa', true)$$, '42501', 'Tu rol no puede cambiar el alcance de la cotización', 'lectura: no cambia el alcance');
select throws_ok($$select public.previsualizar_cambio_alcance('empresa')$$, '42501', 'Tu rol no puede cambiar el alcance de la cotización', 'lectura: no ve la vista previa del alcance');
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok($$select public.cambiar_alcance_cotizacion('empresa', true)$$, '42501', 'Tu rol no puede cambiar el alcance de la cotización', 'sin sección: no cambia el alcance');

-- ============================================================================
-- Org 2: comportamiento por defecto igual a MSF-116 y aislamiento
-- ============================================================================

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select lives_ok($$select public.cargar_cotizacion(504)$$, 'org 2: cargar 504 (+0,8 %)');
select is((select (public.previsualizar_cotizacion() ->> 'recalcula')::boolean), false, 'por defecto: +0,8 % no recalcula (umbral 1 %)');
select lives_ok($$select public.cargar_cotizacion(505)$$, 'org 2: cargar 505 (justo +1 %)');
select is((select (public.previsualizar_cotizacion() ->> 'recalcula')::boolean), true, 'por defecto: justo 1 % recalcula');
select lives_ok($$select public.descartar_cotizacion()$$, 'org 2: descartar');
select is((select public.cambiar_alcance_cotizacion('empresa', true) ->> 'alcance'), 'empresa', 'org 2 cambia a una por empresa');

reset role;
select is((select alcance from dominio.cotizacion_configuracion where organizacion_id = '11111111-1111-1111-1111-111111111111'), 'sistema', 'el cambio de la org 2 no toca el alcance de la org 1');
select is((select count(*)::int from dominio.cotizacion_aplicada where organizacion_id = '22222222-2222-2222-2222-222222222222' and empresa_id is not null), 1, 'org 2: su empresa arrancó con la vigente');
select is(private.a_pesos(20, 'USD', '11111111-1111-1111-1111-111111111111'), 20440::numeric, 'org 1 no se movió');

-- ============================================================================
-- Alerta de Inicio: respeta «Aviso en Inicio» y el alcance
-- ============================================================================

select lives_ok($$select public.recalcular_alertas_inicio('22222222-2222-2222-2222-222222222222')$$, 'recalcular alertas de la org 2');
select is(
  exists (select 1 from dominio.alertas_inicio where organizacion_id = '22222222-2222-2222-2222-222222222222' and tipo = 'dolar_sin_cargar'),
  true, 'con el aviso activo y la empresa sin cargar hoy hay alerta de dólar'
);
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select lives_ok($$select public.guardar_configuracion_cotizacion(10, 1, 15, false)$$, 'org 2 apaga el aviso');
reset role;
select lives_ok($$select public.recalcular_alertas_inicio('22222222-2222-2222-2222-222222222222')$$, 'recalcular de nuevo');
select is(
  exists (select 1 from dominio.alertas_inicio where organizacion_id = '22222222-2222-2222-2222-222222222222' and tipo = 'dolar_sin_cargar'),
  false, 'con el aviso apagado no hay alerta de dólar'
);

-- ============================================================================
-- Restricciones de las tablas (superusuario)
-- ============================================================================

select throws_ok(
  $$insert into dominio.cotizacion_aplicada (organizacion_id, valor, empresa_id) values ('11111111-1111-1111-1111-111111111111', 1, 'e2000000-0000-0000-0000-000000000001')$$,
  '23503', null, 'una empresa de otra organización no puede tener cotización (FK compuesta)'
);
select lives_ok(
  $$insert into dominio.cotizacion_aplicada (organizacion_id, valor, empresa_id) values ('11111111-1111-1111-1111-111111111111', 1, 'e1000000-0000-0000-0000-000000000001')$$,
  'una fila por organización y empresa'
);
select throws_ok(
  $$insert into dominio.cotizacion_aplicada (organizacion_id, valor, empresa_id) values ('11111111-1111-1111-1111-111111111111', 2, 'e1000000-0000-0000-0000-000000000001')$$,
  '23505', null, 'no se admite una segunda fila de la misma organización y empresa'
);
select throws_ok(
  $$insert into dominio.cotizacion_aplicada (organizacion_id, valor) values ('11111111-1111-1111-1111-111111111111', 2)$$,
  '23505', null, 'tampoco una segunda cotización general (empresa nula)'
);

select * from finish();
rollback;
