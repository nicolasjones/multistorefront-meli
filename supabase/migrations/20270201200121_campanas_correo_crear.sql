-- F-CLI-12 (MSF-370, épica MSF-155, spec 20261028-100000-correo-masivo-a-clientes): crear la campaña y pedir la
-- prueba. FR-015 (campaña con foto de elegibles, idempotente, rechazo sin destinatarios) y FR-014 (prueba al autor).
--
-- Esquemas (Principio VII): solo funciones. Escriben `dominio.campanas_correo`,
-- `dominio.campana_correo_destinatarios` y `dominio.correo_masivo_pruebas` (dominio, 20270121110000) y, por
-- `private.registrar_actividad`, `public.registro_actividad` (plataforma, solo datos: sin cuerpo ni correos).
--
-- Permiso: edición en la sección `clientes` (enviar a terceros es una acción hacia afuera), validada en la base.
-- Ambas son `security definer` porque `authenticated` no escribe las tablas; la organización y el actor salen de la
-- sesión, nunca de parámetros. `revoke … public, anon` / `grant … authenticated` explícitos.
--
-- Aditiva. Reversión (migración posterior):
--   drop function public.solicitar_prueba_correo_masivo(text, text);
--   drop function public.crear_campana_correo(uuid, text, text, uuid, text, text, boolean, uuid[]);
--   drop function private.validar_redaccion_correo_masivo(text, text);

-- Mismas reglas que las tablas: asunto y mensaje obligatorios, 200 / 10 000 caracteres, sin saltos de línea en el
-- asunto (no puede inyectar cabeceras del correo).
create or replace function private.validar_redaccion_correo_masivo(p_asunto text, p_mensaje text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if btrim(coalesce(p_asunto, '')) = '' then
    raise exception 'El asunto es obligatorio' using errcode = '22023', hint = 'asunto';
  end if;
  if char_length(p_asunto) > 200 then
    raise exception 'El asunto admite hasta 200 caracteres' using errcode = '22023', hint = 'asunto';
  end if;
  if p_asunto ~ '[\r\n]' then
    raise exception 'El asunto no puede tener saltos de línea' using errcode = '22023', hint = 'asunto';
  end if;
  if btrim(coalesce(p_mensaje, '')) = '' then
    raise exception 'El mensaje es obligatorio' using errcode = '22023', hint = 'mensaje';
  end if;
  if char_length(p_mensaje) > 10000 then
    raise exception 'El mensaje admite hasta 10000 caracteres' using errcode = '22023', hint = 'mensaje';
  end if;
end;
$$;

revoke execute on function private.validar_redaccion_correo_masivo(text, text) from public, anon, authenticated;

create or replace function public.crear_campana_correo(
  p_clave uuid,
  p_asunto text,
  p_mensaje text,
  p_empresa uuid default null,
  p_texto text default null,
  p_tipo text default null,
  p_con_cuenta_web boolean default false,
  p_clientes uuid[] default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_id uuid;
  v_total integer;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para enviar un correo masivo' using errcode = '42501';
  end if;
  if (select private.nivel_seccion('clientes')) is distinct from 'edicion' then
    raise exception 'Tu rol no puede enviar el correo masivo' using errcode = '42501';
  end if;
  if p_clave is null then
    raise exception 'Falta la clave de la campaña' using errcode = '22023', hint = 'clave';
  end if;
  perform private.validar_redaccion_correo_masivo(p_asunto, p_mensaje);

  -- Serializa los pedidos de la misma clave: el doble clic y dos pestañas dan una sola campaña (FR-015).
  perform pg_advisory_xact_lock(hashtextextended('campana_correo:' || v_org::text || ':' || p_clave::text, 0));

  select c.id into v_id from dominio.campanas_correo c where c.organizacion_id = v_org and c.clave = p_clave;
  if found then
    return v_id;
  end if;

  select count(*) into v_total
    from private.clientes_para_correo_masivo(p_texto, p_tipo, p_empresa, p_con_cuenta_web, p_clientes) c
   where c.acepta_correo_masivo
     and c.correo ~ '^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$';
  if v_total = 0 then
    raise exception 'No hay clientes elegibles para este correo: necesitan estar activos, tener un correo válido y aceptar el correo masivo'
      using errcode = '22023', hint = 'sin_destinatarios';
  end if;

  insert into dominio.campanas_correo (organizacion_id, empresa_id, clave, asunto, mensaje, creada_por)
  values (v_org, p_empresa, p_clave, btrim(p_asunto), p_mensaje, v_actor)
  returning id into v_id;

  -- Foto de los elegibles de este momento (la función filtra por la organización de la sesión).
  insert into dominio.campana_correo_destinatarios (organizacion_id, campana_id, cliente_id, correo)
  select v_org, v_id, c.id, btrim(c.correo)
    from private.clientes_para_correo_masivo(p_texto, p_tipo, p_empresa, p_con_cuenta_web, p_clientes) c
   where c.acepta_correo_masivo
     and c.correo ~ '^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$';

  perform private.registrar_actividad(
    'campana_correo.crear',
    format('Creó la campaña de correo «%s» para %s %s', left(btrim(p_asunto), 120), v_total, case when v_total = 1 then 'cliente' else 'clientes' end),
    p_empresa
  );
  return v_id;
end;
$$;

revoke execute on function public.crear_campana_correo(uuid, text, text, uuid, text, text, boolean, uuid[]) from public, anon;
grant execute on function public.crear_campana_correo(uuid, text, text, uuid, text, text, boolean, uuid[]) to authenticated;

comment on function public.crear_campana_correo(uuid, text, text, uuid, text, text, boolean, uuid[]) is
  'F-CLI-12 (FR-015, FR-022): crea una campaña con la foto de los destinatarios elegibles del grupo. Exige edición en clientes; idempotente por clave; rechaza (22023, hint sin_destinatarios) si no hay elegibles. Devuelve el id de la campaña.';

create or replace function public.solicitar_prueba_correo_masivo(p_asunto text, p_mensaje text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_correo text;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para enviar una prueba' using errcode = '42501';
  end if;
  if (select private.nivel_seccion('clientes')) is distinct from 'edicion' then
    raise exception 'Tu rol no puede enviar el correo masivo' using errcode = '42501';
  end if;
  perform private.validar_redaccion_correo_masivo(p_asunto, p_mensaje);

  select nullif(btrim(u.email::text), '') into v_correo from auth.users u where u.id = v_actor;
  if v_correo is null then
    raise exception 'Tu usuario no tiene un correo para recibir la prueba' using errcode = '22023', hint = 'sin_correo';
  end if;

  -- Tope para que la prueba no sirva para inundar el buzón: cinco por hora y por persona.
  perform pg_advisory_xact_lock(hashtextextended('prueba_correo_masivo:' || v_actor::text, 0));
  if (select count(*) from dominio.correo_masivo_pruebas p
       where p.organizacion_id = v_org and p.solicitado_por = v_actor and p.creada_en > now() - interval '1 hour') >= 5 then
    raise exception 'Ya pediste varias pruebas en la última hora. Probá de nuevo en un rato.' using errcode = '22023', hint = 'limite';
  end if;

  insert into dominio.correo_masivo_pruebas (organizacion_id, solicitado_por, correo, asunto, mensaje)
  values (v_org, v_actor, v_correo, btrim(p_asunto), p_mensaje);
end;
$$;

revoke execute on function public.solicitar_prueba_correo_masivo(text, text) from public, anon;
grant execute on function public.solicitar_prueba_correo_masivo(text, text) to authenticated;

comment on function public.solicitar_prueba_correo_masivo(text, text) is
  'F-CLI-12 (FR-014): pide el envío de prueba del correo al usuario que redacta. No crea campaña ni cuenta contra el cupo diario. Exige edición en clientes; máximo cinco por hora.';
