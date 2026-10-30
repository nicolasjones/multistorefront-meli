-- F-CLI-12 (MSF-370, épica MSF-155, spec 20261028-100000-correo-masivo-a-clientes): envío por lotes y baja.
-- FR-016 (lotes con cupo diario), FR-018 (sin doble envío), FR-020 (re-verificación y `omitido`),
-- FR-022 (actividad `campana_correo.baja` sin cuerpo ni correos), FR-019 y SC-004 (baja).
--
-- Esquemas (Principio VII): solo funciones; escriben las tablas de `dominio` de 20270121110000, `public.clientes`
-- (plataforma: apaga `acepta_correo_masivo`) y, por `private.insertar_actividad`, `public.registro_actividad`.
--
-- Quién las ejecuta:
--   private.reclamar_lote_correo_masivo / private.cerrar_envio_correo_masivo  → solo `kestra_orquestacion`
--     (el mismo rol de servicio del resto de los flows; `private.exigir_llamante_kestra` rechaza otras sesiones).
--   public.dar_de_baja_correo_masivo → solo `service_role` (la Edge Function `baja-correo-masivo`). Vive en `public`
--     porque supabase-js solo llama RPC de los esquemas expuestos (`private` no lo está); `anon` y `authenticated`
--     no la ejecutan, así que no abre superficie anónima nueva. Es idempotente y no revela si el token existe.
--
-- Aditiva. Reversión (migración posterior):
--   drop function public.dar_de_baja_correo_masivo(text);
--   drop function private.cerrar_envio_correo_masivo(uuid, text, text);
--   drop function private.reclamar_lote_correo_masivo(integer, integer, integer);

-- Reclama un lote para el flow (cada minuto).
--  1. Las pruebas pendientes salen primero y no cuentan contra el cupo (FR-014).
--  2. Re-verifica a los destinatarios pendientes: si el cliente ya no está activo, no acepta o no tiene un correo
--     válido, queda `omitido` (FR-020); si cambió de correo se usa el vigente.
--  3. Reparte el cupo del día por organización: `p_limite_diario` menos lo enviado hoy y lo reclamado sin vencer.
--     Lo que no entra queda pendiente y retoma al día siguiente (FR-016).
--  4. Reclama con vencimiento (`p_vence_seg`) y genera un enlace de baja nuevo por destinatario (FR-018): solo se
--     guarda su hash.
-- Devuelve una fila por correo a enviar. En las pruebas `campana_id` y `token` son null (el flow usa un enlace de
-- ejemplo); `destinatario_id` es el de la prueba.
create or replace function private.reclamar_lote_correo_masivo(p_lote integer, p_limite_diario integer, p_vence_seg integer)
returns table (destinatario_id uuid, campana_id uuid, correo text, asunto text, mensaje text, token text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_fila record;
  v_token text;
  v_lote integer := least(greatest(coalesce(p_lote, 50), 1), 500);
  v_limite integer := greatest(coalesce(p_limite_diario, 500), 0);
  v_vence interval := make_interval(secs => least(greatest(coalesce(p_vence_seg, 900), 30), 86400));
  v_hoy timestamptz := date_trunc('day', now());
  v_ids uuid[];
begin
  perform private.exigir_llamante_kestra();
  -- Un solo reclamador a la vez: el cupo se calcula y se consume sin que dos lotes lo superen.
  perform pg_advisory_xact_lock(hashtextextended('reclamar_lote_correo_masivo', 0));

  -- Pruebas pendientes (o con el reclamo vencido).
  return query
    with tomadas as (
      update dominio.correo_masivo_pruebas p
         set reclamado_hasta = now() + v_vence
       where p.id in (
               select x.id from dominio.correo_masivo_pruebas x
                where x.estado = 'pendiente' and (x.reclamado_hasta is null or x.reclamado_hasta < now())
                order by x.creada_en, x.id
                limit 20)
      returning p.id, p.correo, p.asunto, p.mensaje
    )
    select t.id, null::uuid, t.correo, t.asunto, t.mensaje, null::text from tomadas t;

  -- Re-verificación (FR-020) de todo lo pendiente sin reclamo vigente.
  update dominio.campana_correo_destinatarios d
     set estado = 'omitido', error = null, reclamado_hasta = null
    from public.clientes c
   where c.id = d.cliente_id
     and d.estado = 'pendiente'
     and (d.reclamado_hasta is null or d.reclamado_hasta < now())
     and (c.archivado_en is not null
          or c.es_consumidor_final
          or not c.acepta_correo_masivo
          or c.correo is null
          or c.correo !~ '^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$');

  -- Cupo diario por organización, en orden de campaña y luego de destinatario.
  select coalesce(array_agg(s.id), '{}') into v_ids
    from (
      select x.id, x.creada_en, x.creado_en
        from (
          select d.id, c.creada_en, d.creado_en,
                 row_number() over (partition by d.organizacion_id order by c.creada_en, d.creado_en, d.id) as pos,
                 d.organizacion_id
            from dominio.campana_correo_destinatarios d
            join dominio.campanas_correo c on c.id = d.campana_id and c.organizacion_id = d.organizacion_id
           where d.estado = 'pendiente' and (d.reclamado_hasta is null or d.reclamado_hasta < now())
        ) x
        left join lateral (
          select count(*) as n
            from dominio.campana_correo_destinatarios u
           where u.organizacion_id = x.organizacion_id
             and ((u.estado = 'enviado' and u.enviado_en >= v_hoy)
                  or (u.estado = 'pendiente' and u.reclamado_hasta >= now()))
        ) usado on true
       where x.pos <= greatest(v_limite - usado.n, 0)
       order by x.creada_en, x.creado_en, x.id
       limit v_lote
    ) s;

  -- Un destinatario a la vez: cada uno necesita su propio token (una expresión volátil por fila).
  for v_fila in
    select d.id as did, d.campana_id as cid, d.cliente_id as clid
      from dominio.campana_correo_destinatarios d
     where d.id = any (v_ids)
       and d.estado = 'pendiente'
       and (d.reclamado_hasta is null or d.reclamado_hasta < now())
     order by d.creado_en, d.id
       for update of d
  loop
    -- 244 bits aleatorios; el token en claro solo viaja en esta respuesta.
    v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    update dominio.campana_correo_destinatarios u
       set reclamado_hasta = now() + v_vence,
           correo = (select btrim(cl.correo) from public.clientes cl where cl.id = v_fila.clid),
           token_hashes = u.token_hashes || encode(sha256(convert_to(v_token, 'utf8')), 'hex')
     where u.id = v_fila.did
    returning u.correo into correo;
    select c.asunto, c.mensaje into asunto, mensaje from dominio.campanas_correo c where c.id = v_fila.cid;
    destinatario_id := v_fila.did;
    campana_id := v_fila.cid;
    token := v_token;
    return next;
  end loop;
end;
$$;

comment on function private.reclamar_lote_correo_masivo(integer, integer, integer) is
  'F-CLI-12 (FR-016, FR-018, FR-020): reclama un lote de correos con cupo diario por organización, re-verifica a cada destinatario (omitido si ya no corresponde) y genera su enlace de baja. Solo kestra_orquestacion.';

-- Cierre de un envío (destinatario de campaña o prueba). Idempotente: solo cierra lo pendiente.
create or replace function private.cerrar_envio_correo_masivo(p_destinatario uuid, p_resultado text, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_error text := nullif(left(btrim(coalesce(p_error, '')), 200), '');
begin
  perform private.exigir_llamante_kestra();
  if p_resultado not in ('enviado', 'fallido') then
    raise exception 'Resultado inválido: debe ser enviado o fallido' using errcode = '22023';
  end if;

  update dominio.campana_correo_destinatarios d
     set estado = p_resultado,
         error = case when p_resultado = 'fallido' then coalesce(v_error, 'No se pudo enviar el correo') else null end,
         enviado_en = case when p_resultado = 'enviado' then now() else null end,
         reclamado_hasta = null
   where d.id = p_destinatario and d.estado = 'pendiente';
  if found then
    return;
  end if;

  update dominio.correo_masivo_pruebas p
     set estado = p_resultado,
         error = case when p_resultado = 'fallido' then coalesce(v_error, 'No se pudo enviar el correo') else null end,
         reclamado_hasta = null
   where p.id = p_destinatario and p.estado = 'pendiente';
end;
$$;

comment on function private.cerrar_envio_correo_masivo(uuid, text, text) is
  'F-CLI-12 (FR-017, FR-018): cierra un destinatario (o una prueba) como enviado o fallido con un motivo corto. Idempotente. Solo kestra_orquestacion.';

-- Baja desde el enlace del correo. Recibe el hash (hex) del token. Devuelve false si no existe (la Edge Function
-- responde igual): no enumera. Idempotente: repetirla no vuelve a registrar actividad.
create or replace function public.dar_de_baja_correo_masivo(p_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_cliente uuid;
  v_estaba boolean;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  select d.organizacion_id, d.cliente_id into v_org, v_cliente
    from dominio.campana_correo_destinatarios d
   where d.token_hashes @> array[p_token_hash]
   limit 1;
  if not found then
    return false;
  end if;

  update public.clientes c set acepta_correo_masivo = false
   where c.id = v_cliente and c.organizacion_id = v_org and c.acepta_correo_masivo
  returning true into v_estaba;

  -- También los pendientes de campañas en curso (SC-004): no reciben nada más.
  update dominio.campana_correo_destinatarios d
     set estado = 'omitido', reclamado_hasta = null
   where d.cliente_id = v_cliente and d.organizacion_id = v_org and d.estado = 'pendiente';

  if coalesce(v_estaba, false) then
    perform private.insertar_actividad(v_org, null, 'campana_correo.baja', 'Un cliente se dio de baja del correo masivo desde el enlace del correo', null);
  end if;
  return true;
end;
$$;

comment on function public.dar_de_baja_correo_masivo(text) is
  'F-CLI-12 (FR-019, FR-022, SC-004): baja del correo masivo por el hash SHA-256 (hex) del token del enlace. Apaga acepta_correo_masivo, omite los pendientes y registra actividad sin datos personales. Idempotente. Solo service_role (Edge Function baja-correo-masivo).';

revoke execute on function private.reclamar_lote_correo_masivo(integer, integer, integer) from public, anon, authenticated;
revoke execute on function private.cerrar_envio_correo_masivo(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.dar_de_baja_correo_masivo(text) from public, anon, authenticated;
grant execute on function public.dar_de_baja_correo_masivo(text) to service_role;

do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'kestra_orquestacion') then
    grant usage on schema private to kestra_orquestacion;
    grant execute on function
      private.exigir_llamante_kestra(),
      private.reclamar_lote_correo_masivo(integer, integer, integer),
      private.cerrar_envio_correo_masivo(uuid, text, text)
      to kestra_orquestacion;
  end if;
end
$$;
