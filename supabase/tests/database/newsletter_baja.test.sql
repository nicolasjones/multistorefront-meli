-- Newsletter de la tienda, Fase 3 (T013, T018b): baja por el circuito del correo masivo (RF-NL-7, RF-NL-8, CA-NL-2, CA-NL-6).
begin;

select no_plan();

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true);
insert into dominio.newsletter_suscriptores (id, organizacion_id, empresa_id, correo, estado, version_consentimiento, confirmado_en, baja_en) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'uno@ejemplo.com', 'confirmado', 'v1', now(), null),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'dos@ejemplo.com', 'confirmado', 'v1', now(), null),
  -- Estaba en baja y un tercero la dejó `pendiente`: conserva baja_en (MSF-967).
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'tres@ejemplo.com', 'pendiente', 'v1', null, now() - interval '9 days');
insert into dominio.campanas_correo (id, organizacion_id, empresa_id, clave, asunto, mensaje, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', gen_random_uuid(), 'Novedades', 'Hola', 'newsletter'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', gen_random_uuid(), 'Más novedades', 'Hola otra vez', 'newsletter');
insert into dominio.campana_correo_destinatarios (id, organizacion_id, campana_id, suscriptor_id, correo, estado, token_hashes) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'uno@ejemplo.com', 'enviado', array[encode(sha256('token-uno'::bytea), 'hex')]),
  ('d1000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'uno@ejemplo.com', 'pendiente', '{}'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'dos@ejemplo.com', 'enviado', array[encode(sha256('token-dos'::bytea), 'hex')]),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', 'tres@ejemplo.com', 'enviado', array[encode(sha256('token-tres'::bytea), 'hex')]);

select is((select tipo from dominio.campanas_correo where id = 'c1000000-0000-0000-0000-000000000001'), 'newsletter', 'la campaña admite tipo newsletter');
select throws_ok($$insert into dominio.campanas_correo (organizacion_id, clave, asunto, mensaje, tipo) values ('11111111-1111-1111-1111-111111111111', gen_random_uuid(), 'x', 'x', 'otro')$$, '23514', null, 'el tipo solo admite clientes o newsletter');
select throws_ok($$insert into dominio.campana_correo_destinatarios (organizacion_id, campana_id, cliente_id, suscriptor_id, correo) values ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', gen_random_uuid(), 'a1000000-0000-0000-0000-000000000001', 'x@ejemplo.com')$$, '23514', null, 'un destinatario no es cliente y suscriptor a la vez');
select throws_ok($$insert into dominio.campana_correo_destinatarios (organizacion_id, campana_id, suscriptor_id, correo) values ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'uno@ejemplo.com')$$, '23505', null, 'un suscriptor no entra dos veces en la misma campaña');

-- Baja: hash inválido, desconocido o correcto.
select is(public.dar_de_baja_correo_masivo('no-es-un-hash'), false, 'un hash con forma inválida responde false');
select is(public.dar_de_baja_correo_masivo(encode(sha256('desconocido'::bytea), 'hex')), false, 'un hash desconocido responde false');
select is((select count(*)::int from dominio.newsletter_suscriptores where estado = 'baja'), 0, 'ninguna baja inválida da de baja a nadie');

select is(public.dar_de_baja_correo_masivo(encode(sha256('token-uno'::bytea), 'hex')), true, 'RF-NL-8: el enlace de un suscriptor lo da de baja');
select is((select estado from dominio.newsletter_suscriptores where id = 'a1000000-0000-0000-0000-000000000001'), 'baja', 'queda en baja');
select isnt((select baja_en from dominio.newsletter_suscriptores where id = 'a1000000-0000-0000-0000-000000000001'), null, 'con baja_en');
select is((select estado from dominio.campana_correo_destinatarios where id = 'd1000000-0000-0000-0000-000000000011'), 'omitido', 'CA-NL-2: lo pendiente de otro envío queda omitido');
select is((select estado from dominio.campana_correo_destinatarios where id = 'd1000000-0000-0000-0000-000000000001'), 'enviado', 'lo ya enviado no se toca');
select isnt((select baja_en from dominio.campana_correo_destinatarios where id = 'd1000000-0000-0000-0000-000000000001'), null, 'la baja se atribuye a la campaña del enlace');
select is((select estado from dominio.newsletter_suscriptores where id = 'a1000000-0000-0000-0000-000000000002'), 'confirmado', 'otra persona no se ve afectada');

select is(public.dar_de_baja_correo_masivo(encode(sha256('token-uno'::bytea), 'hex')), true, 'CA-NL-6: la baja repetida responde igual');
select is((select count(*)::int from public.registro_actividad where tipo = 'newsletter.baja'), 1, 'RF-NL-8: el evento se registra una sola vez');
select is((select count(*)::int from public.registro_actividad where tipo = 'newsletter.baja' and detalle ilike '%@%'), 0, 'el evento no lleva el correo');

-- Un pendiente con baja_en (re-suscripción de un tercero) también pasa a baja con un enlace viejo, y no es destinatario (T018b).
select is(public.dar_de_baja_correo_masivo(encode(sha256('token-tres'::bytea), 'hex')), true, 'un enlace viejo da de baja a un pendiente');
select is((select estado from dominio.newsletter_suscriptores where id = 'a1000000-0000-0000-0000-000000000003'), 'baja', 'queda en baja');
select is((select count(*)::int from dominio.newsletter_suscriptores where estado = 'confirmado' and baja_en is not null), 0, 'T018b: ningún confirmado conserva baja_en');

-- Borrar datos conserva el historial sin el correo.
select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'service_role')::text, true);
reset role;
select is(has_function_privilege('anon', 'public.dar_de_baja_correo_masivo(text)', 'execute'), false, 'anon no ejecuta la baja');
select is(has_function_privilege('authenticated', 'public.dar_de_baja_correo_masivo(text)', 'execute'), false, 'authenticated no ejecuta la baja');
select is(has_function_privilege('service_role', 'public.dar_de_baja_correo_masivo(text)', 'execute'), true, 'service_role sí');

select * from finish();
rollback;
