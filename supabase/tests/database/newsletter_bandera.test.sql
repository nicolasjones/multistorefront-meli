-- Newsletter de la tienda, Fase 1 (T004): efectos de la bandera `newsletter` APAGADA (RF-NL-1, RF-NL-25, CA-NL-11).
-- Con la bandera apagada, aunque el interruptor de la tienda esté encendido: newsletter_por_dominio devuelve activo = false,
-- suscribirse responde el mismo `error` uniforme y no guarda nada ni gasta cupo, confirmar responde `invalido`, y el reclamo
-- de confirmaciones no entrega nada (no sale ningún correo).
begin;

select no_plan();

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'nlb-a.ejemplo.com');
insert into dominio.newsletter_configuracion (empresa_id, organizacion_id, activo) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', true);
-- Un pendiente que ya estaba pedido antes de apagar la bandera.
insert into dominio.newsletter_suscriptores (organizacion_id, empresa_id, correo, version_consentimiento, confirmacion_solicitada_en)
values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'previo@ejemplo.com', 'newsletter-v1', now());

select is((select activa from public.banderas_plataforma where clave = 'newsletter'), false, 'la bandera nace apagada');

create temp table res (clave text primary key, j jsonb);
grant all on res to anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
select set_config('request.headers', '{"x-forwarded-for":"10.0.0.9"}', true);
set local role anon;
insert into res values
  ('por', publico.newsletter_por_dominio('nlb-a.ejemplo.com')),
  ('sus', publico.suscribirse_newsletter('nlb-a.ejemplo.com', 'nuevo@ejemplo.com', true, '00000000-0000-0000-0000-0000000000a1', '')),
  ('con', publico.confirmar_newsletter('nlb-a.ejemplo.com', repeat('ab', 32)));
reset role;

select is((select j from res where clave = 'por'), '{"activo":false}'::jsonb, 'apagada: newsletter_por_dominio devuelve activo = false');
select is((select j from res where clave = 'sus'), '{"resultado":"error"}'::jsonb, 'apagada: suscribirse responde error uniforme');
select is((select j from res where clave = 'con'), '{"resultado":"invalido"}'::jsonb, 'apagada: confirmar responde invalido');
select is((select count(*)::int from dominio.newsletter_suscriptores where correo = 'nuevo@ejemplo.com'), 0, 'apagada: no se guarda nada');
select is((select count(*)::int from dominio.tienda_envios where origen = 'newsletter'), 0, 'apagada: no gasta cupo');
select is((select count(*)::int from private.reclamar_confirmaciones_newsletter(50, 900)), 0, 'apagada: el reclamo no entrega confirmaciones (no sale ningún correo)');
select is((select confirmacion_hash from dominio.newsletter_suscriptores where correo = 'previo@ejemplo.com'), null, 'apagada: el reclamo no genera tokens');

-- Encendida, la misma tienda sí entrega (la bandera es lo único que cambia).
update public.banderas_plataforma set activa = true where clave = 'newsletter';
select is((select count(*)::int from private.reclamar_confirmaciones_newsletter(50, 900)), 1, 'encendida: el reclamo entrega la confirmación pendiente');

select * from finish();
rollback;
