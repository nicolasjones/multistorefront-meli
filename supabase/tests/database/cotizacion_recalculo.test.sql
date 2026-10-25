-- F-PRE-03 (MSF-267, épica MSF-116) · SC-003: vista previa, confirmación atómica y descarte.
-- Cubre FR-009…FR-013 con dos organizaciones: vista previa sin escritura, umbral de 1 %
-- (1005 sobre 1000 no recalcula; 1050 sí; justo 1 % sí), todas las empresas con el mismo valor
-- tras confirmar, doble confirmación (una sola gana), vencida rechazada, permisos por rol,
-- eventos de actividad, atomicidad (falla simulada), `a_pesos` con y sin cotización aplicada,
-- aislamiento entre organizaciones y `anon` sin ejecución ni acceso.
-- `rls_en_toda_tabla` cubre además que `cotizacion_aplicada` tenga RLS.
begin;

select plan(81);

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
-- Estructura y privilegios (FR-010, FR-011, FR-012)
-- ============================================================================

select ok((select relrowsecurity from pg_class where oid = 'dominio.cotizacion_aplicada'::regclass), 'cotizacion_aplicada tiene RLS activado');
select is(has_table_privilege('anon', 'dominio.cotizacion_aplicada', 'SELECT'), false, 'anon no lee cotizacion_aplicada');
select is(has_table_privilege('authenticated', 'dominio.cotizacion_aplicada', 'INSERT'), false, 'authenticated no inserta en cotizacion_aplicada');
select is(has_table_privilege('authenticated', 'dominio.cotizacion_aplicada', 'UPDATE'), false, 'authenticated no actualiza cotizacion_aplicada');
select is(has_function_privilege('anon', 'public.previsualizar_cotizacion()', 'EXECUTE'), false, 'anon no ejecuta previsualizar_cotizacion');
select is(has_function_privilege('anon', 'public.confirmar_cotizacion()', 'EXECUTE'), false, 'anon no ejecuta confirmar_cotizacion');
select is(has_function_privilege('anon', 'public.descartar_cotizacion()', 'EXECUTE'), false, 'anon no ejecuta descartar_cotizacion');
select is(has_function_privilege('authenticated', 'public.confirmar_cotizacion()', 'EXECUTE'), true, 'authenticated ejecuta confirmar_cotizacion');

-- ============================================================================
-- Administrador (org 1): sin cotización aplicada rige la inicial
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is(private.a_pesos(20, 'USD', '11111111-1111-1111-1111-111111111111'), 20000::numeric, 'a_pesos sin aplicada: usa la cotización inicial');
select is(private.a_pesos(1000, 'ARS', '11111111-1111-1111-1111-111111111111'), 1000::numeric, 'a_pesos: los pesos no se convierten');
select throws_ok($$select public.previsualizar_cotizacion()$$, 'P0002', 'sin_cotizacion_pendiente', 'sin pendiente no hay vista previa');
select throws_ok($$select public.confirmar_cotizacion()$$, 'P0002', 'sin_cotizacion_pendiente', 'sin pendiente no se confirma');

-- ============================================================================
-- Vista previa (FR-009): por empresa, muestra hoy/nuevo, sin escribir
-- ============================================================================

select lives_ok($$select public.cargar_cotizacion(1050)$$, 'se carga 1050 sobre la inicial 1000');

select is((select (public.previsualizar_cotizacion() ->> 'variacion_pct')::numeric), 5::numeric, 'vista previa: variación +5 %');
select is((select (public.previsualizar_cotizacion() ->> 'recalcula')::boolean), true, 'vista previa: 1050 sobre 1000 recalcula');
select is((select jsonb_array_length(public.previsualizar_cotizacion() -> 'empresas')), 2, 'vista previa: un mosaico por empresa activa');
select is((select (public.previsualizar_cotizacion() #>> '{empresas,0,precios}')::int), 2, 'vista previa: precios en USD visibles (solo activos en USD)');
select is((select public.previsualizar_cotizacion() #>> '{empresas,0,nombre}'), 'Mundo JC', 'vista previa: empresas ordenadas por nombre');
select is((select jsonb_array_length(public.previsualizar_cotizacion() -> 'muestra')), 2, 'vista previa: la muestra trae solo productos activos en USD de la organización');
select is((select public.previsualizar_cotizacion() #>> '{muestra,0,producto}'), 'Case', 'vista previa: muestra ordenada por nombre');
select is((select (public.previsualizar_cotizacion() #>> '{muestra,0,por_empresa,0,hoy}')::numeric), 10000::numeric, 'vista previa: precio de hoy sin regla (10 USD × 1000)');
select is((select (public.previsualizar_cotizacion() #>> '{muestra,0,por_empresa,0,nuevo}')::numeric), 10500::numeric, 'vista previa: precio nuevo sin regla (10 USD × 1050)');
select is((select (public.previsualizar_cotizacion() #>> '{muestra,0,por_empresa,1,hoy}')::numeric), 11000::numeric, 'vista previa: hoy con regla +10 % al $ 10');
select is((select (public.previsualizar_cotizacion() #>> '{muestra,0,por_empresa,1,nuevo}')::numeric), 11550::numeric, 'vista previa: nuevo con regla +10 % al $ 10');
select is((select count(*)::int from dominio.cotizaciones), 0, 'la vista previa no escribe el historial');
select is(private.a_pesos(20, 'USD', '11111111-1111-1111-1111-111111111111'), 20000::numeric, 'la vista previa no cambia ningún precio');

-- ============================================================================
-- Umbral: 1005 sobre 1000 (+0,5 %) solo se registra
-- ============================================================================

select lives_ok($$select public.cargar_cotizacion(1005)$$, 'cargar 1005 reemplaza la pendiente');
select is((select (public.previsualizar_cotizacion() ->> 'recalcula')::boolean), false, 'vista previa: 1005 sobre 1000 no recalcula');
select is((select (public.confirmar_cotizacion() ->> 'recalculo_aplicado')::boolean), false, 'confirmar 1005: solo se registra');
select is((select count(*)::int from dominio.cotizaciones), 1, 'confirmar 1005: el historial suma la carga');
select is((select precios_recalculados from dominio.cotizaciones), 0, 'confirmar 1005: cero precios recalculados');
select is((select count(*)::int from dominio.cotizacion_aplicada), 0, 'confirmar 1005: no se toca la cotización aplicada');
select is(private.a_pesos(20, 'USD', '11111111-1111-1111-1111-111111111111'), 20000::numeric, 'confirmar 1005: los precios no cambian');
select is((select count(*)::int from dominio.cotizacion_pendiente), 0, 'confirmar borra la pendiente');
select throws_ok($$select public.confirmar_cotizacion()$$, 'P0002', 'sin_cotizacion_pendiente', 'doble clic: la segunda confirmación no se aplica');
select is((select count(*)::int from dominio.cotizaciones), 1, 'doble clic: no duplica el historial');
select is((select (public.estado_cotizacion() -> 'vigente' ->> 'valor')::numeric), 1005::numeric, 'la cotización registrada pasa a ser la vigente');

reset role;
select is(
  (select count(*)::int from public.registro_actividad
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and tipo = 'recalculo.omitido'),
  1, 'evento recalculo.omitido registrado'
);
select is(
  (select count(*)::int from public.registro_actividad
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and tipo = 'cotizacion.cargada'),
  1, 'evento cotizacion.cargada registrado'
);
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- ============================================================================
-- Recalculo: 1050 sobre la vigente 1005 (+4,5 %) cambia todas las empresas juntas
-- ============================================================================

select lives_ok($$select public.cargar_cotizacion(1050)$$, 'cargar 1050');
select is((select (public.confirmar_cotizacion() ->> 'recalculo_aplicado')::boolean), true, 'confirmar 1050: recalcula');
select is((select precios_recalculados from dominio.cotizaciones order by cargada_en desc, id desc limit 1), 4, 'precios recalculados: 2 productos × 2 empresas');
select is((select valor_anterior from dominio.cotizaciones order by cargada_en desc, id desc limit 1), 1005::numeric, 'el historial guarda la cotización anterior');
select is((select valor from dominio.cotizacion_aplicada), 1050::numeric, 'la cotización aplicada pasa a 1050');
select is(private.a_pesos(20, 'USD', '11111111-1111-1111-1111-111111111111'), 21000::numeric, 'a_pesos con aplicada: usa 1050');
select is(private.precio_neto_empresa('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001'), 10500::numeric, 'empresa 1 recalculada con 1050');
select is(private.precio_neto_empresa('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002'), 11550::numeric, 'empresa 2 recalculada con el mismo 1050');

reset role;
select is(
  (select count(*)::int from public.registro_actividad
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and tipo = 'recalculo.aplicado'),
  1, 'evento recalculo.aplicado registrado'
);
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- Bajo el umbral con una aplicada previa: no la toca.
select lives_ok($$select public.cargar_cotizacion(1055)$$, 'cargar 1055 (+0,5 % sobre 1050)');
select is((select (public.confirmar_cotizacion() ->> 'recalculo_aplicado')::boolean), false, 'confirmar 1055: solo se registra');
select is((select valor from dominio.cotizacion_aplicada), 1050::numeric, 'confirmar 1055: la aplicada sigue en 1050');

-- ============================================================================
-- Vencida y descarte
-- ============================================================================

select lives_ok($$select public.cargar_cotizacion(1200)$$, 'cargar 1200');
reset role;
update dominio.cotizacion_pendiente
  set cargada_en = now() - interval '25 hours', expira_en = now() - interval '1 hour'
  where organizacion_id = '11111111-1111-1111-1111-111111111111';
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select throws_ok($$select public.confirmar_cotizacion()$$, 'P0002', 'sin_cotizacion_pendiente', 'una pendiente vencida no se confirma');
select throws_ok($$select public.previsualizar_cotizacion()$$, 'P0002', 'sin_cotizacion_pendiente', 'una pendiente vencida no tiene vista previa');

select lives_ok($$select public.cargar_cotizacion(1300)$$, 'cargar 1300');
select lives_ok($$select public.descartar_cotizacion()$$, 'Cancelar descarta la pendiente');
select is((select count(*)::int from dominio.cotizacion_pendiente), 0, 'descartar borra la pendiente');
select lives_ok($$select public.descartar_cotizacion()$$, 'descartar sin pendiente no falla');

reset role;
select is(
  (select count(*)::int from public.registro_actividad
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and tipo = 'cotizacion.descartada'),
  1, 'evento cotizacion.descartada: uno solo (descartar sin pendiente no deja evento)'
);
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- ============================================================================
-- Atomicidad: una falla a mitad de la confirmación no deja nada a medias
-- ============================================================================

select lives_ok($$select public.cargar_cotizacion(1300)$$, 'cargar 1300 para la falla simulada');

reset role;
create function public.falla_simulada_recalculo() returns trigger language plpgsql as $$
begin
  if new.tipo = 'recalculo.aplicado' then
    raise exception 'falla simulada';
  end if;
  return new;
end $$;
create trigger falla_simulada_recalculo before insert on public.registro_actividad
  for each row execute function public.falla_simulada_recalculo();
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select throws_ok($$select public.confirmar_cotizacion()$$, 'P0001', 'falla simulada', 'la falla simulada aborta la confirmación');
select is((select count(*)::int from dominio.cotizaciones), 3, 'tras la falla: el historial no suma ninguna fila');
select is((select valor from dominio.cotizacion_aplicada), 1050::numeric, 'tras la falla: la cotización aplicada no cambia');
select is((select valor from dominio.cotizacion_pendiente), 1300::numeric, 'tras la falla: la pendiente sigue ahí');
select is(private.a_pesos(20, 'USD', '11111111-1111-1111-1111-111111111111'), 21000::numeric, 'tras la falla: ninguna empresa cambió de precio');

reset role;
drop trigger falla_simulada_recalculo on public.registro_actividad;
drop function public.falla_simulada_recalculo();

-- ============================================================================
-- Operador (lectura) y depósito (ninguno): sin acciones
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select throws_ok($$select public.confirmar_cotizacion()$$, '42501', null, 'lectura: no confirma');
select throws_ok($$select public.descartar_cotizacion()$$, '42501', null, 'lectura: no descarta');
select throws_ok($$select public.previsualizar_cotizacion()$$, '42501', null, 'lectura: no ve la vista previa');
select is((select count(*)::int from dominio.cotizacion_aplicada), 1, 'lectura: ve la cotización aplicada para calcular precios');
select is((select count(*)::int from dominio.cotizacion_pendiente), 0, 'lectura: no ve la pendiente');

select pg_temp.como('d1000000-0000-0000-0000-000000000003');

select throws_ok($$select public.confirmar_cotizacion()$$, '42501', null, 'ninguno: no confirma');
select throws_ok($$select public.descartar_cotizacion()$$, '42501', null, 'ninguno: no descarta');

-- ============================================================================
-- Aislamiento y umbral justo en 1 % (org 2: inicial 500)
-- ============================================================================

select pg_temp.como('d2000000-0000-0000-0000-000000000001');

select throws_ok($$select public.previsualizar_cotizacion()$$, 'P0002', 'sin_cotizacion_pendiente', 'org 2: no ve la pendiente de la org 1');
select lives_ok($$select public.cargar_cotizacion(505)$$, 'org 2: cargar 505 (justo +1 % sobre 500)');
select is((select (public.previsualizar_cotizacion() ->> 'recalcula')::boolean), true, 'justo 1 % recalcula');
select is((select jsonb_array_length(public.previsualizar_cotizacion() -> 'muestra')), 1, 'org 2: la muestra solo trae sus productos');
select is((select (public.confirmar_cotizacion() ->> 'precios_recalculados')::int), 1, 'org 2: 1 producto × 1 empresa');
select is(private.a_pesos(10, 'USD', '22222222-2222-2222-2222-222222222222'), 5050::numeric, 'org 2: precios con 505');
select is((select count(*)::int from dominio.cotizacion_aplicada), 1, 'org 2: solo ve su cotización aplicada');

reset role;
select is(
  (select valor from dominio.cotizacion_aplicada where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1050::numeric, 'confirmar en la org 2 no mueve la cotización de la org 1'
);
select is(
  (select valor from dominio.cotizacion_pendiente where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1300::numeric, 'confirmar en la org 2 no toca la pendiente de la org 1'
);

select * from finish();
rollback;
