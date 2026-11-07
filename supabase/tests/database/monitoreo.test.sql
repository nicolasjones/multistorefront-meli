-- MSF-369 · F-OPS-03 (épica MSF-206, T020): eventos y alertas de monitoreo.
-- Cubre FR-024, FR-026, FR-027, FR-028, FR-031, SC-004 y SC-005: 4 fallos no alertan y 5 sí, una sola
-- alerta abierta, resolución y reapertura, cola 14 vs 15 minutos, permisos, `anon` y RLS superadmin.
-- Las fechas son relativas al reloj de la base (now()). El fixture corre como postgres; las lecturas,
-- como «authenticated» / «anon», igual que PostgREST.
begin;

select plan(42);

select has_table('public', 'eventos_monitoreo', 'existe public.eventos_monitoreo');
select has_table('public', 'alertas_monitoreo', 'existe public.alertas_monitoreo');
select ok(not has_table_privilege('anon', 'public.eventos_monitoreo', 'select'), 'anon no lee eventos');
select ok(not has_table_privilege('anon', 'public.alertas_monitoreo', 'select'), 'anon no lee alertas');
select ok(not has_table_privilege('authenticated', 'public.eventos_monitoreo', 'insert'), 'authenticated no inserta eventos directo');
select ok(not has_table_privilege('authenticated', 'public.alertas_monitoreo', 'update'), 'authenticated no actualiza alertas directo');
select ok(has_function_privilege('kestra_orquestacion', 'public.registrar_evento_monitoreo(text,text,text,text,uuid)', 'execute'), 'kestra_orquestacion registra eventos');
select ok(has_function_privilege('kestra_orquestacion', 'public.evaluar_monitoreo(integer,integer,integer)', 'execute'), 'kestra_orquestacion evalúa el monitoreo');
select ok(not has_function_privilege('authenticated', 'public.registrar_evento_monitoreo(text,text,text,text,uuid)', 'execute'), 'authenticated no registra eventos');
select ok(not has_function_privilege('authenticated', 'public.evaluar_monitoreo(integer,integer,integer)', 'execute'), 'authenticated no evalúa');
select ok(not has_function_privilege('anon', 'public.registrar_evento_monitoreo(text,text,text,text,uuid)', 'execute'), 'anon no registra eventos');
select ok(not has_function_privilege('anon', 'public.evaluar_monitoreo(integer,integer,integer)', 'execute'), 'anon no evalúa');

insert into organizaciones (id, nombre) values
  ('c1111111-1111-1111-1111-111111111111', 'Monitoreo X'),
  ('c2222222-2222-2222-2222-222222222222', 'Monitoreo Y');
insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'monitoreo-admin-x@example.com'),
  ('c1000000-0000-0000-0000-000000000002', 'monitoreo-super@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('c1000000-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111111', 'administrador');
insert into superadmins (user_id) values ('c1000000-0000-0000-0000-000000000002');
insert into sistemas_externos (id, descripcion) values
  ('monitoreo-x', 'Monitoreo X (fixture de test, sin valor de negocio)');
insert into conexiones (id, organizacion_id, sistema_externo, credencial_vault_id) values
  ('c1111111-1111-1111-1111-111111111112', 'c1111111-1111-1111-1111-111111111111', 'monitoreo-x', gen_random_uuid());
insert into capacidades_ejecucion (id, organizacion_id, conexion_id, clave) values
  ('c1111111-1111-1111-1111-1111111111a1', 'c1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111112', 'cap-a'),
  ('c1111111-1111-1111-1111-1111111111a2', 'c1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111112', 'cap-b'),
  ('c1111111-1111-1111-1111-1111111111a3', 'c1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111112', 'cap-c'),
  ('c1111111-1111-1111-1111-1111111111a4', 'c1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111112', 'cap-cola');

select ok(has_function_privilege('kestra_orquestacion', 'public.tiendas_a_sondear()', 'execute'), 'kestra_orquestacion lista las tiendas a sondear');
select ok(not has_function_privilege('authenticated', 'public.tiendas_a_sondear()', 'execute')
  and not has_function_privilege('anon', 'public.tiendas_a_sondear()', 'execute'), 'ni authenticated ni anon listan las tiendas a sondear');

-- Validación de entradas.
select throws_ok(
  $$select public.registrar_evento_monitoreo('otra', 'x', 'fallo')$$,
  'P0001', 'FUENTE_INVALIDA: la fuente no es válida', 'una fuente desconocida se rechaza');
select throws_ok(
  $$select public.registrar_evento_monitoreo('tienda', 'x', 'raro')$$,
  'P0001', 'RESULTADO_INVALIDO: el resultado debe ser ok o fallo', 'un resultado desconocido se rechaza');
select throws_ok(
  $$select * from public.evaluar_monitoreo(0, 5, 15)$$,
  'P0001', 'UMBRAL_INVALIDO: ventana 1–1440 min, fallos 1–1000, cola 1–1440 min', 'un umbral inválido se rechaza');

-- El motivo se sanitiza en la base: sin correos, teléfonos ni tokens.
select public.registrar_evento_monitoreo('tienda', 'san.example.com', 'fallo',
  'respondió a ana@example.com tel +54 11 5555-1234 Bearer abc123def456');
select ok(
  (select motivo_sanitizado from public.eventos_monitoreo where clave = 'san.example.com') !~ '(@|5555|abc123)',
  'el motivo guardado no conserva correo, teléfono ni token');

-- Tienda: 4 fallos no alertan, el 5.º sí (SC-004).
select public.registrar_evento_monitoreo('tienda', 'uno.example.com', 'fallo', 'HTTP 503', 'c1111111-1111-1111-1111-111111111111')
  from generate_series(1, 4);
select is((select count(*) from public.evaluar_monitoreo(10, 5, 15) where fuente = 'tienda' and clave = 'uno.example.com'),
  0::bigint, '4 fallos en 10 minutos no abren alerta');
select public.registrar_evento_monitoreo('tienda', 'uno.example.com', 'fallo', 'HTTP 503', 'c1111111-1111-1111-1111-111111111111');
select is((select count(*) from public.evaluar_monitoreo(10, 5, 15) where fuente = 'tienda' and clave = 'uno.example.com'),
  1::bigint, 'el 5.º fallo abre la alerta y la devuelve como nueva');
select is((select count(*) from public.evaluar_monitoreo(10, 5, 15) where fuente = 'tienda' and clave = 'uno.example.com'),
  0::bigint, 'mientras siga abierta no se repite (una sola notificación)');
select is((select count(*) from public.alertas_monitoreo where fuente = 'tienda' and clave = 'uno.example.com' and estado = 'abierta'),
  1::bigint, 'hay una sola alerta abierta por fuente y clave');
select ok((select notificada_en is not null from public.alertas_monitoreo where clave = 'uno.example.com'),
  'la alerta devuelta queda marcada como notificada');
select throws_ok(
  $$insert into public.alertas_monitoreo (fuente, clave) values ('tienda', 'uno.example.com')$$,
  '23505', null, 'el índice único parcial impide una segunda alerta abierta');

-- Más fallos con la alerta abierta no la duplican (tormenta de errores).
select public.registrar_evento_monitoreo('tienda', 'uno.example.com', 'fallo', 'HTTP 503') from generate_series(1, 5);
select is((select count(*) from public.evaluar_monitoreo(10, 5, 15)),
  0::bigint, 'una tormenta de fallos no genera otra notificación');

-- Resolución y reapertura.
select public.registrar_evento_monitoreo('tienda', 'uno.example.com', 'ok');
select is((select count(*) from public.evaluar_monitoreo(10, 5, 15)),
  0::bigint, 'al normalizarse no hay alertas nuevas');
select is((select estado from public.alertas_monitoreo where clave = 'uno.example.com'),
  'resuelta', 'la alerta pasa a resuelta cuando la fuente vuelve a la normalidad');
select public.registrar_evento_monitoreo('tienda', 'uno.example.com', 'fallo', 'HTTP 503') from generate_series(1, 5);
select is((select count(*) from public.evaluar_monitoreo(10, 5, 15) where clave = 'uno.example.com'),
  1::bigint, 'una nueva caída abre otra alerta');
select is((select count(*) from public.alertas_monitoreo where clave = 'uno.example.com'),
  2::bigint, 'queda la historia: una resuelta y una abierta');

-- Sincronización: 5 ejecuciones fallida/timeout de una capacidad en la ventana; 4 no; antiguas no.
insert into ejecuciones_worker (organizacion_id, conexion_id, capacidad_id, origen, estado, iniciada_en, finalizada_en, motivo_sanitizado)
select 'c1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111112',
  'c1111111-1111-1111-1111-1111111111a1', 'manual', case when n <= 3 then 'fallida' else 'timeout' end,
  now() - make_interval(mins => 9, secs => n), now() - make_interval(mins => 8, secs => n), 'FALLA_TECNICA:cap-a'
from generate_series(1, 5) n;
insert into ejecuciones_worker (organizacion_id, conexion_id, capacidad_id, origen, estado, iniciada_en, finalizada_en)
select 'c1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111112',
  'c1111111-1111-1111-1111-1111111111a2', 'manual', 'fallida',
  now() - make_interval(mins => 9, secs => n), now() - make_interval(mins => 8, secs => n)
from generate_series(1, 4) n;
insert into ejecuciones_worker (organizacion_id, conexion_id, capacidad_id, origen, estado, iniciada_en, finalizada_en)
select 'c1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111112',
  'c1111111-1111-1111-1111-1111111111a3', 'manual', 'fallida',
  now() - make_interval(mins => 40, secs => n), now() - make_interval(mins => 30, secs => n)
from generate_series(1, 5) n;

select is(
  (select array_agg(clave order by clave) from public.evaluar_monitoreo(10, 5, 15) where fuente = 'sincronizacion'),
  array['c1111111-1111-1111-1111-111111111111:cap-a'],
  'solo la capacidad con 5 ejecuciones fallida/timeout recientes alerta (4 y las antiguas no)');
select is((select count(*) from public.evaluar_monitoreo(10, 5, 15) where fuente = 'sincronizacion'),
  0::bigint, 'reevaluar no duplica los eventos ni la notificación de sincronización');
select is((select count(*) from public.eventos_monitoreo where fuente = 'sincronizacion'),
  5::bigint, 'cada ejecución fallida se registra una sola vez como evento');

-- Cola: 14 minutos sin avanzar no alerta; 15 sí (SC-005).
insert into ejecuciones_worker (id, organizacion_id, conexion_id, capacidad_id, origen, estado, iniciada_en, finalizada_en) values
  ('c1111111-1111-1111-1111-1111111111e1', 'c1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111112', 'c1111111-1111-1111-1111-1111111111a4', 'manual', 'exitosa', now() - interval '2 hours', now() - interval '1 hour'),
  ('c1111111-1111-1111-1111-1111111111e2', 'c1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111112', 'c1111111-1111-1111-1111-1111111111a4', 'manual', 'exitosa', now() - interval '2 hours', now() - interval '1 hour');
insert into despachos_ejecucion (id, ejecucion_id, organizacion_id, estado, created_at, updated_at) values
  ('c1111111-1111-1111-1111-1111111111d1', 'c1111111-1111-1111-1111-1111111111e1', 'c1111111-1111-1111-1111-111111111111', 'pendiente', now() - interval '14 minutes', now() - interval '14 minutes');
select is((select count(*) from public.evaluar_monitoreo(10, 5, 15) where fuente = 'cola'),
  0::bigint, 'una orden con 14 minutos sin avanzar no alerta');
insert into despachos_ejecucion (id, ejecucion_id, organizacion_id, estado, created_at, updated_at) values
  ('c1111111-1111-1111-1111-1111111111d2', 'c1111111-1111-1111-1111-1111111111e2', 'c1111111-1111-1111-1111-111111111111', 'pendiente', now() - interval '15 minutes', now() - interval '15 minutes');
select is((select array_agg(clave) from public.evaluar_monitoreo(10, 5, 15) where fuente = 'cola'),
  array['c1111111-1111-1111-1111-1111111111d2'], 'una orden con 15 minutos sin avanzar abre su alerta de cola');

-- Cuando la orden avanza, la alerta de cola se resuelve.
update despachos_ejecucion set estado = 'completada', updated_at = now()
  where id = 'c1111111-1111-1111-1111-1111111111d2';
select is((select count(*) from public.evaluar_monitoreo(10, 5, 15) where fuente = 'cola'),
  0::bigint, 'evaluar tras avanzar la orden no devuelve alertas nuevas');
select is((select estado from public.alertas_monitoreo where fuente = 'cola'),
  'resuelta', 'la alerta de cola se resuelve cuando la orden avanza');

-- Lectura: solo el operador de plataforma (FR-031).
select set_config('request.jwt.claims', json_build_object('sub', 'c1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*) from public.eventos_monitoreo), 0::bigint, 'un administrador de organización no lee eventos');
select is((select count(*) from public.alertas_monitoreo), 0::bigint, 'un administrador de organización no lee alertas');
select throws_ok(
  $$select * from public.evaluar_monitoreo(10, 5, 15)$$,
  '42501', null, 'authenticated no puede ejecutar evaluar_monitoreo');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'c1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select cmp_ok((select count(*) from public.alertas_monitoreo), '>', 0::bigint, 'el superadmin lee las alertas');
select cmp_ok((select count(*) from public.eventos_monitoreo), '>', 0::bigint, 'el superadmin lee los eventos');
reset role;

set local role anon;
select throws_ok($$select count(*) from public.alertas_monitoreo$$, '42501', null, 'anon no lee alertas');
reset role;

select * from finish();
rollback;
