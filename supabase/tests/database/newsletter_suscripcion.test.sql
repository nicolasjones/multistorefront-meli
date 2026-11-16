-- Newsletter de la tienda, Fase 1 (spec 20270328-100000-newsletter-de-la-tienda): estructura y grants (T001), RPC públicas (T002) y cola de
-- confirmaciones (T003). Cubre RF-NL-1, 3, 4, 5, 6, 22; CA-NL-1…5; SC-002.
-- Las llamadas públicas se hacen como `anon` con `request.headers` (IP del visitante) y se guardan en una tabla temporal; las verificaciones
-- corren como postgres (sesión de servicio: `private.exigir_llamante_kestra` la acepta).
begin;

select no_plan();

-- ============================================================================
-- Fixture
-- ============================================================================
insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B (sin interruptor)', true),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Tienda apagada', false),
  ('e1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Tienda D', true),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', true);

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'nl-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'nl-b.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000003', 'nl-apagada.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000004', 'nl-d.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'nl-dos.ejemplo.com');

-- Interruptor por tienda: A, la apagada, D y Dos activos; B sin fila.
insert into dominio.newsletter_configuracion (empresa_id, organizacion_id, activo) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', true),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', true),
  ('e1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', true),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', true);

-- ============================================================================
-- T001 · estructura, bandera y grants
-- ============================================================================
select is((select activa from public.banderas_plataforma where clave = 'newsletter'), false, 'la bandera newsletter existe y nace apagada');

select is(
  (select count(*)::int from pg_class c where c.oid in ('dominio.newsletter_configuracion'::regclass, 'dominio.newsletter_suscriptores'::regclass) and c.relrowsecurity),
  2, 'RF-NL-22: las dos tablas tienen RLS');
select is(
  has_table_privilege('anon', 'dominio.newsletter_suscriptores', 'select') or has_table_privilege('anon', 'dominio.newsletter_configuracion', 'select'),
  false, 'anon no tiene privilegios sobre las tablas');
select is(
  has_table_privilege('authenticated', 'dominio.newsletter_suscriptores', 'insert') or has_table_privilege('authenticated', 'dominio.newsletter_suscriptores', 'update')
  or has_table_privilege('authenticated', 'dominio.newsletter_suscriptores', 'delete') or has_table_privilege('authenticated', 'dominio.newsletter_configuracion', 'insert')
  or has_table_privilege('authenticated', 'dominio.newsletter_configuracion', 'update') or has_table_privilege('authenticated', 'dominio.newsletter_configuracion', 'delete'),
  false, 'authenticated no escribe directo');
select is(has_column_privilege('authenticated', 'dominio.newsletter_suscriptores', 'correo', 'select'), true, 'authenticated lee el correo (por columna)');
select is(
  (select count(*)::int from pg_attribute a
    where a.attrelid = 'dominio.newsletter_suscriptores'::regclass and a.attnum > 0 and not a.attisdropped
      and a.attname in ('confirmacion_hash', 'confirmacion_vence', 'confirmacion_reclamada_hasta', 'confirmacion_intentos', 'confirmaciones_24h')
      and has_column_privilege('authenticated', a.attrelid, a.attnum, 'select')),
  0, 'authenticated no lee el hash ni el estado interno del reclamo');
select is(has_table_privilege('service_role', 'dominio.newsletter_suscriptores', 'insert'), true, 'service_role opera la tabla de suscriptores (grant de tabla operativa)');
select is(
  (select count(*)::int from information_schema.columns where table_schema = 'dominio' and table_name = 'newsletter_suscriptores'
    and column_name in ('ip', 'ip_cliente', 'nombre', 'navegador', 'user_agent', 'visitante')),
  0, 'D2: no se guarda IP, navegador ni nombre');
select throws_ok(
  $$insert into dominio.newsletter_suscriptores (organizacion_id, empresa_id, correo, version_consentimiento)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'MAYUS@ejemplo.com', 'v1')$$,
  '23514', null, 'el correo se guarda en minúsculas (check)');
select throws_ok(
  $$insert into dominio.newsletter_suscriptores (organizacion_id, empresa_id, correo, version_consentimiento)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a@ejemplo.com,b@ejemplo.com', 'v1')$$,
  '23514', null, 'el correo admite una sola dirección (sin coma)');
select throws_ok(
  $$insert into dominio.newsletter_suscriptores (organizacion_id, empresa_id, correo, version_consentimiento)
    values ('11111111-1111-1111-1111-111111111111', 'e2000000-0000-0000-0000-000000000001', 'x@ejemplo.com', 'v1')$$,
  '23503', null, 'la FK compuesta impide una tienda de otra organización');
select throws_ok(
  $$insert into dominio.tienda_envios (organizacion_id, empresa_id, visitante, clave_envio, origen)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'x', gen_random_uuid(), 'otro')$$,
  '23514', null, 'el origen de tienda_envios sigue acotado');
select lives_ok(
  $$insert into dominio.tienda_envios (organizacion_id, empresa_id, visitante, clave_envio, origen)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'x', gen_random_uuid(), 'newsletter')$$,
  'tienda_envios admite el origen newsletter');

-- ============================================================================
-- T002 · funciones públicas
-- ============================================================================
select is(
  (select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text)
     from pg_proc p where p.pronamespace = 'publico'::regnamespace and p.proname like '%newsletter%' and has_function_privilege('anon', p.oid, 'execute')),
  array['publico.confirmar_newsletter(text,text)', 'publico.newsletter_por_dominio(text)', 'publico.suscribirse_newsletter(text,text,boolean,uuid,text)'],
  'anon ejecuta solo las tres funciones públicas del newsletter');
select is(
  (select count(*)::int from pg_proc p where p.pronamespace = 'private'::regnamespace
    and p.proname in ('validar_suscripcion_newsletter', 'empresa_newsletter_activa', 'reclamar_confirmaciones_newsletter', 'cerrar_confirmacion_newsletter', 'version_consentimiento_newsletter')
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  0, 'las funciones internas no son ejecutables por roles de API');

create temp table res (clave text primary key, j jsonb);
grant all on res to anon;

-- Con la bandera APAGADA todo responde igual (RF-NL-25).
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
select set_config('request.headers', '{"x-forwarded-for":"10.0.0.1"}', true);
set local role anon;
insert into res values
  ('off_por_dominio', publico.newsletter_por_dominio('nl-a.ejemplo.com')),
  ('off_suscribir', publico.suscribirse_newsletter('nl-a.ejemplo.com', 'off@ejemplo.com', true, '00000000-0000-0000-0000-0000000000f0', ''));
reset role;
select is((select j from res where clave = 'off_por_dominio'), '{"activo":false}'::jsonb, 'bandera apagada: newsletter_por_dominio devuelve activo = false');
select is((select j from res where clave = 'off_suscribir'), '{"resultado":"error"}'::jsonb, 'bandera apagada: suscribirse responde error');
select is((select count(*)::int from dominio.newsletter_suscriptores), 0, 'bandera apagada: no se guardó nada');

update public.banderas_plataforma set activa = true where clave = 'newsletter';

set local role anon;
insert into res values
  ('por_a', publico.newsletter_por_dominio('nl-a.ejemplo.com')),
  ('por_a_host', publico.newsletter_por_dominio('  NL-A.Ejemplo.com.:8080 ')),
  ('por_b', publico.newsletter_por_dominio('nl-b.ejemplo.com')),
  ('por_apagada', publico.newsletter_por_dominio('nl-apagada.ejemplo.com')),
  ('por_desconocido', publico.newsletter_por_dominio('no-existe.ejemplo.com')),
  ('por_dos', publico.newsletter_por_dominio('nl-dos.ejemplo.com')),
  -- Suscripciones del visitante 10.0.0.1 en la tienda A.
  ('s_nuevo', publico.suscribirse_newsletter('nl-a.ejemplo.com', '  Ana@Ejemplo.COM ', true, '00000000-0000-0000-0000-0000000000a1', '')),
  ('s_repetido_clave', publico.suscribirse_newsletter('nl-a.ejemplo.com', 'ana@ejemplo.com', true, '00000000-0000-0000-0000-0000000000a1', '')),
  ('s_existente', publico.suscribirse_newsletter('nl-a.ejemplo.com', 'ana@ejemplo.com', true, '00000000-0000-0000-0000-0000000000a2', '')),
  ('s_sin_casilla', publico.suscribirse_newsletter('nl-a.ejemplo.com', 'sin@ejemplo.com', false, '00000000-0000-0000-0000-0000000000f1', '')),
  ('s_invalido', publico.suscribirse_newsletter('nl-a.ejemplo.com', 'no-es-un-correo', true, '00000000-0000-0000-0000-0000000000f2', '')),
  ('s_coma', publico.suscribirse_newsletter('nl-a.ejemplo.com', 'a@ejemplo.com,b@ejemplo.com', true, '00000000-0000-0000-0000-0000000000f3', '')),
  ('s_largo', publico.suscribirse_newsletter('nl-a.ejemplo.com', repeat('a', 250) || '@ejemplo.com', true, '00000000-0000-0000-0000-0000000000f4', '')),
  ('s_trampa', publico.suscribirse_newsletter('nl-a.ejemplo.com', 'bot@ejemplo.com', true, '00000000-0000-0000-0000-0000000000f5', 'http://spam')),
  ('s_sin_clave', publico.suscribirse_newsletter('nl-a.ejemplo.com', 'sinclave@ejemplo.com', true, null, '')),
  ('s_b', publico.suscribirse_newsletter('nl-b.ejemplo.com', 'b@ejemplo.com', true, '00000000-0000-0000-0000-0000000000b1', '')),
  ('s_apagada', publico.suscribirse_newsletter('nl-apagada.ejemplo.com', 'x@ejemplo.com', true, '00000000-0000-0000-0000-0000000000b2', '')),
  ('s_desconocido', publico.suscribirse_newsletter('no-existe.ejemplo.com', 'x@ejemplo.com', true, '00000000-0000-0000-0000-0000000000b3', ''));
reset role;

select is((select j from res where clave = 'por_a'), '{"activo":true,"tienda":"Tienda A"}'::jsonb, 'RF-NL-1: con bandera y tienda activas devuelve activo y el nombre');
select is((select j from res where clave = 'por_a_host'), (select j from res where clave = 'por_a'), 'normaliza el host');
select ok(
  (select j = '{"activo":false}'::jsonb from res where clave = 'por_b')
  and (select j = '{"activo":false}'::jsonb from res where clave = 'por_apagada')
  and (select j = '{"activo":false}'::jsonb from res where clave = 'por_desconocido'),
  'RF-NL-1: sin interruptor, tienda desactivada o host desconocido: {activo:false} idéntico');
select is((select j ->> 'tienda' from res where clave = 'por_dos'), 'Tienda Dos', 'otra organización: su propia tienda');

select is((select j from res where clave = 's_nuevo'), '{"resultado":"ok"}'::jsonb, 'CA-NL-1: datos válidos → ok');
select is(
  (select row(correo, estado, origen, version_consentimiento, confirmaciones_24h)::text from dominio.newsletter_suscriptores where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  '(ana@ejemplo.com,pendiente,formulario,newsletter-v1,2)',
  'nace pendiente, recortado y en minúsculas, con su consentimiento y su versión (más el segundo pedido)');
select ok(
  (select consentimiento_en is not null and confirmacion_solicitada_en is not null and confirmacion_hash is null from dominio.newsletter_suscriptores where correo = 'ana@ejemplo.com'),
  'queda el consentimiento y la confirmación pedida, aún sin token');
select is((select j from res where clave = 's_repetido_clave'), '{"resultado":"ok"}'::jsonb, 'la misma clave responde ok sin duplicar');
select is((select j from res where clave = 's_existente'), (select j from res where clave = 's_nuevo'), 'CA-NL-3 / SC-002: dirección existente → respuesta idéntica a la nueva');
select is((select count(*)::int from dominio.newsletter_suscriptores where empresa_id = 'e1000000-0000-0000-0000-000000000001'), 1, 'una sola fila por dirección');
select is((select confirmaciones_24h from dominio.newsletter_suscriptores where correo = 'ana@ejemplo.com'), 2, 'la dirección ya pendiente suma un pedido de confirmación');
select is((select j -> 'campos' from res where clave = 's_sin_casilla'), '["consentimiento"]'::jsonb, 'CA-NL-1: casilla sin marcar → invalido (consentimiento)');
select ok(
  (select j = '{"resultado":"invalido","campos":["correo"]}'::jsonb from res where clave = 's_invalido')
  and (select j ->> 'resultado' = 'invalido' from res where clave = 's_coma')
  and (select j ->> 'resultado' = 'invalido' from res where clave = 's_largo'),
  'correo con formato inválido, con coma o de más de 254 → invalido');
select is((select j from res where clave = 's_trampa'), '{"resultado":"ok"}'::jsonb, 'campo trampa lleno → ok sin guardar');
select is((select count(*)::int from dominio.newsletter_suscriptores where correo in ('bot@ejemplo.com', 'sin@ejemplo.com', 'sinclave@ejemplo.com')), 0, 'trampa, sin casilla y sin clave no guardan nada');
select is((select j from res where clave = 's_sin_clave'), '{"resultado":"error"}'::jsonb, 'sin clave de intento → error');
select ok(
  (select j = '{"resultado":"error"}'::jsonb from res where clave = 's_b')
  and (select j = '{"resultado":"error"}'::jsonb from res where clave = 's_apagada')
  and (select j = '{"resultado":"error"}'::jsonb from res where clave = 's_desconocido'),
  'sin interruptor, tienda apagada y host desconocido: error idéntico');
select is(
  (select count(*)::int from dominio.tienda_envios where origen = 'newsletter' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  2, 'la validación corre antes del límite: solo los pedidos válidos consumen cupo (nuevo y existente)');

-- Límite por visitante (CA-NL-4): 5 por hora, compartido con la tienda; otro visitante no se ve afectado.
set local role anon;
insert into res values
  ('l_3', publico.suscribirse_newsletter('nl-a.ejemplo.com', 'l3@ejemplo.com', true, '00000000-0000-0000-0000-0000000000c3', '')),
  ('l_4', publico.suscribirse_newsletter('nl-a.ejemplo.com', 'l4@ejemplo.com', true, '00000000-0000-0000-0000-0000000000c4', '')),
  ('l_5', publico.suscribirse_newsletter('nl-a.ejemplo.com', 'l5@ejemplo.com', true, '00000000-0000-0000-0000-0000000000c5', '')),
  ('l_6', publico.suscribirse_newsletter('nl-a.ejemplo.com', 'l6@ejemplo.com', true, '00000000-0000-0000-0000-0000000000c6', '')),
  ('l_repetida', publico.suscribirse_newsletter('nl-a.ejemplo.com', 'l3@ejemplo.com', true, '00000000-0000-0000-0000-0000000000c3', ''));
select set_config('request.headers', '{"x-forwarded-for":"10.0.0.2"}', true);
insert into res values
  ('l_otro', publico.suscribirse_newsletter('nl-a.ejemplo.com', 'otro@ejemplo.com', true, '00000000-0000-0000-0000-0000000000d1', ''));
reset role;
select is((select j ->> 'resultado' from res where clave = 'l_5'), 'ok', 'CA-NL-4: el quinto pedido de la hora entra');
select ok(
  (select j ->> 'resultado' = 'limite' and (j ->> 'espera_segundos')::int between 1 and 3600 from res where clave = 'l_6'),
  'CA-NL-4: el sexto responde limite con la espera');
select is((select count(*)::int from dominio.newsletter_suscriptores where correo = 'l6@ejemplo.com'), 0, 'CA-NL-4: con el límite superado no se guarda nada');
select is((select j ->> 'resultado' from res where clave = 'l_repetida'), 'ok', 'una clave ya usada no gasta cupo ni se limita');
select is((select j ->> 'resultado' from res where clave = 'l_otro'), 'ok', 'CA-NL-4: otro visitante no se ve afectado');

-- Tope por dirección: 3 confirmaciones en 24 h (el 4.º pedido responde ok sin pedir otra).
select set_config('request.headers', '{"x-forwarded-for":"10.0.0.3"}', true);
set local role anon;
insert into res values
  ('t_1', publico.suscribirse_newsletter('nl-d.ejemplo.com', 'tope@ejemplo.com', true, '00000000-0000-0000-0000-0000000000e1', '')),
  ('t_2', publico.suscribirse_newsletter('nl-d.ejemplo.com', 'tope@ejemplo.com', true, '00000000-0000-0000-0000-0000000000e2', '')),
  ('t_3', publico.suscribirse_newsletter('nl-d.ejemplo.com', 'tope@ejemplo.com', true, '00000000-0000-0000-0000-0000000000e3', '')),
  ('t_4', publico.suscribirse_newsletter('nl-d.ejemplo.com', 'tope@ejemplo.com', true, '00000000-0000-0000-0000-0000000000e4', ''));
reset role;
select is((select confirmaciones_24h from dominio.newsletter_suscriptores where correo = 'tope@ejemplo.com'), 3, 'RF-NL-3: máximo 3 confirmaciones por dirección y 24 h');
select is((select j from res where clave = 't_4'), '{"resultado":"ok"}'::jsonb, 'el cuarto pedido responde ok (no enumera)');

-- ============================================================================
-- T003 · reclamo y cierre de confirmaciones
-- ============================================================================
create temp table lote1 as select * from private.reclamar_confirmaciones_newsletter(50, 900);
select ok((select count(*) > 0 from lote1), 'el reclamo devuelve confirmaciones por enviar');
select ok(
  (select bool_and(token ~ '^[0-9a-f]{64}$' and tienda <> '' and dominio <> '' and correo ~ '@') from lote1),
  'cada fila trae token de 64 hex, tienda, dominio y correo');
select is((select count(distinct token)::int from lote1), (select count(*)::int from lote1), 'cada confirmación recibe un token distinto');
select is(
  (select dominio from lote1 where correo = 'ana@ejemplo.com'), 'nl-a.ejemplo.com', 'el enlace usará el dominio público de la tienda');
select is(
  (select count(*)::int from dominio.newsletter_suscriptores where confirmacion_hash is not null and confirmacion_hash !~ '^[0-9a-f]{64}$'), 0,
  'solo se guarda el hash');
select is(
  (select count(*)::int from lote1 l join dominio.newsletter_suscriptores s on s.id = l.suscriptor_id where s.confirmacion_hash = l.token), 0,
  'el token en claro no se guarda');
select ok(
  (select bool_and(confirmacion_vence between now() + interval '47 hours 59 minutes' and now() + interval '48 hours 1 minute')
     from dominio.newsletter_suscriptores where id in (select suscriptor_id from lote1)),
  'RF-NL-4: la confirmación vence a las 48 h');
select is((select count(*)::int from private.reclamar_confirmaciones_newsletter(50, 900)), 0, 'con el reclamo vigente no se entrega dos veces');
select is(
  (select tienda from lote1 where correo = 'ana@ejemplo.com'), 'Tienda A', 'el nombre de la tienda viaja tal cual cuando no trae caracteres peligrosos');

-- Cierre: un fallo libera el reclamo y suma un intento; el éxito lo da por enviado (idempotente).
select private.cerrar_confirmacion_newsletter((select suscriptor_id from lote1 where correo = 'ana@ejemplo.com'), 'fallido', 'detalle del SMTP');
select is((select confirmacion_intentos from dominio.newsletter_suscriptores where correo = 'ana@ejemplo.com'), 1, 'un fallo suma un intento');
select is((select count(*)::int from private.reclamar_confirmaciones_newsletter(50, 900) where correo = 'ana@ejemplo.com'), 1, 'tras el fallo se reintenta en el próximo ciclo (token nuevo)');
select private.cerrar_confirmacion_newsletter((select id from dominio.newsletter_suscriptores where correo = 'ana@ejemplo.com'), 'enviado', null);
select private.cerrar_confirmacion_newsletter((select id from dominio.newsletter_suscriptores where correo = 'ana@ejemplo.com'), 'enviado', null);
select ok((select confirmacion_enviada_en is not null and confirmacion_intentos = 0 from dominio.newsletter_suscriptores where correo = 'ana@ejemplo.com'), 'cerrar como enviado es idempotente');
select is((select count(*)::int from private.reclamar_confirmaciones_newsletter(50, 900) where correo = 'ana@ejemplo.com'), 0, 'una confirmación enviada no se reclama de nuevo');
select throws_ok($$select private.cerrar_confirmacion_newsletter(gen_random_uuid(), 'otro', null)$$, '22023', null, 'resultado inválido');

-- Reintentos: tras 4 fallos del ciclo no se reclama más.
update dominio.newsletter_suscriptores set confirmacion_solicitada_en = now(), confirmacion_reclamada_hasta = null, confirmacion_intentos = 4 where correo = 'l3@ejemplo.com';
select is((select count(*)::int from private.reclamar_confirmaciones_newsletter(50, 900) where correo = 'l3@ejemplo.com'), 0, 'máximo 4 reintentos por pedido');

-- Confirmación (RF-NL-5).
create temp table tok as select l.suscriptor_id, l.token, l.correo, l.dominio from lote1 l;
grant all on tok to anon;
set local role anon;
insert into res values
  ('c_ok', publico.confirmar_newsletter('nl-a.ejemplo.com', (select token from tok where correo = 'l4@ejemplo.com'))),
  ('c_ok_otra_vez', publico.confirmar_newsletter('nl-a.ejemplo.com', (select token from tok where correo = 'l4@ejemplo.com'))),
  ('c_otra_tienda', publico.confirmar_newsletter('nl-d.ejemplo.com', (select token from tok where correo = 'l5@ejemplo.com'))),
  ('c_inventado', publico.confirmar_newsletter('nl-a.ejemplo.com', repeat('ab', 32))),
  ('c_forma', publico.confirmar_newsletter('nl-a.ejemplo.com', 'no-es-un-token')),
  ('c_nulo', publico.confirmar_newsletter('nl-a.ejemplo.com', null)),
  ('c_host', publico.confirmar_newsletter('no-existe.ejemplo.com', (select token from tok where correo = 'l5@ejemplo.com')));
reset role;
select is((select j from res where clave = 'c_ok'), '{"resultado":"ok"}'::jsonb, 'CA-NL-2 / RF-NL-5: el enlace vigente confirma');
select is((select estado from dominio.newsletter_suscriptores where correo = 'l4@ejemplo.com'), 'confirmado', 'queda confirmado con su fecha');
select ok((select confirmado_en is not null from dominio.newsletter_suscriptores where correo = 'l4@ejemplo.com'), 'se guarda confirmado_en');
select is((select j from res where clave = 'c_ok_otra_vez'), '{"resultado":"ok"}'::jsonb, 'CA-NL-5: un enlace ya usado responde ok');
select is((select estado from dominio.newsletter_suscriptores where correo = 'l5@ejemplo.com'), 'pendiente', 'el token de otra tienda no confirma');
select ok(
  (select j = '{"resultado":"invalido"}'::jsonb from res where clave = 'c_otra_tienda')
  and (select j = '{"resultado":"invalido"}'::jsonb from res where clave = 'c_inventado')
  and (select j = '{"resultado":"invalido"}'::jsonb from res where clave = 'c_forma')
  and (select j = '{"resultado":"invalido"}'::jsonb from res where clave = 'c_nulo')
  and (select j = '{"resultado":"invalido"}'::jsonb from res where clave = 'c_host'),
  'token de otra tienda, inventado, mal formado, nulo o host desconocido → invalido');

-- Vencido (CA-NL-5): se simula el paso de las 48 h.
update dominio.newsletter_suscriptores set confirmacion_vence = now() - interval '1 minute' where correo = 'l5@ejemplo.com';
set local role anon;
insert into res values ('c_vencido', publico.confirmar_newsletter('nl-a.ejemplo.com', (select token from tok where correo = 'l5@ejemplo.com')));
reset role;
select is((select j from res where clave = 'c_vencido'), '{"resultado":"vencido"}'::jsonb, 'CA-NL-5: el enlace vencido responde vencido');
select is((select estado from dominio.newsletter_suscriptores where correo = 'l5@ejemplo.com'), 'pendiente', 'un enlace vencido no confirma');

-- Baja y re-suscripción (CA-NL-2): una dirección en baja vuelve a pendiente con nuevo consentimiento y sin hash viejo.
update dominio.newsletter_suscriptores set estado = 'baja', baja_en = now() where correo = 'l4@ejemplo.com';
select set_config('request.headers', '{"x-forwarded-for":"10.0.0.4"}', true);
set local role anon;
insert into res values
  ('b_antes', publico.confirmar_newsletter('nl-a.ejemplo.com', (select token from tok where correo = 'l4@ejemplo.com'))),
  ('b_resus', publico.suscribirse_newsletter('nl-a.ejemplo.com', 'l4@ejemplo.com', true, '00000000-0000-0000-0000-0000000000f6', ''));
reset role;
select is((select j from res where clave = 'b_antes'), '{"resultado":"invalido"}'::jsonb, 'un enlace de confirmación no reactiva una baja');
select is((select j from res where clave = 'b_resus'), (select j from res where clave = 's_nuevo'), 'CA-NL-3: re-suscribirse tras una baja responde igual que una alta');
select ok(
  (select estado = 'pendiente' and baja_en is not null and confirmado_en is null and confirmacion_hash is null from dominio.newsletter_suscriptores where correo = 'l4@ejemplo.com'),
  'la baja vuelve a pendiente con nuevo consentimiento, sin token viejo y CONSERVANDO baja_en (lista de supresión)');

-- Poda (RF-NL-6): lo pendiente de más de 7 días se purga en el reclamo.
update dominio.newsletter_suscriptores set creado_en = now() - interval '8 days', confirmacion_solicitada_en = now() - interval '8 days' where correo = 'tope@ejemplo.com';
update dominio.newsletter_suscriptores set creado_en = now() - interval '8 days' where correo = 'ana@ejemplo.com';
select count(*) from private.reclamar_confirmaciones_newsletter(50, 900);
select is((select count(*)::int from dominio.newsletter_suscriptores where correo = 'tope@ejemplo.com'), 0, 'RF-NL-6: el pendiente de más de 7 días se purga');
select ok((select count(*) = 1 from dominio.newsletter_suscriptores where correo = 'ana@ejemplo.com'), 'un pendiente con pedido reciente se conserva');
update dominio.newsletter_suscriptores set confirmacion_solicitada_en = now() - interval '8 days' where correo = 'ana@ejemplo.com';
select count(*) from private.reclamar_confirmaciones_newsletter(50, 900);
select is((select count(*)::int from dominio.newsletter_suscriptores where correo = 'ana@ejemplo.com'), 0, 'se purga cuando también el último pedido tiene más de 7 días');

-- El nombre de la tienda sale sin comillas, `<`, `>` ni saltos de línea (encabezado From del correo).
update dominio.empresas set nombre = E'Mi "Tienda" <x>\\y\r\nBcc: a@b.c' where id = 'e1000000-0000-0000-0000-000000000004';
insert into dominio.newsletter_suscriptores (organizacion_id, empresa_id, correo, version_consentimiento, confirmacion_solicitada_en)
values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000004', 'saneo@ejemplo.com', 'newsletter-v1', now());
select is(
  (select tienda from private.reclamar_confirmaciones_newsletter(50, 900) where correo = 'saneo@ejemplo.com'),
  'Mi Tienda xyBcc: a@b.c', 'el nombre de la tienda se limpia de comillas, < >, backslash y saltos de línea');


-- ============================================================================
-- Revisión: lista blanca de caracteres del correo (un solo destinatario real por fila)
-- ============================================================================
select is(
  (select array_agg(c order by c) from unnest(array['a<victima@dom.com>', 'b<victima@dom.com>', 'a"b@dom.com', 'a(b)@dom.com', 'a\b@dom.com', 'a:b@dom.com', 'a b@dom.com', 'a@b', 'a@@b.co', 'a@b..co'])  c
     where private.validar_suscripcion_newsletter(c, true) = array['correo']),
  (select array_agg(c order by c) from unnest(array['a<victima@dom.com>', 'b<victima@dom.com>', 'a"b@dom.com', 'a(b)@dom.com', 'a\b@dom.com', 'a:b@dom.com', 'a b@dom.com', 'a@b', 'a@@b.co', 'a@b..co']) c),
  'el validador rechaza <, >, comillas, paréntesis, backslash, dos puntos y formas rotas');
select is(
  (select count(*)::int from unnest(array['ana@ejemplo.com', 'a.b+c@sub.dom-x.com', 'o''brien@ejemplo.com.ar']) c where private.validar_suscripcion_newsletter(c, true) = '{}'),
  3, 'el validador acepta direcciones habituales (también con + y apóstrofo)');
select throws_ok(
  $$insert into dominio.newsletter_suscriptores (organizacion_id, empresa_id, correo, version_consentimiento)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a<victima@dom.com>', 'v1')$$,
  '23514', null, 'el check de la tabla también rechaza a<victima@dom.com> (no se salta el tope por dirección)');
select set_config('request.headers', '{"x-forwarded-for":"10.1.0.1"}', true);
set local role anon;
insert into res values ('cr_mayus', publico.suscribirse_newsletter('nl-a.ejemplo.com', 'x<victima@dom.com>', true, '00000000-0000-0000-0000-0000000000aa', ''));
reset role;
select is((select j from res where clave = 'cr_mayus'), '{"resultado":"invalido","campos":["correo"]}'::jsonb, 'la suscripción pública rechaza x<victima@dom.com>');

-- ============================================================================
-- Revisión: carrera entre el cierre del flow y una re-suscripción
-- ============================================================================
insert into dominio.newsletter_suscriptores (id, organizacion_id, empresa_id, correo, version_consentimiento, confirmacion_solicitada_en) values
  ('51000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'carrera@ejemplo.com', 'newsletter-v1', now());
create temp table lote_c as select * from private.reclamar_confirmaciones_newsletter(50, 900) where correo = 'carrera@ejemplo.com';
select is((select count(*)::int from lote_c), 1, 'la carrera: el flow reclamó y generó el token A');
-- Re-suscribir una dirección pendiente con enlace vigente NO emite otro ni invalida el legítimo.
select set_config('request.headers', '{"x-forwarded-for":"10.1.0.2"}', true);
set local role anon;
insert into res values ('cr_vigente', publico.suscribirse_newsletter('nl-a.ejemplo.com', 'carrera@ejemplo.com', true, '00000000-0000-0000-0000-0000000000ab', ''));
reset role;
select is((select j from res where clave = 'cr_vigente'), '{"resultado":"ok"}'::jsonb, 'm2: re-suscribir con un enlace vigente responde igual');
select ok(
  (select confirmacion_hash = encode(sha256(convert_to((select token from lote_c), 'utf8')), 'hex') and confirmaciones_24h = 0 from dominio.newsletter_suscriptores where correo = 'carrera@ejemplo.com'),
  'm2: no se pisa el hash del pedido vigente ni se pide otra confirmación');
-- Pasa a baja y se re-suscribe antes del cierre: el cierre tardío no puede dar por enviado el pedido nuevo.
update dominio.newsletter_suscriptores set estado = 'baja', baja_en = now() where correo = 'carrera@ejemplo.com';
select set_config('request.headers', '{"x-forwarded-for":"10.1.0.3"}', true);
set local role anon;
insert into res values ('cr_resus', publico.suscribirse_newsletter('nl-a.ejemplo.com', 'carrera@ejemplo.com', true, '00000000-0000-0000-0000-0000000000ac', ''));
reset role;
select private.cerrar_confirmacion_newsletter('51000000-0000-0000-0000-000000000001', 'enviado', null);
select ok(
  (select confirmacion_enviada_en is null and confirmacion_hash is null and baja_en is not null from dominio.newsletter_suscriptores where correo = 'carrera@ejemplo.com'),
  'el cierre tardío (hash anulado por la re-suscripción) no marca como enviado ni pisa baja_en');
select is((select count(*)::int from private.reclamar_confirmaciones_newsletter(50, 900) where correo = 'carrera@ejemplo.com'), 1, 'el pedido nuevo sigue por enviar (no queda enlace muerto)');
select private.cerrar_confirmacion_newsletter('51000000-0000-0000-0000-000000000001', 'fallido', null);
select is((select confirmacion_intentos from dominio.newsletter_suscriptores where correo = 'carrera@ejemplo.com'), 1, 'el cierre fallido sobre un pedido con hash sí cuenta el intento');

-- baja_en se conserva al confirmar de nuevo solo después de confirmar; y la poda devuelve a baja (no borra la supresión).
update dominio.newsletter_suscriptores set creado_en = now() - interval '9 days', confirmacion_solicitada_en = now() - interval '8 days', confirmacion_reclamada_hasta = null where correo = 'carrera@ejemplo.com';
select count(*) from private.reclamar_confirmaciones_newsletter(50, 900);
select is((select estado from dominio.newsletter_suscriptores where correo = 'carrera@ejemplo.com'), 'baja', 'm2: la poda de un pendiente que venía de una baja lo devuelve a baja (no pierde la lista de supresión)');

-- ============================================================================
-- Revisión: ya confirmada, ventana de 24 h y token en mayúsculas
-- ============================================================================
insert into dominio.newsletter_suscriptores (id, organizacion_id, empresa_id, correo, estado, version_consentimiento, confirmado_en, confirmacion_hash, confirmacion_vence) values
  ('51000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'confirmada@ejemplo.com', 'confirmado', 'newsletter-v1', now(), repeat('e', 64), now() + interval '1 day'),
  ('51000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ventana@ejemplo.com', 'pendiente', 'newsletter-v1', null, null, null);
update dominio.newsletter_suscriptores set confirmaciones_24h = 3, confirmaciones_desde = now() - interval '25 hours', confirmacion_solicitada_en = now() - interval '25 hours', confirmacion_enviada_en = now() - interval '25 hours' where correo = 'ventana@ejemplo.com';
select set_config('request.headers', '{"x-forwarded-for":"10.1.0.4"}', true);
set local role anon;
insert into res values
  ('v_conf', publico.suscribirse_newsletter('nl-a.ejemplo.com', 'confirmada@ejemplo.com', true, '00000000-0000-0000-0000-0000000000ad', '')),
  ('v_vent', publico.suscribirse_newsletter('nl-a.ejemplo.com', 'ventana@ejemplo.com', true, '00000000-0000-0000-0000-0000000000ae', '')),
  ('v_mayus', publico.confirmar_newsletter('nl-a.ejemplo.com', upper(repeat('e', 64))));
reset role;
select ok(
  (select confirmacion_solicitada_en is null and estado = 'confirmado' and confirmaciones_24h = 0 from dominio.newsletter_suscriptores where correo = 'confirmada@ejemplo.com'),
  'una dirección ya confirmada no pide otra confirmación (no se manda otro correo)');
select ok(
  (select confirmaciones_24h = 1 and confirmaciones_desde > now() - interval '1 minute' and confirmacion_solicitada_en > now() - interval '1 minute' from dominio.newsletter_suscriptores where correo = 'ventana@ejemplo.com'),
  'la ventana de 24 h se reinicia: pasadas 24 h el contador vuelve a 1 y se pide la confirmación');
select is((select j from res where clave = 'v_mayus'), '{"resultado":"invalido"}'::jsonb, 'un token en mayúsculas es inválido');

-- ============================================================================
-- Revisión: el reclamo respeta el interruptor y la tienda activa aun con la bandera encendida
-- ============================================================================
insert into dominio.newsletter_suscriptores (organizacion_id, empresa_id, correo, version_consentimiento, confirmacion_solicitada_en) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'sininterruptor@ejemplo.com', 'newsletter-v1', now()),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000003', 'inactiva@ejemplo.com', 'newsletter-v1', now());
select is(
  (select count(*)::int from private.reclamar_confirmaciones_newsletter(50, 900) where correo in ('sininterruptor@ejemplo.com', 'inactiva@ejemplo.com')),
  0, 'con la bandera encendida: sin interruptor de la tienda o con la empresa inactiva no se reclama nada');
update dominio.newsletter_configuracion set activo = false where empresa_id = 'e1000000-0000-0000-0000-000000000004';
insert into dominio.newsletter_suscriptores (organizacion_id, empresa_id, correo, version_consentimiento, confirmacion_solicitada_en) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000004', 'interruptor-off@ejemplo.com', 'newsletter-v1', now());
select is((select count(*)::int from private.reclamar_confirmaciones_newsletter(50, 900) where correo = 'interruptor-off@ejemplo.com'), 0, 'un interruptor existente pero apagado tampoco entrega');


-- ============================================================================
-- Revisión 2: forma estricta del correo (local atom(.atom)*, dominio con etiquetas y TLD de letras, local ≤ 64)
-- ============================================================================
select is(
  (select coalesce(string_agg(c, ' | ' order by c), '') from unnest(array[
      'a..b@x.com', '.a@x.com', 'a.@x.com', 'a@1.2.3.4', 'a@-.-', 'a%b@x.com', 'a!b@x.com', 'a|b@x.com', 'a/b@x.com',
      'a@x.c', 'a@-x.com', 'a@x-.com', 'a@x..com', 'a@.com', 'a@x.com.', 'a@x_y.com', repeat('a', 65) || '@x.com', 'a@b@x.com']) c
    where private.validar_suscripcion_newsletter(c, true) = '{}'),
  '', 'el validador rechaza puntos dobles/iniciales/finales, IP, etiquetas rotas, %, !, |, / y locales de más de 64');
select is(
  (select count(*)::int from unnest(array['a.b+c@sub.dom-x.com', 'o''brien@x.com', 'x@xn--ejemplo-9ua.com', repeat('a', 64) || '@x.com', 'a_b=c@d1.ar']) c
    where private.validar_suscripcion_newsletter(c, true) = '{}'),
  5, 'el validador acepta direcciones habituales, punycode y un local de 64');
select is(
  (select count(*)::int from unnest(array['a..b@x.com', '.a@x.com', 'a.@x.com', 'a@1.2.3.4', 'a@-.-', 'a%b@x.com', 'a!b@x.com', 'a|b@x.com', 'a/b@x.com', repeat('a', 65) || '@x.com']) c
    where not exists (select 1 where c ~ '^[a-z0-9''+_=&*#$?^{}~-]+(\.[a-z0-9''+_=&*#$?^{}~-]+)*@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$' and char_length(split_part(c, '@', 1)) <= 64)),
  10, 'la forma estricta rechaza todos los casos laxos (referencia independiente)');
select throws_ok($$insert into dominio.newsletter_suscriptores (organizacion_id, empresa_id, correo, version_consentimiento)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a..b@x.com', 'v1')$$, '23514', null, 'el check de la tabla rechaza a..b@x.com');
select throws_ok($$insert into dominio.newsletter_suscriptores (organizacion_id, empresa_id, correo, version_consentimiento)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a@1.2.3.4', 'v1')$$, '23514', null, 'el check de la tabla rechaza a@1.2.3.4');
select throws_ok($$insert into dominio.newsletter_suscriptores (organizacion_id, empresa_id, correo, version_consentimiento)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a%b@x.com', 'v1')$$, '23514', null, 'el check de la tabla rechaza a%b@x.com (ruta fuente legada)');
select throws_ok($$insert into dominio.newsletter_suscriptores (organizacion_id, empresa_id, correo, version_consentimiento)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', repeat('a', 65) || '@x.com', 'v1')$$, '23514', null, 'el check de la tabla rechaza un local de más de 64');
select lives_ok($$insert into dominio.newsletter_suscriptores (organizacion_id, empresa_id, correo, version_consentimiento)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'x@xn--ejemplo-9ua.com', 'v1')$$, 'el check de la tabla acepta punycode');

-- ============================================================================
-- Revisión 2: tras el 4.º fallo de envío se anula el enlace que nunca salió
-- ============================================================================
insert into dominio.newsletter_suscriptores (id, organizacion_id, empresa_id, correo, version_consentimiento, confirmacion_solicitada_en, confirmacion_hash, confirmacion_vence, confirmacion_intentos) values
  ('51000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'fallos3@ejemplo.com', 'newsletter-v1', now(), repeat('f', 64), now() + interval '48 hours', 3),
  ('51000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'fallos1@ejemplo.com', 'newsletter-v1', now(), repeat('1', 64), now() + interval '48 hours', 1);
select private.cerrar_confirmacion_newsletter('51000000-0000-0000-0000-000000000010', 'fallido', null);
select private.cerrar_confirmacion_newsletter('51000000-0000-0000-0000-000000000011', 'fallido', null);
select ok(
  (select confirmacion_hash is null and confirmacion_vence is null and confirmacion_intentos = 4 from dominio.newsletter_suscriptores where correo = 'fallos3@ejemplo.com'),
  'agotados los 4 ciclos el hash y su vencimiento se anulan (se puede pedir otro enlace)');
select ok(
  (select confirmacion_hash = repeat('1', 64) and confirmacion_vence is not null and confirmacion_intentos = 2 from dominio.newsletter_suscriptores where correo = 'fallos1@ejemplo.com'),
  'un fallo temprano conserva el enlace');
select set_config('request.headers', '{"x-forwarded-for":"10.1.0.5"}', true);
set local role anon;
insert into res values ('f_reintento', publico.suscribirse_newsletter('nl-a.ejemplo.com', 'fallos3@ejemplo.com', true, '00000000-0000-0000-0000-0000000000af', ''));
reset role;
select ok(
  (select confirmacion_intentos = 0 and confirmacion_solicitada_en > now() - interval '1 minute' from dominio.newsletter_suscriptores where correo = 'fallos3@ejemplo.com'),
  'la persona legítima puede volver a pedir el enlace tras agotar los reintentos');

-- ============================================================================
-- Revisión 2: tope global por tienda (alias de proveedor: +tag, puntos de Gmail, catch-all)
-- ============================================================================
select is(private.tope_confirmaciones_hora_newsletter(), 200, 'el tope global es de 200 confirmaciones nuevas por hora y tienda');
insert into dominio.newsletter_suscriptores (organizacion_id, empresa_id, correo, version_consentimiento, confirmacion_solicitada_en)
select '22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'alias+' || g || '@ejemplo.com', 'newsletter-v1', now()
  from generate_series(1, 199) g;
select set_config('request.headers', '{"x-forwarded-for":"10.1.0.6"}', true);
set local role anon;
insert into res values
  ('g_200', publico.suscribirse_newsletter('nl-dos.ejemplo.com', 'ultimo@ejemplo.com', true, '00000000-0000-0000-0000-0000000000b1', '')),
  ('g_201', publico.suscribirse_newsletter('nl-dos.ejemplo.com', 'excedido@ejemplo.com', true, '00000000-0000-0000-0000-0000000000b2', ''));
reset role;
select is((select count(*)::int from dominio.newsletter_suscriptores where correo = 'ultimo@ejemplo.com'), 1, 'hasta el tope la suscripción se guarda');
select is((select count(*)::int from dominio.newsletter_suscriptores where correo = 'excedido@ejemplo.com'), 0, 'superado el tope global de la tienda no se guarda ni se envía');
select is((select j from res where clave = 'g_201'), (select j from res where clave = 'g_200'), 'la respuesta del exceso es idéntica (ok): sin enumeración ni señal de tope');


-- ============================================================================
-- Revisión 3
-- ============================================================================
-- Un cierre FALLIDO tardío sobre una fila ya reiniciada (sin hash) no suma intento.
insert into dominio.newsletter_suscriptores (id, organizacion_id, empresa_id, correo, version_consentimiento, confirmacion_solicitada_en, confirmacion_intentos) values
  ('51000000-0000-0000-0000-000000000020', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'tardio@ejemplo.com', 'newsletter-v1', now(), 0);
select private.cerrar_confirmacion_newsletter('51000000-0000-0000-0000-000000000020', 'fallido', null);
select is((select confirmacion_intentos from dominio.newsletter_suscriptores where correo = 'tardio@ejemplo.com'), 0, 'un cierre fallido tardío (hash nulo) no suma intento');

-- Secuencia reclamar -> re-suscribir -> cerrar: el hash reclamado sobrevive y el cierre lo da por enviado.
insert into dominio.newsletter_suscriptores (id, organizacion_id, empresa_id, correo, version_consentimiento, confirmacion_solicitada_en) values
  ('51000000-0000-0000-0000-000000000021', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'secuencia@ejemplo.com', 'newsletter-v1', now());
create temp table lote_s as select * from private.reclamar_confirmaciones_newsletter(200, 900) where correo = 'secuencia@ejemplo.com';
select set_config('request.headers', '{"x-forwarded-for":"10.1.0.7"}', true);
set local role anon;
insert into res values ('s_resus', publico.suscribirse_newsletter('nl-a.ejemplo.com', 'secuencia@ejemplo.com', true, '00000000-0000-0000-0000-0000000000b3', ''));
reset role;
select private.cerrar_confirmacion_newsletter('51000000-0000-0000-0000-000000000021', 'enviado', null);
select ok(
  (select confirmacion_hash = encode(sha256(convert_to((select token from lote_s), 'utf8')), 'hex') and confirmacion_enviada_en is not null from dominio.newsletter_suscriptores where correo = 'secuencia@ejemplo.com'),
  'reclamar → re-suscribir → cerrar: la re-suscripción no anuló el hash reclamado y el correo con ese enlace queda enviado');
create temp table fuente_susc as
  select regexp_replace(prosrc, '--[^\n]*', '', 'g') as c
    from pg_proc where pronamespace = 'publico'::regnamespace and proname = 'suscribirse_newsletter';
select ok(
  (select c ~ 'lower\(s\.correo\)\s*=\s*v_correo\s+for update;' from fuente_susc),
  'suscribirse lee la fila de la dirección con for update (en el SQL real, no en un comentario)');
select ok(
  (select strpos(c, 'registrar_envio_tienda') > 0
      and strpos(c, 'registrar_envio_tienda') < strpos(c, 'pg_advisory_xact_lock(hashtextextended(v_empresa::text || ''|'' || v_correo')
      and strpos(c, 'pg_advisory_xact_lock(hashtextextended(v_empresa::text || ''|'' || v_correo') < strpos(c, 'for update;')
      and strpos(c, 'for update;') < strpos(c, 'pg_advisory_xact_lock(hashtextextended(''newsletter_tope|''')
      and strpos(c, 'pg_advisory_xact_lock(hashtextextended(''newsletter_tope|''') < strpos(c, 'count(*)')
      and strpos(c, 'count(*)') < strpos(c, 'insert into dominio.newsletter_suscriptores')
   from fuente_susc),
  'orden de los bloqueos: registrar cupo → lock por dirección → fila for update → lock por tienda → count del tope → alta');

-- unicode directo y TLD punycode se rechazan; el dominio IDN con etiquetas xn-- pasa.
select is(
  (select coalesce(string_agg(c, ' | '), '') from unnest(array[E'ñandú@x.com', E'user@bücher.de', 'a@b.xn--p1ai']) c where private.validar_suscripcion_newsletter(c, true) = '{}'),
  '', 'el unicode directo y un TLD punycode se rechazan');
select is(private.validar_suscripcion_newsletter('a@xn--bcher-kva.de', true), '{}'::text[], 'un dominio IDN con etiquetas xn-- pasa');
select throws_ok($$insert into dominio.newsletter_suscriptores (organizacion_id, empresa_id, correo, version_consentimiento)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', E'user@bücher.de', 'v1')$$, '23514', null, 'el check de la tabla rechaza el unicode directo');

select * from finish();
rollback;
