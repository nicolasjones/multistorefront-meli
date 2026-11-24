-- Newsletter de la tienda: toda consulta de destinatarios filtra `estado = 'confirmado'` (nunca `<> 'baja'`).
-- Un tercero puede dejar `pendiente` una dirección que estaba en `baja` (re-suscripción pública): la fila conserva `baja_en`.
-- Esa fila NO recibe nada y NO cuenta como activa en ninguno de los cuatro caminos que eligen destinatarios:
--   1. el reclamo del lote del correo masivo (`private.reclamar_lote_correo_masivo`),
--   2. el KPI de activos (`resumen_newsletter`) y el listado filtrado (`listar_suscriptores_newsletter`),
--   3. la vista previa (`vista_previa_newsletter`),
--   4. la foto de destinatarios de `enviar_newsletter`.
-- Además se fija la forma del código: esas cuatro funciones filtran el destinatario con `s.estado = 'confirmado'` y no
-- usan `<> 'baja'` ni `in ('pendiente', …)`. Una función nueva que elija destinatarios debe sumarse a esa lista.
begin;

select no_plan();

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into auth.users (id, email) values ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'nlinv-a.ejemplo.com');
insert into dominio.newsletter_configuracion (empresa_id, organizacion_id, activo) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', true);

-- Una sola persona confirmada; las otras tres no deben contar ni recibir: pendiente sin baja, pendiente que venía de una baja
-- (conserva `baja_en`) y baja.
insert into dominio.newsletter_suscriptores (id, organizacion_id, empresa_id, correo, estado, version_consentimiento, baja_en, creado_en) values
  ('51000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ana@ejemplo.com', 'confirmado', 'v1', null, now() - interval '5 hours'),
  ('51000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'pendiente@ejemplo.com', 'pendiente', 'v1', null, now() - interval '4 hours'),
  ('51000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'vuelta@ejemplo.com', 'pendiente', 'v1', now() - interval '9 days', now() - interval '3 hours'),
  ('51000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'baja@ejemplo.com', 'baja', 'v1', now() - interval '8 days', now() - interval '2 hours');

update public.banderas_plataforma set activa = true where clave = 'newsletter';

-- ---- 1. Reclamo del lote: destinatarios pendientes de un envío que ya estaba armado ----
-- La campaña quedó con los cuatro como destinatarios pendientes (p. ej. una foto anterior a la baja o una re-suscripción posterior).
insert into dominio.campanas_correo (id, organizacion_id, empresa_id, clave, asunto, mensaje, tipo, bloques, creada_en) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Novedades', 'Hola', 'newsletter',
   '{"generado_en":"2027-01-02T12:00:00Z","tienda":{"nombre":"Tienda A","dominio":"nlinv-a.ejemplo.com"},"destacados":[],"promociones":[]}', now() - interval '1 hour');
insert into dominio.campana_correo_destinatarios (id, organizacion_id, campana_id, suscriptor_id, correo, creado_en) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'ana@ejemplo.com', now() - interval '1 hour'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000002', 'pendiente@ejemplo.com', now() - interval '1 hour' + interval '1 second'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000003', 'vuelta@ejemplo.com', now() - interval '1 hour' + interval '2 seconds'),
  ('d1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000004', 'baja@ejemplo.com', now() - interval '1 hour' + interval '3 seconds');

create temp table lote as select * from private.reclamar_lote_correo_masivo(50, 100, 900);
select is((select array_agg(correo order by correo) from lote where tipo = 'newsletter'), array['ana@ejemplo.com'],
  'el reclamo del lote entrega solo al suscriptor confirmado');
select is((select count(*)::int from lote where correo in ('pendiente@ejemplo.com', 'vuelta@ejemplo.com', 'baja@ejemplo.com')), 0,
  'ni el pendiente, ni el pendiente con baja_en, ni la baja reciben nada');
select is((select estado from dominio.campana_correo_destinatarios where id = 'd1000000-0000-0000-0000-000000000003'), 'omitido',
  'el pendiente que venía de una baja queda omitido (no se envía)');
select is((select string_agg(estado, ',' order by id) from dominio.campana_correo_destinatarios where id in ('d1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000004')), 'omitido,omitido',
  'el pendiente sin baja y la baja también quedan omitidos');
select is((select estado from dominio.campana_correo_destinatarios where id = 'd1000000-0000-0000-0000-000000000001'), 'pendiente',
  'el confirmado sigue su camino (reclamado, aún pendiente de cierre)');

insert into dominio.newsletters (id, organizacion_id, empresa_id, nombre_interno, asunto, mensaje, incluir_destacados, incluir_promociones) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'Invariante', 'Novedades', 'Hola a todos', false, false);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table res (clave text primary key, j jsonb);
grant all on res to authenticated;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- ---- 2. KPI de activos y listado ----
select is((public.resumen_newsletter(null) ->> 'confirmados')::int, 1, 'el KPI de activos cuenta solo `confirmado`');
select is((public.resumen_newsletter(null) ->> 'pendientes')::int, 2, 'los dos pendientes (con y sin baja_en) se cuentan aparte, no como activos');
select is((public.listar_suscriptores_newsletter(null, 'confirmado', null, 1, 25) ->> 'total')::int, 1, 'el listado de confirmados no incluye al pendiente con baja_en');

select is((select array_agg(f ->> 'correo' order by f ->> 'correo')
             from jsonb_array_elements(public.listar_suscriptores_newsletter(null, 'confirmado', null, 1, 25) -> 'filas') f),
  array['ana@ejemplo.com'], 'el listado de confirmados devuelve solo a la persona confirmada (no solo el total)');
select is((select count(*)::int
             from jsonb_array_elements(public.listar_suscriptores_newsletter(null, 'confirmado', null, 1, 25) -> 'filas') f
            where (f ->> 'id')::uuid in ('51000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-000000000003', '51000000-0000-0000-0000-000000000004')
               or f ->> 'correo' in ('pendiente@ejemplo.com', 'vuelta@ejemplo.com', 'baja@ejemplo.com')), 0,
  'el pendiente con baja_en no aparece por id ni por correo en el listado de confirmados');
select is((select f ->> 'estado' from jsonb_array_elements(public.listar_suscriptores_newsletter(null, null, 'vuelta@', 1, 25) -> 'filas') f), 'pendiente',
  'control: sin filtro de estado el pendiente con baja_en sí está y figura como pendiente, nunca como confirmado');

-- ---- 3. Vista previa ----
select is((public.vista_previa_newsletter('e1000000-0000-0000-0000-000000000001', 'Hola', false, false) ->> 'confirmados')::int, 1,
  'la vista previa anuncia solo a los confirmados');

-- ---- 4. Foto de destinatarios de enviar_newsletter ----
insert into res select 'envio', public.enviar_newsletter('b1000000-0000-0000-0000-000000000001', 1, 'aaaaaaaa-0000-0000-0000-000000000010');
select is((select j ->> 'destinatarios' from res where clave = 'envio'), '1', 'enviar_newsletter anuncia un solo destinatario');
reset role;
select is((select array_agg(suscriptor_id order by suscriptor_id) from dominio.campana_correo_destinatarios where campana_id = ((select j ->> 'campana_id' from res where clave = 'envio'))::uuid),
  array['51000000-0000-0000-0000-000000000001'::uuid], 'la foto contiene solo al confirmado');
select is((select count(*)::int from dominio.campana_correo_destinatarios d
            join dominio.newsletter_suscriptores s on s.id = d.suscriptor_id
           where d.campana_id = ((select j ->> 'campana_id' from res where clave = 'envio'))::uuid
             and (s.estado <> 'confirmado' or s.baja_en is not null)), 0,
  'ningún destinatario fotografiado es pendiente, baja ni conserva baja_en');

-- ---- 5. Forma del código ----
select is((select count(distinct n.nspname || '.' || p.proname)::int
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname, p.proname) in (('public', 'enviar_newsletter'), ('public', 'resumen_newsletter'),
                                             ('public', 'vista_previa_newsletter'), ('private', 'reclamar_lote_correo_masivo'))
              and p.prosrc ~ '\ms\.estado\s*=\s*''confirmado'''), 4,
  'las cuatro funciones que eligen destinatarios filtran s.estado = ''confirmado''');
select is((select count(*)::int
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname, p.proname) in (('public', 'enviar_newsletter'), ('public', 'resumen_newsletter'),
                                             ('public', 'vista_previa_newsletter'), ('private', 'reclamar_lote_correo_masivo'))
              and p.prosrc ~ '\ms\.estado\s*(<>|!=)\s*''baja''|\ms\.estado\s+(not\s+)?in\M'), 0,
  'ninguna usa <> ''baja'' ni in (...) sobre el estado del suscriptor');

select * from finish();
rollback;
