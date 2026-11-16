-- Newsletter de la tienda, Fase 5 (T026): el reclamo del lote del correo masivo envía newsletters (RF-NL-20, RF-NL-21, CA-NL-2,
-- CA-NL-11, SC-001, SC-004). El fixture corre como postgres (el reclamo es de `kestra_orquestacion`, que también lo ejecuta aquí).
begin;

select no_plan();

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
-- El nombre de la tienda trae comillas, ángulos y un salto de línea: el remitente debe salir saneado (sin inyección de cabeceras).
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', E'Tie"nda <A>\nBcc: x@malo.com', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', E'Tienda \\sin dominio', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'nllote-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'nllote-b.ejemplo.com');
insert into dominio.newsletter_configuracion (empresa_id, organizacion_id, activo) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', true),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', true);
insert into dominio.newsletter_suscriptores (id, organizacion_id, empresa_id, correo, estado, version_consentimiento, baja_en) values
  ('51000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ana@ejemplo.com', 'confirmado', 'v1', null),
  ('51000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'beto@ejemplo.com', 'confirmado', 'v1', null),
  ('51000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'caro@ejemplo.com', 'confirmado', 'v1', null),
  ('51000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'dani@ejemplo.com', 'confirmado', 'v1', null),
  ('51000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'eli@ejemplo.com', 'confirmado', 'v1', null),
  ('51000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000003', 'fede@ejemplo.com', 'confirmado', 'v1', null);
insert into dominio.clientes (id, organizacion_id, numero, nombre, tipo, correo, acepta_correo_masivo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 101, 'Cliente Uno', 'minorista', 'cliente@example.com', true);

insert into dominio.clientes (id, organizacion_id, numero, nombre, tipo, correo, acepta_correo_masivo) values
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 102, 'Cliente Llaves', 'minorista', '{{envs.kestra_smtp_password}}@ejemplo.com', true);
-- Un suscriptor anterior a la regla (la restricción nace `not valid`): su correo con llaves nunca se envía.
alter table dominio.newsletter_suscriptores drop constraint newsletter_suscriptores_correo_llaves_ck;
insert into dominio.newsletter_suscriptores (id, organizacion_id, empresa_id, correo, estado, version_consentimiento) values
  ('51000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', '{{envs.x}}@ejemplo.com', 'confirmado', 'v1');
-- Campaña de clientes (la más vieja) y dos newsletters.
insert into dominio.campanas_correo (id, organizacion_id, empresa_id, clave, asunto, mensaje, tipo, bloques, creada_en) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', null, 'aaaaaaaa-0000-0000-0000-000000000001', 'Para clientes', 'Mensaje clientes', 'clientes', null, now() - interval '3 hours'),
  ('ca000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'Novedades A', 'Hola <b>A</b>', 'newsletter',
   '{"generado_en":"2027-01-02T12:00:00Z","tienda":{"nombre":"A","dominio":"nllote-a.ejemplo.com"},"destacados":[{"producto_id":"a1000000-0000-0000-0000-000000000001","nombre":"Alfa <i>","precio":1000,"imagen_url":null,"url":"https://nllote-a.ejemplo.com/producto/a1000000-0000-0000-0000-000000000001"}],"promociones":[]}', now() - interval '2 hours'),
  ('ca000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003', 'Novedades B', 'Hola B', 'newsletter',
   '{"generado_en":"2027-01-02T12:00:00Z","tienda":{"nombre":"Tienda B","dominio":"nllote-b.ejemplo.com"},"destacados":[],"promociones":[]}', now() - interval '1 hour');
insert into dominio.campana_correo_destinatarios (id, organizacion_id, campana_id, cliente_id, suscriptor_id, correo, creado_en) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', null, 'cliente@example.com', now() - interval '3 hours'),
  ('d1000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000002', null, '51000000-0000-0000-0000-000000000001', 'ana@ejemplo.com', now() - interval '2 hours'),
  ('d1000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000002', null, '51000000-0000-0000-0000-000000000002', 'beto@ejemplo.com', now() - interval '2 hours' + interval '1 second'),
  ('d1000000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000002', null, '51000000-0000-0000-0000-000000000003', 'caro@ejemplo.com', now() - interval '2 hours' + interval '2 seconds'),
  ('d1000000-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000002', null, '51000000-0000-0000-0000-000000000004', 'dani@ejemplo.com', now() - interval '2 hours' + interval '3 seconds'),
  ('d1000000-0000-0000-0000-000000000015', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000003', null, '51000000-0000-0000-0000-000000000005', 'eli@ejemplo.com', now() - interval '1 hour');
insert into dominio.campana_correo_destinatarios (id, organizacion_id, campana_id, cliente_id, correo, creado_en) values
  ('d1000000-0000-0000-0000-000000000031', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', '{{envs.kestra_smtp_password}}@ejemplo.com', now() - interval '3 hours');
insert into dominio.campana_correo_destinatarios (id, organizacion_id, campana_id, suscriptor_id, correo, creado_en) values
  ('d1000000-0000-0000-0000-000000000032', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-000000000007', '{{envs.x}}@ejemplo.com', now() - interval '2 hours');
-- Tienda sin dominio (no puede armar el enlace de baja) y un envío CANCELADO cuyo destinatario quedó pendiente con un reclamo vencido.
insert into dominio.newsletters (id, organizacion_id, empresa_id, nombre_interno, asunto, mensaje) values
  ('b1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'Cancelado', 'Cancelado', 'x');
insert into dominio.campanas_correo (id, organizacion_id, empresa_id, clave, asunto, mensaje, tipo, bloques, newsletter_id, creada_en) values
  ('ca000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000004', 'Cancelada', 'No debe salir', 'newsletter',
   '{"generado_en":"2027-01-02T12:00:00Z","tienda":{"nombre":"A","dominio":"nllote-a.ejemplo.com"},"destacados":[],"promociones":[]}', 'b1000000-0000-0000-0000-000000000004', now() - interval '4 hours'),
  ('ca000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000005', 'Sin dominio', 'No debe salir', 'newsletter',
   '{"generado_en":"2027-01-02T12:00:00Z","tienda":{"nombre":"C","dominio":null},"destacados":[],"promociones":[]}', null, now() - interval '4 hours');
update dominio.newsletters set campana_id = 'ca000000-0000-0000-0000-000000000004', enviada_en = now() - interval '4 hours', cancelada_en = now() - interval '3 hours' where id = 'b1000000-0000-0000-0000-000000000004';
insert into dominio.campana_correo_destinatarios (id, organizacion_id, campana_id, suscriptor_id, correo, reclamado_hasta, creado_en) values
  ('d1000000-0000-0000-0000-000000000021', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000004', '51000000-0000-0000-0000-000000000001', 'ana@ejemplo.com', now() - interval '1 minute', now() - interval '4 hours'),
  ('d1000000-0000-0000-0000-000000000022', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000005', '51000000-0000-0000-0000-000000000006', 'fede@ejemplo.com', null, now() - interval '4 hours');
-- Pruebas: una de clientes y una de newsletter.
insert into dominio.correo_masivo_pruebas (id, organizacion_id, correo, asunto, mensaje, bloques, empresa_id) values
  ('aa000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'autor@example.com', 'Prueba clientes', 'Hola', null, null),
  ('aa000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'autor@example.com', 'Prueba newsletter', 'Hola prueba',
   '{"generado_en":"2027-01-02T12:00:00Z","tienda":{"nombre":"Tienda B","dominio":"nllote-b.ejemplo.com"},"destacados":[],"promociones":[]}', 'e1000000-0000-0000-0000-000000000002');

-- ---- Bandera apagada (CA-NL-11, SC-004): solo sale lo de clientes y la prueba de clientes; lo del newsletter queda intacto ----
create temp table apagada as select * from private.reclamar_lote_correo_masivo(50, 100, 900);
select is((select count(*)::int from apagada), 2, 'CA-NL-11: con la bandera apagada solo salen la prueba y el destinatario de clientes');
select is((select count(*)::int from apagada where tipo = 'newsletter'), 0, 'ningún newsletter sale');
select is((select tipo from apagada where campana_id = 'ca000000-0000-0000-0000-000000000001'), 'clientes', 'SC-004: el correo de clientes conserva su tipo');
select is((select cuerpo_html from apagada where campana_id = 'ca000000-0000-0000-0000-000000000001'), null, 'SC-004: el correo de clientes no trae cuerpo armado (el flow usa su plantilla de siempre)');
select is((select count(*)::int from dominio.campana_correo_destinatarios d join dominio.campanas_correo c on c.id = d.campana_id where c.tipo = 'newsletter' and d.estado = 'pendiente' and d.reclamado_hasta is null), 6, 'los destinatarios del newsletter siguen pendientes y sin reclamar');
select is((select estado from dominio.correo_masivo_pruebas where id = 'aa000000-0000-0000-0000-000000000002'), 'pendiente', 'la prueba del newsletter espera');

-- ---- Bandera encendida ----
update public.banderas_plataforma set activa = true where clave = 'newsletter';
-- Cambios antes de reclamar: Dani se dio de baja, Caro volvió a pendiente con baja_en, y la tienda B apaga su interruptor.
update dominio.newsletter_suscriptores set estado = 'baja', baja_en = now() where id = '51000000-0000-0000-0000-000000000004';
update dominio.newsletter_suscriptores set estado = 'pendiente', baja_en = now() - interval '2 days' where id = '51000000-0000-0000-0000-000000000003';
update dominio.newsletter_configuracion set activo = false where empresa_id = 'e1000000-0000-0000-0000-000000000002';

-- Se liberan los reclamos del primer lote (cliente y pruebas) para reclamar de nuevo.
update dominio.campana_correo_destinatarios set reclamado_hasta = null where cliente_id is not null;
update dominio.correo_masivo_pruebas set reclamado_hasta = null;
create temp table lote as select * from private.reclamar_lote_correo_masivo(50, 100, 900);
select is((select string_agg(estado || ':' || error, ',' order by id) from dominio.campana_correo_destinatarios where id in ('d1000000-0000-0000-0000-000000000031', 'd1000000-0000-0000-0000-000000000032')), 'omitido:Correo inválido,omitido:Correo inválido', 'un correo con llaves (cliente o suscriptor) nunca se envía: omitido con motivo fijo');
select is((select count(*)::int from lote where correo like '%{%' or correo like '%}%'), 0, 'ninguna fila entregada trae llaves en el correo');
select is((select estado || ':' || error from dominio.campana_correo_destinatarios where id = 'd1000000-0000-0000-0000-000000000021'), 'omitido:Cancelado', 'un envío cancelado no reenvía aunque su reclamo hubiera vencido');
select is((select count(*)::int from lote where campana_id in ('ca000000-0000-0000-0000-000000000004', 'ca000000-0000-0000-0000-000000000005')), 0, 'ni el envío cancelado ni la tienda sin dominio entregan nada');
select is((select estado from dominio.campana_correo_destinatarios where id = 'd1000000-0000-0000-0000-000000000022'), 'omitido', 'sin dominio no hay enlace de baja: el destinatario queda omitido y no se entrega');
select ok((select bool_and(strpos(cuerpo_html, '/newsletter/baja/' || token) > 0 and cuerpo_html like '%</a>%') from lote where tipo = 'newsletter' and campana_id is not null), 'todo destinatario entregado trae el cuerpo con su enlace de baja');
select is((select count(*)::int from lote where tipo = 'newsletter' and campana_id is not null), 2, 'CA-NL-2: salen solo los dos confirmados (Ana y Beto)');
select is((select array_agg(correo order by correo) from lote where campana_id = 'ca000000-0000-0000-0000-000000000002'), array['ana@ejemplo.com', 'beto@ejemplo.com'], 'SC-001: los destinatarios son los confirmados de la tienda');
select is((select estado from dominio.campana_correo_destinatarios where id = 'd1000000-0000-0000-0000-000000000014'), 'omitido', 'CA-NL-2: el que se dio de baja queda omitido');
select is((select estado from dominio.campana_correo_destinatarios where id = 'd1000000-0000-0000-0000-000000000013'), 'omitido', 'MSF-967: un pendiente con baja_en no recibe nada (omitido)');
select is((select estado from dominio.campana_correo_destinatarios where id = 'd1000000-0000-0000-0000-000000000015'), 'omitido', 'una tienda con el interruptor apagado omite lo pendiente');
select ok((select bool_and(token ~ '^[0-9a-f]{64}$') from lote where campana_id = 'ca000000-0000-0000-0000-000000000002'), 'cada suscriptor recibe un token nuevo');
select is((select count(distinct token)::int from lote where campana_id = 'ca000000-0000-0000-0000-000000000002'), 2, 'tokens distintos');
select ok((select bool_and(strpos(cuerpo_html, 'href="https://nllote-a.ejemplo.com/newsletter/baja/' || token || '"') > 0) from lote where campana_id = 'ca000000-0000-0000-0000-000000000002'), 'CA-NL-6: el correo lleva el enlace de baja propio en el dominio de la tienda');
select ok((select bool_and(strpos(cuerpo_html, 'Hola &lt;b&gt;A&lt;/b&gt;') > 0 and strpos(cuerpo_html, 'Alfa &lt;i&gt;') > 0 and strpos(cuerpo_html, '<b>') = 0) from lote where campana_id = 'ca000000-0000-0000-0000-000000000002'), 'RF-NL-21: mensaje y nombres de producto escapados');
select is((select remitente from lote where campana_id = 'ca000000-0000-0000-0000-000000000002' limit 1), '"Tienda ABcc: x@malo.com"', 'D15: el remitente es el nombre de la tienda, sin comillas, ángulos ni saltos de línea');
select is(private.remitente_newsletter(E'Tienda \\ "x" <y>\r\nz'), '"Tienda  x yz"', 'el remitente también pierde la barra invertida');
select is(private.remitente_newsletter('{{ envs.x }}'), '"envs.x"', 'el remitente pierde las llaves');
select is(private.remitente_newsletter(E'\\"<>'), null, 'un nombre que queda vacío no genera remitente');
select is(private.escapar_html('{{ 1 + 1 }}{% x %}'), '&#123;&#123; 1 + 1 &#125;&#125;&#123;% x %&#125;', 'las llaves salen como entidad: nada llega al motor de plantillas de Kestra');
select is((select dominio_tienda from lote where campana_id = 'ca000000-0000-0000-0000-000000000002' limit 1), 'nllote-a.ejemplo.com', 'trae el dominio de la tienda');
select is((select count(*)::int from lote where campana_id = 'ca000000-0000-0000-0000-000000000001'), 1, 'el correo de clientes sale igual en el mismo lote');
select ok((select token_hashes @> array[encode(sha256(convert_to((select token from lote where destinatario_id = 'd1000000-0000-0000-0000-000000000011'), 'utf8')), 'hex')] from dominio.campana_correo_destinatarios where id = 'd1000000-0000-0000-0000-000000000011'), 'solo se guarda el hash del token');
select is((select tipo from lote where campana_id is null and asunto = 'Prueba newsletter'), 'newsletter', 'la prueba del newsletter sale con su tipo');
select ok((select strpos(cuerpo_html, '/newsletter/baja/ejemplo') > 0 and strpos(cuerpo_html, 'nllote-b.ejemplo.com') > 0 from lote where asunto = 'Prueba newsletter'), 'la prueba lleva un enlace de baja de ejemplo');
select is((select tipo from lote where asunto = 'Prueba clientes'), 'clientes', 'la prueba de clientes no cambia');

-- Cierre y baja con el token reclamado.
select private.cerrar_envio_correo_masivo('d1000000-0000-0000-0000-000000000011', 'enviado', null);
select is((select estado from dominio.campana_correo_destinatarios where id = 'd1000000-0000-0000-0000-000000000011'), 'enviado', 'el cierre funciona para el suscriptor');
select is(public.dar_de_baja_correo_masivo(encode(sha256(convert_to((select token from lote where destinatario_id = 'd1000000-0000-0000-0000-000000000012'), 'utf8')), 'hex')), true, 'CA-NL-6: la baja con el token del correo');
select is((select estado from dominio.newsletter_suscriptores where id = '51000000-0000-0000-0000-000000000002'), 'baja', 'Beto queda en baja');
select is((select estado from dominio.newsletter_suscriptores where id = '51000000-0000-0000-0000-000000000001'), 'confirmado', 'Ana no se ve afectada');

-- Cupo compartido (D14): lo más viejo primero y un tope común para clientes y newsletter.
update dominio.campana_correo_destinatarios set estado = 'pendiente', reclamado_hasta = null, enviado_en = null where id in ('d1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000011');
update dominio.campana_correo_destinatarios set estado = 'omitido' where id not in ('d1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000011');
update dominio.newsletter_suscriptores set estado = 'confirmado', baja_en = null where id = '51000000-0000-0000-0000-000000000001';
select is((select count(*)::int from private.reclamar_lote_correo_masivo(50, 1, 900) where campana_id is not null), 1, 'D14: el cupo diario es uno solo para clientes y newsletter');
select is((select estado from dominio.campana_correo_destinatarios where id = 'd1000000-0000-0000-0000-000000000011'), 'pendiente', 'lo que no entra en el cupo queda pendiente (la campaña de clientes era más vieja)');

-- Borrar los datos de un suscriptor con un envío pendiente: queda omitido y sin correo.
update dominio.campana_correo_destinatarios set reclamado_hasta = null where id = 'd1000000-0000-0000-0000-000000000011';
delete from dominio.newsletter_suscriptores where id = '51000000-0000-0000-0000-000000000001';
select is((select suscriptor_id from dominio.campana_correo_destinatarios where id = 'd1000000-0000-0000-0000-000000000011'), null, 'la FK suelta suscriptor_id sin anular la organización');
select is((select count(*)::int from private.reclamar_lote_correo_masivo(50, 100, 900) where campana_id = 'ca000000-0000-0000-0000-000000000002'), 0, 'un suscriptor borrado no recibe nada');
select is((select estado from dominio.campana_correo_destinatarios where id = 'd1000000-0000-0000-0000-000000000011'), 'omitido', 'queda omitido');

-- Historial de clientes: no muestra newsletters (RF-NL-20).
insert into auth.users (id, email) values ('d1000000-0000-0000-0000-0000000000a1', 'admin@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values ('d1000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');
select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((public.listar_campanas_correo(null, 1, 25) ->> 'total')::int, 1, 'RF-NL-20: el historial de clientes no muestra newsletters');
select is((select bool_or(d ->> 'nombre' = 'Cliente Uno') from jsonb_array_elements(public.detalle_campana_correo('ca000000-0000-0000-0000-000000000001', 1, 50) -> 'destinatarios') d), true, 'el detalle de una campaña de clientes sigue uniendo con dominio.clientes');
select throws_ok($$select public.detalle_campana_correo('ca000000-0000-0000-0000-000000000002', 1, 50)$$, 'P0002', null, 'RF-NL-20: ni su detalle');
reset role;

select * from finish();
rollback;
