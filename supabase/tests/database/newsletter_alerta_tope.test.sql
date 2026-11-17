-- MSF-971 (seguimiento de la épica MSF-468, newsletter de la tienda): al alcanzar el tope global de confirmaciones nuevas por hora de una
-- tienda, la alta legítima que se descarta deja un evento de Actividad `newsletter.tope_confirmaciones` (no sensible, sin datos personales),
-- a lo sumo uno por hora y tienda, y la respuesta hacia afuera NO cambia (`ok` idéntico, sin señal de tope).
-- Cubre: catálogo del tipo, permisos de la función interna, alta hasta el tope (sin alerta), primer descarte (alerta), descartes siguientes (sin
-- segunda alerta), reenvío de una dirección existente descartado por el tope (alerta de OTRA tienda), ventana de una hora, otra tienda sin tope.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda con tope', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda sin tope', true),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Tienda con reenvío', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'nl-tope-1.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'nl-tope-2.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000003', 'nl-tope-3.ejemplo.com');
insert into dominio.newsletter_configuracion (empresa_id, organizacion_id, activo) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', true),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', true);
update public.banderas_plataforma set activa = true where clave = 'newsletter';

create temp table res (clave text primary key, j jsonb);
grant all on res to anon;

-- ============================================================================
-- Catálogo y permisos
-- ============================================================================
select is((select sensible from public.tipos_evento_actividad where tipo = 'newsletter.tope_confirmaciones'), false,
  'el tipo newsletter.tope_confirmaciones está en el catálogo y no es sensible');
select ok(
  not has_function_privilege('anon', 'private.alertar_tope_confirmaciones_newsletter(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.alertar_tope_confirmaciones_newsletter(uuid, uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.alertar_tope_confirmaciones_newsletter(uuid, uuid)', 'execute')
  and not has_function_privilege('public', 'private.alertar_tope_confirmaciones_newsletter(uuid, uuid)', 'execute'),
  'la función interna de la alerta no es ejecutable por la API');
select ok(
  has_function_privilege('anon', 'publico.suscribirse_newsletter(text, text, boolean, uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'publico.suscribirse_newsletter(text, text, boolean, uuid, text)', 'execute')
  and not has_function_privilege('public', 'publico.suscribirse_newsletter(text, text, boolean, uuid, text)', 'execute'),
  'suscribirse_newsletter conserva sus permisos (anon y authenticated, no public)');

-- ============================================================================
-- Tienda 1: 199 confirmaciones en la última hora, el tope es de 200
-- ============================================================================
insert into dominio.newsletter_suscriptores (organizacion_id, empresa_id, correo, version_consentimiento, confirmacion_solicitada_en)
select '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'alias+' || g || '@ejemplo.com', 'newsletter-v1', now()
  from generate_series(1, 199) g;
-- Tienda 3: 200 confirmaciones (tope lleno) y un evento de alerta de hace dos horas (fuera de la ventana de una hora).
insert into dominio.newsletter_suscriptores (organizacion_id, empresa_id, correo, version_consentimiento, confirmacion_solicitada_en)
select '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000003', 'alias+' || g || '@ejemplo.com', 'newsletter-v1', now()
  from generate_series(1, 200) g;
insert into public.registro_actividad (organizacion_id, empresa_id, tipo, detalle, creado_en) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000003', 'newsletter.tope_confirmaciones', 'Alerta vieja', now() - interval '2 hours');

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
select set_config('request.headers', '{"x-forwarded-for":"10.7.0.1"}', true);
set local role anon;
insert into res values
  ('t1_ultimo', publico.suscribirse_newsletter('nl-tope-1.ejemplo.com', 'ultimo@ejemplo.com', true, '00000000-0000-0000-0000-0000000000a1', ''));
reset role;
select is((select count(*)::int from dominio.newsletter_suscriptores where correo = 'ultimo@ejemplo.com'), 1, 'la alta número 200 se guarda');
select is((select count(*)::int from public.registro_actividad where tipo = 'newsletter.tope_confirmaciones' and empresa_id = 'e1000000-0000-0000-0000-000000000001'), 0,
  'hasta el tope no hay alerta');

select set_config('request.headers', '{"x-forwarded-for":"10.7.0.2"}', true);
set local role anon;
insert into res values
  ('t1_excedido', publico.suscribirse_newsletter('nl-tope-1.ejemplo.com', 'excedido@ejemplo.com', true, '00000000-0000-0000-0000-0000000000a2', ''));
reset role;
select is((select count(*)::int from dominio.newsletter_suscriptores where correo = 'excedido@ejemplo.com'), 0, 'superado el tope no se guarda ni se envía');
select is((select j from res where clave = 't1_excedido'), (select j from res where clave = 't1_ultimo'),
  'la respuesta del descarte es idéntica a la de una alta normal: sin señal de tope hacia afuera');
select is((select count(*)::int from public.registro_actividad where tipo = 'newsletter.tope_confirmaciones' and empresa_id = 'e1000000-0000-0000-0000-000000000001'), 1,
  'el primer descarte por el tope deja UN evento de Actividad de esa tienda');
select is(
  (select jsonb_build_object('org', organizacion_id, 'actor', actor_id) from public.registro_actividad
    where tipo = 'newsletter.tope_confirmaciones' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  '{"org": "11111111-1111-1111-1111-111111111111", "actor": null}'::jsonb, 'el evento es de la organización de la tienda y sin actor (lo dispara una persona anónima)');
select ok(
  (select detalle !~* '(@|ejemplo|excedido|ultimo|10\.7|[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)' from public.registro_actividad
    where tipo = 'newsletter.tope_confirmaciones' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  'el detalle del evento no lleva direcciones de correo ni IP');

-- Más descartes en la misma hora: ningún evento nuevo.
select set_config('request.headers', '{"x-forwarded-for":"10.7.0.3"}', true);
set local role anon;
insert into res values
  ('t1_excedido_2', publico.suscribirse_newsletter('nl-tope-1.ejemplo.com', 'otro.excedido@ejemplo.com', true, '00000000-0000-0000-0000-0000000000a3', '')),
  ('t1_excedido_3', publico.suscribirse_newsletter('nl-tope-1.ejemplo.com', 'tercero.excedido@ejemplo.com', true, '00000000-0000-0000-0000-0000000000a4', ''));
reset role;
select is((select count(*)::int from public.registro_actividad where tipo = 'newsletter.tope_confirmaciones' and empresa_id = 'e1000000-0000-0000-0000-000000000001'), 1,
  'a lo sumo un evento por hora y tienda: los descartes siguientes no suman otro');
select is((select count(distinct j)::int from res where clave like 't1\_%'), 1, 'todas las respuestas (alta y descartes) son la misma');

-- ============================================================================
-- Tienda 2: sin tope alcanzado, sin alerta
-- ============================================================================
select set_config('request.headers', '{"x-forwarded-for":"10.7.0.4"}', true);
set local role anon;
insert into res values
  ('t2_alta', publico.suscribirse_newsletter('nl-tope-2.ejemplo.com', 'normal@ejemplo.com', true, '00000000-0000-0000-0000-0000000000b1', ''));
reset role;
select is((select count(*)::int from dominio.newsletter_suscriptores where correo = 'normal@ejemplo.com'), 1, 'una tienda sin tope lleno guarda la alta');
select is((select count(*)::int from public.registro_actividad where tipo = 'newsletter.tope_confirmaciones' and empresa_id = 'e1000000-0000-0000-0000-000000000002'), 0,
  'una tienda sin tope alcanzado no genera alerta');

-- ============================================================================
-- Tienda 3: el reenvío de una dirección existente también se descarta por el tope (y la alerta vieja no cuenta)
-- ============================================================================
select set_config('request.headers', '{"x-forwarded-for":"10.7.0.5"}', true);
set local role anon;
insert into res values
  ('t3_reenvio', publico.suscribirse_newsletter('nl-tope-3.ejemplo.com', 'alias+1@ejemplo.com', true, '00000000-0000-0000-0000-0000000000c1', ''));
reset role;
select is((select j from res where clave = 't3_reenvio'), '{"resultado":"ok"}'::jsonb, 'el reenvío descartado por el tope también responde ok');
select is((select count(*)::int from public.registro_actividad where tipo = 'newsletter.tope_confirmaciones' and empresa_id = 'e1000000-0000-0000-0000-000000000003'
             and creado_en > now() - interval '1 hour'), 1,
  'el reenvío descartado deja su alerta (la de hace dos horas queda fuera de la ventana)');
select is((select count(*)::int from public.registro_actividad where tipo = 'newsletter.tope_confirmaciones' and empresa_id = 'e1000000-0000-0000-0000-000000000003'), 2,
  'la alerta vieja se conserva (el registro es inalterable)');
select is((select count(*)::int from public.registro_actividad where tipo = 'newsletter.tope_confirmaciones'), 3, 'en total: una alerta por tienda con tope y la vieja');

select * from finish();
rollback;
