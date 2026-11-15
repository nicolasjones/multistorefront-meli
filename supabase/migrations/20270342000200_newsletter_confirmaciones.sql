-- MSF-468 (spec 20270328-100000-newsletter-de-la-tienda), Fase 1 · T003: cola de correos de confirmación (RF-NL-4, RF-NL-6).
--
-- Esquemas (Principio VII): solo funciones de `private` (lógica interna). Escriben `dominio.newsletter_suscriptores`.
-- Las ejecuta SOLO `kestra_orquestacion` (el flow `newsletter-confirmaciones`, Fase 2); `private.exigir_llamante_kestra` rechaza
-- otras sesiones. Con la bandera `newsletter` apagada o la tienda/interruptor apagados el reclamo no devuelve nada: no sale
-- ningún correo.
--
-- Aditiva. Reversión (migración posterior):
--   drop function private.cerrar_confirmacion_newsletter(uuid, text, text);
--   drop function private.reclamar_confirmaciones_newsletter(integer, integer);

-- RF-NL-6 + RF-NL-4: poda las suscripciones `pendiente` de más de 7 días y reclama las confirmaciones por enviar.
-- El nombre de la tienda sale limpio de comillas, `<`, `>` y caracteres de control: el flow lo usa en el encabezado `From` y el asunto
-- (sin inyección de encabezados). El token (244 bits) se genera acá, solo viaja en esta respuesta y se guarda su SHA-256; vence a las 48 h.
create or replace function private.reclamar_confirmaciones_newsletter(p_lote integer, p_vence_seg integer)
returns table (suscriptor_id uuid, correo text, tienda text, dominio text, token text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_fila record;
  v_token text;
  v_lote integer := least(greatest(coalesce(p_lote, 20), 1), 200);
  v_vence interval := make_interval(secs => least(greatest(coalesce(p_vence_seg, 900), 30), 86400));
begin
  perform private.exigir_llamante_kestra();
  perform pg_advisory_xact_lock(hashtextextended('reclamar_confirmaciones_newsletter', 0));

  -- Sin consentimiento confirmado no hay nada que conservar: se purga lo pendiente de más de 7 días.
  -- Una dirección que venía de una baja vuelve a `baja` (lista de supresión: no se pierde); el resto se elimina.
  update dominio.newsletter_suscriptores s
     set estado = 'baja', confirmacion_hash = null, confirmacion_vence = null, confirmacion_solicitada_en = null,
         confirmacion_reclamada_hasta = null, confirmacion_intentos = 0
   where s.estado = 'pendiente' and s.baja_en is not null
     and s.confirmacion_solicitada_en < now() - interval '7 days';
  delete from dominio.newsletter_suscriptores s
   where s.estado = 'pendiente' and s.baja_en is null and s.creado_en < now() - interval '7 days'
     and s.confirmacion_solicitada_en < now() - interval '7 days';

  if not private.bandera_activa('newsletter') then
    return;
  end if;

  for v_fila in
    select s.id as sid, s.empresa_id as eid, s.correo as scorreo, btrim(regexp_replace(e.nombre, '["<>\\[:cntrl:]]', '', 'g')) as tnombre, t.dominio as tdominio
      from dominio.newsletter_suscriptores s
      join dominio.empresas e on e.id = s.empresa_id and e.organizacion_id = s.organizacion_id and e.activa
      join dominio.newsletter_configuracion c on c.empresa_id = s.empresa_id and c.organizacion_id = s.organizacion_id and c.activo
      join lateral (select x.dominio from dominio.tiendas x where x.empresa_id = s.empresa_id order by x.dominio limit 1) t on true
     where s.estado = 'pendiente'
       and s.confirmacion_solicitada_en is not null
       and (s.confirmacion_enviada_en is null or s.confirmacion_enviada_en < s.confirmacion_solicitada_en)
       and (s.confirmacion_reclamada_hasta is null or s.confirmacion_reclamada_hasta < now())
       and s.confirmacion_intentos < 4
     order by s.confirmacion_solicitada_en, s.id
     limit v_lote
       for update of s skip locked
  loop
    v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    update dominio.newsletter_suscriptores u
       set confirmacion_hash = encode(sha256(convert_to(v_token, 'utf8')), 'hex'),
           confirmacion_vence = now() + interval '48 hours',
           confirmacion_reclamada_hasta = now() + v_vence
     where u.id = v_fila.sid;
    suscriptor_id := v_fila.sid;
    correo := v_fila.scorreo;
    tienda := v_fila.tnombre;
    dominio := v_fila.tdominio;
    token := v_token;
    return next;
  end loop;
end;
$$;

comment on function private.reclamar_confirmaciones_newsletter(integer, integer) is
  'MSF-468 (RF-NL-4, RF-NL-6): poda pendientes de más de 7 días y reclama confirmaciones por enviar con token nuevo (solo su hash), vencimiento a 48 h y reclamo con vencimiento. Sin bandera, tienda o interruptor activos no devuelve nada. Solo kestra_orquestacion.';

-- Cierre idempotente: `enviado` marca el envío; `fallido` deja el reintento del próximo ciclo (hasta 4). Solo actúa sobre
-- una suscripción todavía `pendiente` con la confirmación por enviar; motivo fijo (nunca el mensaje del SMTP).
create or replace function private.cerrar_confirmacion_newsletter(p_suscriptor uuid, p_resultado text, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.exigir_llamante_kestra();
  if p_resultado not in ('enviado', 'fallido') then
    raise exception 'Resultado inválido: debe ser enviado o fallido' using errcode = '22023';
  end if;

  if p_resultado = 'enviado' then
    update dominio.newsletter_suscriptores s
       set confirmacion_enviada_en = now(), confirmacion_reclamada_hasta = null, confirmacion_intentos = 0
     where s.id = p_suscriptor and s.estado = 'pendiente' and s.confirmacion_hash is not null
       and (s.confirmacion_enviada_en is null or s.confirmacion_enviada_en < s.confirmacion_solicitada_en);
  else
    update dominio.newsletter_suscriptores s
       set confirmacion_reclamada_hasta = null, confirmacion_intentos = least(s.confirmacion_intentos + 1, 10),
           -- Agotados los 4 ciclos, el enlace que nunca salió no queda vigente 48 h: la persona puede pedir otro.
           confirmacion_hash = case when s.confirmacion_intentos >= 3 then null else s.confirmacion_hash end,
           confirmacion_vence = case when s.confirmacion_intentos >= 3 then null else s.confirmacion_vence end
     where s.id = p_suscriptor and s.estado = 'pendiente' and s.confirmacion_hash is not null
       and (s.confirmacion_enviada_en is null or s.confirmacion_enviada_en < s.confirmacion_solicitada_en);
  end if;
end;
$$;

comment on function private.cerrar_confirmacion_newsletter(uuid, text, text) is
  'MSF-468 (RF-NL-4): cierra una confirmación como enviada o fallida (reintento en el próximo ciclo, máximo 4). Idempotente. Solo kestra_orquestacion.';

revoke execute on function private.reclamar_confirmaciones_newsletter(integer, integer) from public, anon, authenticated;
revoke execute on function private.cerrar_confirmacion_newsletter(uuid, text, text) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'kestra_orquestacion') then
    grant usage on schema private to kestra_orquestacion;
    grant execute on function
      private.exigir_llamante_kestra(),
      private.reclamar_confirmaciones_newsletter(integer, integer),
      private.cerrar_confirmacion_newsletter(uuid, text, text)
      to kestra_orquestacion;
  end if;
end
$$;
