-- Épica MSF-206 (revisión independiente): `evaluar_monitoreo` sin tormenta de alertas ni falsos positivos.
--   * La cola se agrupa por organización (una alerta con la cantidad de órdenes), no una por orden.
--   * Máximo de 20 notificaciones por corrida: 19 alertas y un resumen «y N alertas más».
--   * La cancelación de un proceso (ejecución fallida con motivo CANCELADA) no cuenta como fallo de sincronización.
--   * Organización ajena: cada organización tiene su propia alerta de cola y un administrador no lee el monitoreo.
begin;

select plan(15);

insert into organizaciones (id, nombre) values
  ('a1111111-1111-1111-1111-111111111111', 'Tormenta Uno'),
  ('a2222222-2222-2222-2222-222222222222', 'Tormenta Dos');
insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'tormenta-admin-uno@example.com'),
  ('a2000000-0000-0000-0000-000000000001', 'tormenta-admin-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('a1000000-0000-0000-0000-000000000001', 'a1111111-1111-1111-1111-111111111111', 'administrador'),
  ('a2000000-0000-0000-0000-000000000001', 'a2222222-2222-2222-2222-222222222222', 'administrador');
insert into sistemas_externos (id, descripcion) values ('tormenta-x', 'Tormenta (fixture de test)') on conflict (id) do nothing;
insert into conexiones (id, organizacion_id, sistema_externo, credencial_vault_id) values
  ('a1111111-1111-1111-1111-111111111112', 'a1111111-1111-1111-1111-111111111111', 'tormenta-x', gen_random_uuid()),
  ('a2222222-2222-2222-2222-222222222223', 'a2222222-2222-2222-2222-222222222222', 'tormenta-x', gen_random_uuid());
insert into capacidades_ejecucion (id, organizacion_id, conexion_id, clave) values
  ('a1111111-1111-1111-1111-1111111111a1', 'a1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111112', 'cap-cola'),
  ('a1111111-1111-1111-1111-1111111111a2', 'a1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111112', 'cap-cancelada'),
  ('a1111111-1111-1111-1111-1111111111a3', 'a1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111112', 'cap-fallo'),
  ('a2222222-2222-2222-2222-2222222222a1', 'a2222222-2222-2222-2222-222222222222', 'a2222222-2222-2222-2222-222222222223', 'cap-cola');

-- Cola: 30 órdenes trabadas en la organización Uno y 2 en la Dos.
insert into ejecuciones_worker (id, organizacion_id, conexion_id, capacidad_id, origen, estado, iniciada_en, finalizada_en)
select gen_random_uuid(), 'a1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111112',
  'a1111111-1111-1111-1111-1111111111a1', 'manual', 'exitosa', now() - interval '3 hours', now() - interval '2 hours'
from generate_series(1, 30);
insert into ejecuciones_worker (id, organizacion_id, conexion_id, capacidad_id, origen, estado, iniciada_en, finalizada_en)
select gen_random_uuid(), 'a2222222-2222-2222-2222-222222222222', 'a2222222-2222-2222-2222-222222222223',
  'a2222222-2222-2222-2222-2222222222a1', 'manual', 'exitosa', now() - interval '3 hours', now() - interval '2 hours'
from generate_series(1, 2);
insert into despachos_ejecucion (ejecucion_id, organizacion_id, estado, created_at, updated_at)
select e.id, e.organizacion_id, 'pendiente', now() - interval '20 minutes', now() - interval '20 minutes'
from ejecuciones_worker e where e.capacidad_id in ('a1111111-1111-1111-1111-1111111111a1', 'a2222222-2222-2222-2222-2222222222a1');

select is((select count(*)::int from public.evaluar_monitoreo(10, 5, 15) where fuente = 'cola'), 2,
  '32 órdenes trabadas de dos organizaciones abren solo 2 alertas (una por organización)');
select is((select count(*)::int from public.alertas_monitoreo where fuente = 'cola' and estado = 'abierta'), 2, 'quedan 2 alertas de cola abiertas');
select is((select array_agg(clave order by clave) from public.alertas_monitoreo where fuente = 'cola'),
  array['a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222'],
  'la clave de la alerta de cola es la organización (cada una la suya)');
select ok((select motivo_sanitizado from public.alertas_monitoreo where fuente = 'cola' and organizacion_id = 'a1111111-1111-1111-1111-111111111111') like '30 órdenes%',
  'el motivo cuenta las órdenes trabadas de la organización');
select public.marcar_alerta_notificada(id) from public.alertas_monitoreo where notificada_en is null;

-- Cancelaciones del usuario: 5 ejecuciones fallidas con motivo CANCELADA NO son un fallo de sincronización.
insert into ejecuciones_worker (organizacion_id, conexion_id, capacidad_id, origen, estado, iniciada_en, finalizada_en, motivo_sanitizado)
select 'a1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111112', 'a1111111-1111-1111-1111-1111111111a2',
  'manual', 'fallida', now() - make_interval(mins => 9, secs => n), now() - make_interval(mins => 8, secs => n), 'CANCELADA'
from generate_series(1, 5) n;
select is((select count(*)::int from public.evaluar_monitoreo(10, 5, 15) where fuente = 'sincronizacion'), 0,
  '5 cancelaciones manuales en 10 minutos no abren una alerta de sincronización');
select is((select count(*)::int from public.eventos_monitoreo where fuente = 'sincronizacion'), 0,
  'y no se registran como eventos de fallo');
insert into ejecuciones_worker (organizacion_id, conexion_id, capacidad_id, origen, estado, iniciada_en, finalizada_en, motivo_sanitizado)
select 'a1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111112', 'a1111111-1111-1111-1111-1111111111a3',
  'manual', 'fallida', now() - make_interval(mins => 9, secs => n), now() - make_interval(mins => 8, secs => n), 'FALLA_TECNICA'
from generate_series(1, 5) n;
select is((select count(*)::int from public.evaluar_monitoreo(10, 5, 15) where fuente = 'sincronizacion'), 1,
  'en cambio 5 fallos reales sí abren la alerta (la exclusión es solo de CANCELADA)');
select public.marcar_alerta_notificada(id) from public.alertas_monitoreo where notificada_en is null;

-- Tormenta de tiendas: 25 tiendas caen a la vez (Kestra perdió la red).
select public.registrar_evento_monitoreo('tienda', 't' || n || '.example.com', 'fallo', 'SIN_RESPUESTA', 'a1111111-1111-1111-1111-111111111111')
from generate_series(1, 25) n, generate_series(1, 5) k;
create temp table corrida as select * from public.evaluar_monitoreo(10, 5, 15);
select is((select count(*)::int from corrida), 20, 'la corrida notifica como máximo 20 filas');
select is((select count(*)::int from corrida where alerta_id is not null), 19, 'son 19 alertas individuales');
select is((select motivo_sanitizado from corrida where fuente = 'resumen'), 'y 6 alertas más abiertas (ver alertas_monitoreo)',
  'y un resumen con las restantes («y N más»)');
select is((select count(*)::int from public.alertas_monitoreo where estado = 'abierta' and fuente = 'tienda'), 25,
  'las 25 alertas quedan abiertas y visibles en alertas_monitoreo');
select public.marcar_alerta_notificada(alerta_id) from corrida where alerta_id is not null;
-- Sin pérdida: si el resumen no se pudo enviar (el flow no marca las cubiertas), siguen pendientes y vuelven.
select is((select count(*)::int from public.alertas_monitoreo where estado = 'abierta' and notificada_en is null), 6,
  'las 6 alertas cubiertas por el resumen siguen pendientes hasta que el resumen se envíe');
select is((select count(*)::int from public.evaluar_monitoreo(10, 5, 15) where fuente = 'resumen'), 1,
  'la siguiente corrida vuelve a devolver el resumen (no se perdieron)');
-- Resumen enviado bien: el flow marca las cubiertas.
select public.marcar_alertas_notificadas(string_to_array(cubiertas, ',')::uuid[]) from corrida where fuente = 'resumen';
select is((select count(*)::int from public.evaluar_monitoreo(10, 5, 15)), 0,
  'tras enviar el resumen y marcar las cubiertas la siguiente corrida no repite nada');

-- Organización ajena: el administrador de Dos no lee el monitoreo de Uno.
select set_config('request.jwt.claims', json_build_object('sub', 'a2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from public.alertas_monitoreo) + (select count(*)::int from public.eventos_monitoreo)
  + (select count(*)::int from public.estado_tiendas_monitoreo), 0,
  'el administrador de otra organización no ve alertas, eventos ni estado de tiendas');
reset role;

select * from finish();
rollback;
