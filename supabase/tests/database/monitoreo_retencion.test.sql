-- Épica MSF-206 (revisión independiente): retención de eventos/alertas de monitoreo y procesos masivos
-- (`private.depurar_monitoreo_y_procesos`), índices, resultado `no_sondeable` del sondeo de tiendas (no es un
-- fallo) y vista `estado_tiendas_monitoreo`. Las fechas son relativas al reloj de la base.
begin;

select plan(26);

-- Estructura y privilegios
select has_index('public', 'eventos_monitoreo', 'eventos_monitoreo_ocurrido_idx', 'hay un índice por ocurrido_en');
select has_index('public', 'alertas_monitoreo', 'alertas_monitoreo_resueltas_idx', 'hay un índice de alertas resueltas por fecha');
select ok(not has_function_privilege('workers_orquestacion', 'private.depurar_monitoreo_y_procesos(timestamptz)', 'execute'), 'workers_orquestacion (y por herencia cada worker_<org>) no dispara la purga global');
select ok(has_function_privilege('kestra_orquestacion', 'private.depurar_monitoreo_y_procesos(timestamptz)', 'execute'), 'kestra_orquestacion ejecuta la depuración');
select ok(not has_function_privilege('authenticated', 'private.depurar_monitoreo_y_procesos(timestamptz)', 'execute'), 'authenticated no ejecuta la depuración');
select ok(not has_function_privilege('anon', 'private.depurar_monitoreo_y_procesos(timestamptz)', 'execute'), 'anon no ejecuta la depuración');

insert into organizaciones (id, nombre) values ('e1111111-1111-1111-1111-111111111111', 'Retención Uno');

-- Eventos: 2 viejos (>30 días) y 2 recientes.
insert into public.eventos_monitoreo (organizacion_id, fuente, clave, resultado, ocurrido_en) values
  ('e1111111-1111-1111-1111-111111111111', 'tienda', 'vieja.example.com', 'fallo', now() - interval '31 days'),
  ('e1111111-1111-1111-1111-111111111111', 'sincronizacion', 'x:y', 'fallo', now() - interval '45 days'),
  ('e1111111-1111-1111-1111-111111111111', 'tienda', 'reciente.example.com', 'ok', now() - interval '29 days'),
  ('e1111111-1111-1111-1111-111111111111', 'tienda', 'reciente.example.com', 'ok', now());

-- Alertas: resuelta vieja (>90), resuelta reciente (89 días) y abierta muy vieja (nunca se borra).
insert into public.alertas_monitoreo (fuente, clave, estado, abierta_en, resuelta_en) values
  ('tienda', 'resuelta-vieja.example.com', 'resuelta', now() - interval '100 days', now() - interval '91 days'),
  ('tienda', 'resuelta-reciente.example.com', 'resuelta', now() - interval '95 days', now() - interval '89 days');
insert into public.alertas_monitoreo (fuente, clave, estado, abierta_en) values
  ('tienda', 'abierta-vieja.example.com', 'abierta', now() - interval '200 days');

-- Procesos: terminado hace 181 días (con un error), terminado hace 179 días y abierto desde hace 400 días.
insert into public.procesos_masivos (id, organizacion_id, tipo, funcionalidad, nombre, estado, creado_en, finalizado_en) values
  ('e1000000-0000-0000-0000-000000000001', 'e1111111-1111-1111-1111-111111111111', 'importacion', 'catalogo', 'Viejo terminado',
   'completado', now() - interval '200 days', now() - interval '181 days'),
  ('e1000000-0000-0000-0000-000000000002', 'e1111111-1111-1111-1111-111111111111', 'importacion', 'catalogo', 'Reciente terminado',
   'completado', now() - interval '200 days', now() - interval '179 days');
insert into public.procesos_masivos (id, organizacion_id, tipo, funcionalidad, nombre, estado, creado_en) values
  ('e1000000-0000-0000-0000-000000000003', 'e1111111-1111-1111-1111-111111111111', 'importacion', 'catalogo', 'Abierto viejo',
   'en_curso', now() - interval '400 days');
insert into public.procesos_masivos_errores (proceso_id, organizacion_id, fila, motivo_sanitizado) values
  ('e1000000-0000-0000-0000-000000000001', 'e1111111-1111-1111-1111-111111111111', 1, 'Error viejo');
insert into public.procesos_masivos_errores_claves (proceso_id, clave) values
  ('e1000000-0000-0000-0000-000000000001', 'f:1');

create temp table resultado_depuracion (corrida int, eventos int, alertas int, procesos int);
grant all on resultado_depuracion to kestra_orquestacion;

set local role authenticated;
select throws_ok($$select * from private.depurar_monitoreo_y_procesos()$$, '42501', null, 'un usuario autenticado no depura');
reset role;
select is((select count(*)::int from public.eventos_monitoreo), 4, 'el rechazo no borra nada');

set local role kestra_orquestacion;
insert into resultado_depuracion select 1, * from private.depurar_monitoreo_y_procesos();
reset role;

select is((select eventos from resultado_depuracion where corrida = 1), 2, 'borra los 2 eventos con más de 30 días');
select is((select alertas from resultado_depuracion where corrida = 1), 1, 'borra la alerta resuelta con más de 90 días');
select is((select procesos from resultado_depuracion where corrida = 1), 1, 'borra el proceso terminado con más de 180 días');
select is((select count(*)::int from public.eventos_monitoreo where clave = 'reciente.example.com'), 2, 'conserva los eventos recientes');
select is((select count(*)::int from public.alertas_monitoreo where clave = 'resuelta-reciente.example.com'), 1, 'conserva la alerta resuelta reciente');
select is((select estado from public.alertas_monitoreo where clave = 'abierta-vieja.example.com'), 'abierta', 'conserva la alerta abierta aunque sea vieja');
select is((select count(*)::int from public.procesos_masivos where id = 'e1000000-0000-0000-0000-000000000002'), 1, 'conserva el proceso terminado reciente');
select is((select count(*)::int from public.procesos_masivos where id = 'e1000000-0000-0000-0000-000000000003'), 1, 'conserva el proceso abierto aunque sea viejo');
select is((select count(*)::int from public.procesos_masivos_errores where proceso_id = 'e1000000-0000-0000-0000-000000000001'), 0, 'se borran los errores del proceso depurado (cascada)');
select is((select count(*)::int from public.procesos_masivos_errores_claves where proceso_id = 'e1000000-0000-0000-0000-000000000001'), 0, 'y sus claves de idempotencia');

set local role kestra_orquestacion;
insert into resultado_depuracion select 2, * from private.depurar_monitoreo_y_procesos();
reset role;
select is((select eventos + alertas + procesos from resultado_depuracion where corrida = 2), 0, 'una segunda corrida no borra nada (idempotente)');

-- Resultado `no_sondeable`: se registra, no cuenta como fallo y no abre alertas.
select public.registrar_evento_monitoreo('tienda', 'interna.example.com', 'no_sondeable', 'NO_SONDEABLE_PRIVADA_RFC1918', 'e1111111-1111-1111-1111-111111111111')
  from generate_series(1, 6);
select is((select count(*)::int from public.eventos_monitoreo where clave = 'interna.example.com' and resultado = 'no_sondeable'), 6,
  'un sondeo bloqueado registra un evento no_sondeable');
select is((select count(*)::int from public.evaluar_monitoreo(10, 5, 15) where clave = 'interna.example.com'), 0,
  'seis eventos no_sondeable no abren alerta (no son fallos de la tienda)');
select throws_ok($$select public.registrar_evento_monitoreo('cola', 'x', 'no_sondeable')$$, 'P0001', null,
  'no_sondeable solo vale para la fuente tienda');

-- Vista: una fila por tienda con su último estado (caída, operativa, no_sondeable).
select public.registrar_evento_monitoreo('tienda', 'cae.example.com', 'fallo', 'HTTP 503') from generate_series(1, 5);
select public.evaluar_monitoreo(10, 5, 15);
select is((select estado from public.estado_tiendas_monitoreo where dominio = 'interna.example.com'), 'no_sondeable', 'la vista muestra no_sondeable');
select is((select estado from public.estado_tiendas_monitoreo where dominio = 'cae.example.com'), 'caida', 'la vista sigue marcando caida a la tienda con alerta');
select is((select estado from public.estado_tiendas_monitoreo where dominio = 'reciente.example.com'), 'operativa', 'y operativa a la que responde');
select is((select count(*)::int from public.estado_tiendas_monitoreo where dominio = 'reciente.example.com'), 1, 'una sola fila por tienda');

select * from finish();
rollback;
