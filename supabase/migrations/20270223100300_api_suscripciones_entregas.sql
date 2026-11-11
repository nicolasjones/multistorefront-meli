-- F-API-01 (MSF-403, FR-010, FR-012): suscripciones a avisos salientes y
-- entregas durables.
--
-- Esquema (Principio VII): `public.api_suscripciones` y `public.api_entregas`
-- son integraciones genéricas de plataforma (webhooks salientes y su outbox),
-- no entidades de negocio del producto → `public`.
-- RLS: select solo del Administrador de la organización; la escritura es solo
-- de funciones (`private`, `security definer`); `anon` sin privilegios.
--
-- SSRF (FR-010): la URL se valida al GUARDAR (solo https, sin credenciales,
-- sin localhost ni IP literal privada/loopback/link-local/metadata) y otra vez
-- al ENTREGAR (resolución DNS, en la Edge Function `entregar-webhook`).
--
-- El secreto de firma vive en Vault: la app nunca lo lee, solo guarda la
-- referencia (`secreto_vault_id`), que queda fuera de los `grant select`.
--
-- Migración aditiva. Reversión (en una migración posterior, no en este PR):
--   revoke execute on function public.crear_suscripcion_api(text, text[]) from authenticated;
--   revoke execute on function public.actualizar_suscripcion_api(uuid, boolean) from authenticated;
--   revoke execute on function public.eliminar_suscripcion_api(uuid) from authenticated;
--   drop function public.crear_suscripcion_api(text, text[]);
--   drop function public.actualizar_suscripcion_api(uuid, boolean);
--   drop function public.eliminar_suscripcion_api(uuid);
--   drop function private.api_fanout_evento(uuid);
--   drop function private.api_reclamar_entregas(integer, integer);
--   drop function private.api_resolver_entrega(uuid, text, integer, text, integer);
--   drop function private.api_entrega_para_entregar(uuid);
--   drop function private.api_url_destino_valida(text);
--   drop function private.api_sanitizar_error(text);
--   drop table public.api_entregas;
--   drop table public.api_suscripciones;
-- (los secretos de Vault se borran aparte: `delete from vault.secrets where id = ...`)

create extension if not exists supabase_vault;

create table if not exists public.api_suscripciones (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  url text not null check (btrim(url) <> '' and length(url) <= 500),
  tipos text[] not null check (
    cardinality(tipos) > 0
    and tipos <@ array['stock.actualizado', 'precio.actualizado', 'venta.registrada']::text[]
  ),
  secreto_vault_id uuid not null,
  activa boolean not null default true,
  creada_por uuid not null references auth.users (id) on delete cascade,
  creada_en timestamptz not null default now(),
  actualizada_en timestamptz not null default now()
);

comment on table public.api_suscripciones is
  'Suscripción a avisos salientes por organización (F-API-01, FR-010). El secreto de firma vive en Vault; acá solo la referencia. Escritura solo por public.crear_suscripcion_api / actualizar_suscripcion_api / eliminar_suscripcion_api.';

create index if not exists api_suscripciones_organizacion_idx on public.api_suscripciones (organizacion_id);

alter table public.api_suscripciones enable row level security;

create policy api_suscripciones_select on public.api_suscripciones
  for select to authenticated
  using ((select private.es_administrador_de(organizacion_id)));

revoke all on table public.api_suscripciones from public, anon, authenticated;
grant select (id, organizacion_id, url, tipos, activa, creada_por, creada_en, actualizada_en)
  on table public.api_suscripciones to authenticated;

create table if not exists public.api_entregas (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  evento_id uuid not null references public.cola_eventos (id) on delete cascade,
  suscripcion_id uuid not null references public.api_suscripciones (id) on delete cascade,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'reclamada', 'completada', 'agotada')),
  intentos integer not null default 0 check (intentos >= 0),
  proximo_intento_en timestamptz not null default now(),
  reclamada_en timestamptz,
  vence_en timestamptz,
  ultimo_estado_http integer,
  ultimo_error_sanitizado text,
  creada_en timestamptz not null default now(),
  actualizada_en timestamptz not null default now(),
  -- Un evento llega a lo sumo una vez por suscripción (SC-003).
  unique (evento_id, suscripcion_id),
  check ((estado = 'reclamada' and reclamada_en is not null and vence_en is not null)
    or (estado <> 'reclamada' and reclamada_en is null and vence_en is null))
);

comment on table public.api_entregas is
  'Entrega de un evento a una suscripción (F-API-01, FR-012). Outbox por destinatario: la escribe private.api_fanout_evento y la resuelve private.api_resolver_entrega.';

create index if not exists api_entregas_pendientes_idx
  on public.api_entregas (proximo_intento_en, creada_en) where estado = 'pendiente';
create index if not exists api_entregas_reclamos_idx
  on public.api_entregas (vence_en) where estado = 'reclamada';
create index if not exists api_entregas_organizacion_idx
  on public.api_entregas (organizacion_id, creada_en desc);

alter table public.api_entregas enable row level security;

create policy api_entregas_select on public.api_entregas
  for select to authenticated
  using ((select private.es_administrador_de(organizacion_id)));

revoke all on table public.api_entregas from public, anon, authenticated;
grant select (id, organizacion_id, evento_id, suscripcion_id, estado, intentos,
  proximo_intento_en, reclamada_en, vence_en, ultimo_estado_http, ultimo_error_sanitizado,
  creada_en, actualizada_en)
  on public.api_entregas to authenticated;

-- ============================================================================
-- Validación del destino (SSRF) y saneamiento del error.
-- ============================================================================

-- Solo https, sin credenciales en la URL y sin host que apunte a la red
-- interna. Los rangos privados se comparan con `inet` para no dejar pasar
-- variantes como 10.0.0.1 o 172.16.0.1.
create or replace function private.api_url_destino_valida(p_url text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_url text := btrim(coalesce(p_url, ''));
  v_host text;
  v_ip inet;
begin
  if v_url = '' or v_url !~ '^https://' then
    return false;
  end if;

  -- Credenciales en la URL (https://usuario:clave@host/...).
  if v_url ~ '^https://[^/]*@' then
    return false;
  end if;

  v_host := lower(split_part(split_part(v_url, '://', 2), '/', 1));
  v_host := split_part(v_host, ':', 1);

  if v_host = '' then
    return false;
  end if;

  -- Direcciones IPv6 literales: todas se rechazan (loopback, link-local y
  -- ULA no se pueden discriminar con una regla simple).
  if v_host like '[%' then
    return false;
  end if;

  -- Un host solo puede tener letras, dígitos, guiones y puntos: cualquier otra
  -- cosa (espacios, percent-encoding, caracteres de control) no es un destino
  -- válido.
  if v_host !~ '^[a-z0-9.-]+$' then
    return false;
  end if;

  if v_host = 'localhost'
    or v_host like '%.localhost'
    or v_host like '%.local'
    or v_host like '%.internal'
    or v_host = 'metadata.google.internal'
    or v_host like '%.metadata.google.internal' then
    return false;
  end if;

  -- IPv4 literal: solo se acepta el cuádruplo punteado canónico. Las otras
  -- notaciones ('127.1', '0177.0.0.1', '2130706433', '0x7f000001') las
  -- resuelve el sistema a direcciones internas aunque no parezcan una IP:
  -- se rechazan todas (FR-010).
  if v_host ~ '^[0-9.]+$' or v_host ~ '^0[xX]' then
    if v_host !~ '^(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}$' then
      return false;
    end if;

    v_ip := v_host::inet;
    if v_ip << '0.0.0.0/8'::inet
      or v_ip << '10.0.0.0/8'::inet
      or v_ip << '127.0.0.0/8'::inet
      or v_ip << '169.254.0.0/16'::inet
      or v_ip << '172.16.0.0/12'::inet
      or v_ip << '192.168.0.0/16'::inet
      or v_ip << '100.64.0.0/10'::inet
      or v_ip << '192.0.0.0/24'::inet
      or v_ip << '198.18.0.0/15'::inet
      or v_ip >= '224.0.0.0/4'::inet then
      return false;
    end if;

    return true;
  end if;

  return true;
end;
$$;

comment on function private.api_url_destino_valida(text) is
  'F-API-01: valida el destino de un webhook al guardarlo (solo https, sin credenciales, sin host interno).';

-- El error que se guarda nunca lleva credenciales ni una URL autenticada.
create or replace function private.api_sanitizar_error(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(
    regexp_replace(
      coalesce(p_texto, ''),
      '(https?://)[^/\s:@]+:[^/\s@]+@',
      '\1[REDACTADO]@',
      'gi'
    ),
    500
  );
$$;

revoke execute on function private.api_url_destino_valida(text) from public, anon, authenticated;
revoke execute on function private.api_sanitizar_error(text) from public, anon, authenticated;

-- ============================================================================
-- public.crear_suscripcion_api — el secreto de firma se muestra una sola vez.
-- ============================================================================

create or replace function public.crear_suscripcion_api(p_url text, p_tipos text[])
returns table (id uuid, secreto text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion_id uuid := (select private.organizacion_id());
  v_url text := btrim(coalesce(p_url, ''));
  v_tipos text[];
  v_secreto text;
  v_vault_id uuid;
  v_id uuid;
begin
  if v_organizacion_id is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede crear suscripciones a avisos' using errcode = '42501';
  end if;

  if not (select private.api_url_destino_valida(v_url)) then
    raise exception 'La URL del aviso no es válida: tiene que ser https y apuntar a un destino público' using errcode = '22023';
  end if;

  -- El orden pedido se conserva (es el que ve el Administrador en la pantalla)
  -- y los repetidos se descartan.
  select coalesce(array_agg(u.t order by u.ord), '{}'::text[]) into v_tipos
    from (select distinct on (btrim(t)) btrim(t) as t, ord
            from unnest(coalesce(p_tipos, '{}'::text[])) with ordinality as u(t, ord)
           where btrim(t) <> ''
           order by btrim(t), ord) u;

  if cardinality(v_tipos) = 0 then
    raise exception 'La suscripción necesita al menos un tipo de evento' using errcode = '22023';
  end if;

  if not (v_tipos <@ array['stock.actualizado', 'precio.actualizado', 'venta.registrada']::text[]) then
    raise exception 'Tipo de evento inválido' using errcode = '22023';
  end if;

  v_secreto := encode(extensions.gen_random_bytes(32), 'hex');
  v_vault_id := vault.create_secret(v_secreto);

  insert into public.api_suscripciones (organizacion_id, url, tipos, secreto_vault_id, creada_por)
  values (v_organizacion_id, v_url, v_tipos, v_vault_id, (select auth.uid()))
  returning api_suscripciones.id into v_id;

  return query select v_id, v_secreto;
end;
$$;

comment on function public.crear_suscripcion_api(text, text[]) is
  'F-API-01: crea una suscripción a avisos. El secreto de firma se muestra una sola vez y queda en Vault.';

revoke execute on function public.crear_suscripcion_api(text, text[]) from public, anon;
grant execute on function public.crear_suscripcion_api(text, text[]) to authenticated;

-- ============================================================================
-- public.actualizar_suscripcion_api — pausar o reanudar.
-- Las entregas ya generadas terminan su ciclo (la suscripción pausada no
-- genera nuevas).
-- ============================================================================

create or replace function public.actualizar_suscripcion_api(p_id uuid, p_activa boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion_id uuid := (select private.organizacion_id());
begin
  if v_organizacion_id is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede modificar suscripciones a avisos' using errcode = '42501';
  end if;

  update public.api_suscripciones
     set activa = coalesce(p_activa, false), actualizada_en = now()
   where public.api_suscripciones.id = p_id
     and organizacion_id = v_organizacion_id;

  if not found then
    raise exception 'La suscripción no existe' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.actualizar_suscripcion_api(uuid, boolean) is
  'F-API-01: pausa o reanuda una suscripción a avisos de la organización.';

revoke execute on function public.actualizar_suscripcion_api(uuid, boolean) from public, anon;
grant execute on function public.actualizar_suscripcion_api(uuid, boolean) to authenticated;

-- ============================================================================
-- public.eliminar_suscripcion_api — borra la suscripción y su secreto de Vault.
-- ============================================================================

create or replace function public.eliminar_suscripcion_api(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion_id uuid := (select private.organizacion_id());
  v_vault_id uuid;
begin
  if v_organizacion_id is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede eliminar suscripciones a avisos' using errcode = '42501';
  end if;

  select secreto_vault_id into v_vault_id
    from public.api_suscripciones
   where public.api_suscripciones.id = p_id
     and organizacion_id = v_organizacion_id;

  if not found then
    raise exception 'La suscripción no existe' using errcode = 'P0002';
  end if;

  delete from public.api_suscripciones where public.api_suscripciones.id = p_id;

  -- El secreto de firma deja de existir junto con la suscripción.
  delete from vault.secrets where id = v_vault_id;
end;
$$;

comment on function public.eliminar_suscripcion_api(uuid) is
  'F-API-01: elimina una suscripción a avisos de la organización y borra su secreto de Vault.';

revoke execute on function public.eliminar_suscripcion_api(uuid) from public, anon;
grant execute on function public.eliminar_suscripcion_api(uuid) to authenticated;

-- ============================================================================
-- private.api_fanout_evento — una entrega por suscripción activa que escuche
-- el tipo del evento. Idempotente por (evento_id, suscripcion_id).
-- ============================================================================

create or replace function private.api_fanout_evento(p_evento_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_creadas integer;
begin
  insert into public.api_entregas (organizacion_id, evento_id, suscripcion_id)
  select e.organizacion_id, e.id, s.id
    from public.cola_eventos e
    join public.api_suscripciones s
      on s.organizacion_id = e.organizacion_id
     and s.activa
     and e.tipo = any (s.tipos)
   where e.id = p_evento_id
  on conflict (evento_id, suscripcion_id) do nothing;

  get diagnostics v_creadas = row_count;
  return v_creadas;
end;
$$;

comment on function private.api_fanout_evento(uuid) is
  'F-API-01: genera una entrega por suscripción activa del evento (idempotente por evento y suscripción).';

-- ============================================================================
-- private.api_reclamar_entregas — lease de las entregas pendientes.
-- ============================================================================

create or replace function private.api_reclamar_entregas(
  p_limite integer default 20,
  p_lease_seg integer default 60
)
returns setof public.api_entregas
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_limite is null or p_limite < 1 or p_limite > 100 then
    raise exception 'LIMITE_INVALIDO' using errcode = '22023';
  end if;
  if p_lease_seg is null or p_lease_seg < 1 or p_lease_seg > 3600 then
    raise exception 'DURACION_INVALIDA' using errcode = '22023';
  end if;

  -- Un reclamo vencido vuelve a estar disponible; si ya gastó los 5 intentos
  -- (D-6) queda agotada.
  update public.api_entregas d
     set estado = case when d.intentos >= 5 then 'agotada' else 'pendiente' end,
         reclamada_en = null, vence_en = null,
         proximo_intento_en = clock_timestamp(),
         ultimo_error_sanitizado = 'RECLAMO_VENCIDO',
         actualizada_en = clock_timestamp()
   where d.estado = 'reclamada' and d.vence_en <= clock_timestamp();

  return query
  with candidatos as (
    select d.id from public.api_entregas d
     where d.estado = 'pendiente' and d.proximo_intento_en <= clock_timestamp()
     order by d.proximo_intento_en, d.creada_en
     for update skip locked
     limit p_limite
  ), reclamadas as (
    update public.api_entregas d
       set estado = 'reclamada', intentos = d.intentos + 1,
           reclamada_en = clock_timestamp(),
           vence_en = clock_timestamp() + make_interval(secs => p_lease_seg),
           actualizada_en = clock_timestamp()
      from candidatos c where d.id = c.id
     returning d.*
  )
  select * from reclamadas;
end;
$$;

comment on function private.api_reclamar_entregas(integer, integer) is
  'F-API-01: reclama las entregas pendientes con lease (la usa el flow de Kestra).';

-- ============================================================================
-- private.api_resolver_entrega — el resultado de una entrega.
-- La espera del reintento es 60 s × 2^(intentos-1) (D-6): si el llamador no
-- pasa `p_espera_seg`, la calcula acá (un reintento inmediato sería un bucle
-- caliente contra el destino). El tope de 5 intentos se aplica como red de
-- seguridad: una entrega con 5 intentos no vuelve a quedar pendiente.
-- ============================================================================

create or replace function private.api_resolver_entrega(
  p_entrega_id uuid,
  p_estado text,
  p_estado_http integer,
  p_error text,
  p_espera_seg integer default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_estado not in ('completada', 'pendiente', 'agotada') then
    raise exception 'ESTADO_INVALIDO' using errcode = '22023';
  end if;

  update public.api_entregas d
     set estado = case
           when p_estado = 'pendiente' and d.intentos >= 5 then 'agotada'
           else p_estado
         end,
         proximo_intento_en = case
           when p_estado = 'pendiente' and d.intentos < 5
             then clock_timestamp() + make_interval(secs => coalesce(
               p_espera_seg,
               least(60 * power(2, greatest(d.intentos - 1, 0)), 480)))
           else d.proximo_intento_en
         end,
         ultimo_estado_http = p_estado_http,
         ultimo_error_sanitizado = (select private.api_sanitizar_error(p_error)),
         reclamada_en = null, vence_en = null,
         actualizada_en = clock_timestamp()
   where d.id = p_entrega_id and d.estado = 'reclamada';

  if not found then
    raise exception 'ENTREGA_NO_VIGENTE' using errcode = 'P0001';
  end if;
end;
$$;

comment on function private.api_resolver_entrega(uuid, text, integer, text, integer) is
  'F-API-01: resuelve una entrega (completada, pendiente con espera o agotada). La usa la Edge Function entregar-webhook.';

-- ============================================================================
-- private.api_entrega_para_entregar — lo que la Edge Function `entregar-webhook`
-- necesita para entregar una entrega: el destino, el evento y el secreto de
-- firma. El secreto se lee de Vault acá (el navegador nunca lo ve) y solo
-- `service_role` puede llamarla.
-- ============================================================================

create or replace function private.api_entrega_para_entregar(p_entrega_id uuid)
returns table (url text, evento jsonb, secreto text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select s.url,
    jsonb_build_object(
      'id', ev.id,
      'tipo', ev.tipo,
      'organizacion_id', ev.organizacion_id,
      'ocurrido_en', ev.carga->>'ocurrido_en',
      'datos', ev.carga - 'ocurrido_en'
    ),
    vs.decrypted_secret
    from public.api_entregas d
    join public.api_suscripciones s on s.id = d.suscripcion_id
    join public.cola_eventos ev on ev.id = d.evento_id
    join vault.decrypted_secrets vs on vs.id = s.secreto_vault_id
   where d.id = p_entrega_id;
end;
$$;

comment on function private.api_entrega_para_entregar(uuid) is
  'F-API-01: devuelve el destino, el evento y el secreto de firma de una entrega. Solo service_role: el secreto nunca llega al navegador.';

revoke execute on function private.api_entrega_para_entregar(uuid) from public, anon, authenticated;
grant execute on function private.api_entrega_para_entregar(uuid) to service_role;

revoke execute on function private.api_fanout_evento(uuid) from public, anon, authenticated;
revoke execute on function private.api_reclamar_entregas(integer, integer) from public, anon, authenticated;
revoke execute on function private.api_resolver_entrega(uuid, text, integer, text, integer) from public, anon, authenticated;
grant execute on function private.api_fanout_evento(uuid) to kestra_orquestacion, service_role;
grant execute on function private.api_reclamar_entregas(integer, integer) to kestra_orquestacion, service_role;
grant execute on function private.api_resolver_entrega(uuid, text, integer, text, integer) to kestra_orquestacion, service_role;
