-- Newsletter de la tienda, Fase 5 (T025, T029): enviar, cancelar y listar (RF-NL-17, RF-NL-18, RF-NL-19, CA-NL-2, CA-NL-7,
-- CA-NL-8, CA-NL-10, CA-NL-12, SC-001, SC-003).
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'lector@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Tienda vacía', true),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'nlenv-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'nlenv-b.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000003', 'nlenv-c.ejemplo.com');
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');
insert into usuario_empresa_activa (user_id, empresa_id) values ('d1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001');
-- Tiendas A y C activas; B sin interruptor.
insert into dominio.newsletter_configuracion (empresa_id, organizacion_id, activo) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', true),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', true);
insert into dominio.newsletter_suscriptores (id, organizacion_id, empresa_id, correo, estado, version_consentimiento, baja_en, creado_en) values
  ('51000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ana@ejemplo.com', 'confirmado', 'v1', null, now() - interval '5 hours'),
  ('51000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'beto@ejemplo.com', 'confirmado', 'v1', null, now() - interval '4 hours'),
  ('51000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'caro@ejemplo.com', 'confirmado', 'v1', null, now() - interval '3 hours'),
  ('51000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'pend@ejemplo.com', 'pendiente', 'v1', null, now()),
  -- Estaba en baja y un tercero la dejó `pendiente`: conserva baja_en y NO es destinatario (MSF-967).
  ('51000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'vuelta@ejemplo.com', 'pendiente', 'v1', now() - interval '9 days', now()),
  ('51000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'baja@ejemplo.com', 'baja', 'v1', now(), now()),
  ('51000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'otra@ejemplo.com', 'confirmado', 'v1', null, now());
insert into dominio.newsletters (id, organizacion_id, empresa_id, nombre_interno, asunto, mensaje, incluir_destacados, incluir_promociones) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'Marzo', 'Novedades de marzo', 'Hola a todos', false, false),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'Tienda B', 'Novedades B', 'Hola B', false, false),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000003', 'Vacía', 'Novedades C', 'Hola C', false, false),
  ('b1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'Segundo', 'Segundo envío', 'Hola otra vez', false, false);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table res (clave text primary key, j jsonb);
grant all on res to authenticated;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok($$select public.enviar_newsletter('b1000000-0000-0000-0000-000000000001', 1, 'aaaaaaaa-0000-0000-0000-000000000001')$$, '55000', null, 'RF-NL-25: con la bandera apagada no se envía (55000)');
reset role;
update public.banderas_plataforma set activa = true where clave = 'newsletter';
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select throws_ok($$select public.enviar_newsletter('b1000000-0000-0000-0000-000000000002', 1, 'aaaaaaaa-0000-0000-0000-000000000002')$$, '22023', null, 'una tienda con el interruptor apagado no envía');
select throws_ok($$select public.enviar_newsletter('b1000000-0000-0000-0000-000000000003', 1, 'aaaaaaaa-0000-0000-0000-000000000003')$$, '22023', null, 'RF-NL-17: sin suscriptores confirmados responde 22023');
select is((select count(*)::int from dominio.campanas_correo where tipo = 'newsletter'), 0, 'sin destinatarios no se crea nada');
select is((select enviada_en from dominio.newsletters where id = 'b1000000-0000-0000-0000-000000000003'), null, 'el newsletter sigue como borrador');
select throws_ok($$select public.enviar_newsletter('b1000000-0000-0000-0000-000000000001', 7, 'aaaaaaaa-0000-0000-0000-000000000001')$$, '40001', null, 'una versión vieja responde 40001');
select throws_ok($$select public.enviar_newsletter('b1000000-0000-0000-0000-000000000001', 1, null)$$, '22023', null, 'la clave es obligatoria');
select throws_ok($$select public.enviar_newsletter('99999999-9999-9999-9999-999999999999', 1, 'aaaaaaaa-0000-0000-0000-000000000009')$$, 'P0002', null, 'un newsletter inexistente = P0002');

insert into res select 'envio', public.enviar_newsletter('b1000000-0000-0000-0000-000000000001', 1, 'aaaaaaaa-0000-0000-0000-000000000001');
select is((select j ->> 'destinatarios' from res where clave = 'envio'), '3', 'CA-NL-10: «Enviar a N» con N = confirmados de esa tienda');
insert into res select 'repetido', public.enviar_newsletter('b1000000-0000-0000-0000-000000000001', 1, 'aaaaaaaa-0000-0000-0000-000000000001');
select is((select j from res where clave = 'repetido'), (select j from res where clave = 'envio'), 'RF-NL-17: el doble clic (misma clave) devuelve la misma campaña');
select is((select count(*)::int from dominio.campanas_correo where tipo = 'newsletter'), 1, 'una sola campaña');
select throws_ok($$select public.enviar_newsletter('b1000000-0000-0000-0000-000000000001', 2, 'aaaaaaaa-0000-0000-0000-000000000099')$$, '55000', null, 'otra clave sobre un envío cerrado = 55000');
select throws_ok($$select public.enviar_newsletter('b1000000-0000-0000-0000-000000000004', 1, 'aaaaaaaa-0000-0000-0000-000000000001')$$, '22023', null, 'una clave usada por otro newsletter se rechaza');

reset role;
select is((select count(*)::int from dominio.campana_correo_destinatarios d join dominio.campanas_correo c on c.id = d.campana_id where c.tipo = 'newsletter'), 3, 'SC-001: tres destinatarios');
select is((select count(*)::int from dominio.campana_correo_destinatarios d where d.suscriptor_id in (select id from dominio.newsletter_suscriptores where estado <> 'confirmado' or empresa_id <> 'e1000000-0000-0000-0000-000000000001')), 0, 'SC-001/MSF-967: ningún pendiente (aun con baja_en), baja ni suscriptor de otra tienda');
select is((select count(*)::int from dominio.campana_correo_destinatarios d where d.cliente_id is not null), 0, 'ningún destinatario es cliente');
select isnt((select enviada_en from dominio.newsletters where id = 'b1000000-0000-0000-0000-000000000001'), null, 'el newsletter queda enviado');
select isnt((select contenido_enviado from dominio.newsletters where id = 'b1000000-0000-0000-0000-000000000001'), null, 'con la foto del contenido');
select is((select tipo from dominio.campanas_correo where newsletter_id = 'b1000000-0000-0000-0000-000000000001'), 'newsletter', 'campaña de tipo newsletter');
select is((select empresa_id from dominio.campanas_correo where newsletter_id = 'b1000000-0000-0000-0000-000000000001'), 'e1000000-0000-0000-0000-000000000001'::uuid, 'con la tienda remitente');
select is((select count(*)::int from public.registro_actividad where tipo = 'newsletter.enviar' and detalle ilike '%@%'), 0, 'RF-NL-24: el evento de envío no lleva correos');
select is((select count(*)::int from public.registro_actividad where tipo = 'newsletter.enviar'), 1, 'un evento por envío (el reintento no suma)');

-- Edición de lo enviado (CA-NL-12).
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok($$select public.guardar_newsletter('b1000000-0000-0000-0000-000000000001', 2, 'e1000000-0000-0000-0000-000000000001', 'N', 'A', 'B', false, false)$$, '55000', null, 'CA-NL-12: un newsletter enviado no se edita');

-- Listado: borrador y enviando, con totales.
insert into res select 'lista', public.listar_newsletters(null, null, 1, 25);
select is((select (j ->> 'total')::int from res where clave = 'lista'), 4, 'RF-NL-19: lista borradores y envíos');
select is((select f ->> 'estado' from res, jsonb_array_elements(j -> 'filas') f where clave = 'lista' and f ->> 'id' = 'b1000000-0000-0000-0000-000000000001'), 'enviando', 'RF-NL-19: con pendientes figura «enviando»');
select is((select (f ->> 'destinatarios')::int from res, jsonb_array_elements(j -> 'filas') f where clave = 'lista' and f ->> 'id' = 'b1000000-0000-0000-0000-000000000001'), 3, 'totales: destinatarios');
select is((select f ->> 'estado' from res, jsonb_array_elements(j -> 'filas') f where clave = 'lista' and f ->> 'id' = 'b1000000-0000-0000-0000-000000000002'), 'borrador', 'un borrador figura «borrador»');
select is((public.listar_newsletters(null, 'borrador', 1, 25) ->> 'total')::int, 3, 'filtra por estado');
select is((public.listar_newsletters('e1000000-0000-0000-0000-000000000002', null, 1, 25) ->> 'total')::int, 1, 'filtra por tienda');
select throws_ok($$select public.listar_newsletters(null, 'otro', 1, 25)$$, '22023', null, 'estado inválido');
select is((public.resumen_newsletter(null) ->> 'envios')::int, 1, 'el resumen cuenta los envíos');

-- Cancelar (RF-NL-18): lo ya enviado se conserva; lo reclamado en vuelo no se omite.
reset role;
update dominio.campana_correo_destinatarios set estado = 'enviado', enviado_en = now() where suscriptor_id = '51000000-0000-0000-0000-000000000001';
update dominio.campana_correo_destinatarios set reclamado_hasta = now() + interval '10 minutes' where suscriptor_id = '51000000-0000-0000-0000-000000000002';
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok($$select public.cancelar_envio_newsletter('b1000000-0000-0000-0000-000000000004')$$, '55000', null, 'no se cancela un borrador');
insert into res select 'cancel', public.cancelar_envio_newsletter('b1000000-0000-0000-0000-000000000001');
select is((select j ->> 'cancelados' from res where clave = 'cancel'), '1', 'RF-NL-18: solo se omite lo pendiente sin reclamo vigente');
select is(public.cancelar_envio_newsletter('b1000000-0000-0000-0000-000000000001') ->> 'cancelados', '0', 'cancelar dos veces es idempotente');
reset role;
select is((select estado from dominio.campana_correo_destinatarios where suscriptor_id = '51000000-0000-0000-0000-000000000001'), 'enviado', 'CA-NL-12: lo ya enviado se conserva');
select is((select estado || ':' || error from dominio.campana_correo_destinatarios where suscriptor_id = '51000000-0000-0000-0000-000000000003'), 'omitido:Cancelado', 'lo pendiente queda omitido con motivo «Cancelado»');
select is((select estado from dominio.campana_correo_destinatarios where suscriptor_id = '51000000-0000-0000-0000-000000000002'), 'pendiente', 'lo reclamado en vuelo se cierra solo');
select isnt((select cancelada_en from dominio.newsletters where id = 'b1000000-0000-0000-0000-000000000001'), null, 'queda marcada la cancelación');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is((select f ->> 'estado' from jsonb_array_elements(public.listar_newsletters(null, null, 1, 25) -> 'filas') f where f ->> 'id' = 'b1000000-0000-0000-0000-000000000001'), 'cancelada', 'figura «cancelada»');

-- Permisos y aislamiento.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok($$select public.enviar_newsletter('b1000000-0000-0000-0000-000000000004', 1, 'aaaaaaaa-0000-0000-0000-000000000005')$$, '42501', null, 'CA-NL-7: el lector no envía');
select throws_ok($$select public.cancelar_envio_newsletter('b1000000-0000-0000-0000-000000000001')$$, '42501', null, 'CA-NL-7: el lector no cancela');
select is((public.listar_newsletters(null, null, 1, 25) ->> 'total')::int, 2, 'el lector ve solo los de su tienda');
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok($$select public.enviar_newsletter('b1000000-0000-0000-0000-000000000004', 1, 'aaaaaaaa-0000-0000-0000-000000000006')$$, 'P0002', null, 'CA-NL-8: otra organización no envía');
select throws_ok($$select public.cancelar_envio_newsletter('b1000000-0000-0000-0000-000000000001')$$, 'P0002', null, 'CA-NL-8: otra organización no cancela');
select is((public.listar_newsletters(null, null, 1, 25) ->> 'total')::int, 0, 'CA-NL-8: otra organización no ve envíos ajenos');
reset role;
select is(has_function_privilege('anon', 'public.enviar_newsletter(uuid,integer,uuid)', 'execute'), false, 'anon no envía');
select is(has_function_privilege('anon', 'public.cancelar_envio_newsletter(uuid)', 'execute'), false, 'anon no cancela');

select * from finish();
rollback;
