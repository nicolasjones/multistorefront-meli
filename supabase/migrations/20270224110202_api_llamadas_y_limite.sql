-- F-API-01 (MSF-403, FR-007, FR-008): auditoría de las llamadas a la API y
-- límite de uso por clave.
--
-- Esquema (Principio VII): `public.api_llamadas` es infraestructura transversal
-- de plataforma (auditoría de integraciones genéricas) → `public`.
-- RLS: select solo del Administrador de la organización; la escriben solo las
-- funciones de servicio (la Edge Function `api-v1` con `service_role`).
-- No guarda cuerpos de la petición ni el token: solo clave, método, ruta,
-- versión, estado y duración (FR-008).
--
-- `organizacion_id` y `clave_id` pueden quedar nulos: es el caso del token con
-- prefijo desconocido (se audita sin organización).
--
-- Migración aditiva. Reversión (en una migración posterior, no en este PR):
--   revoke execute on function public.api_validar_clave(text) from service_role;
--   revoke execute on function public.api_controlar_limite(uuid) from service_role;
--   revoke execute on function public.api_registrar_llamada(uuid, uuid, text, text, text, integer, integer, uuid) from service_role;
--   revoke execute on function private.purgar_api_llamadas(integer) from kestra_orquestacion, service_role;
--   drop function public.api_validar_clave(text);
--   drop function public.api_controlar_limite(uuid);
--   drop function public.api_registrar_llamada(uuid, uuid, text, text, text, integer, integer, uuid);
--   drop function private.purgar_api_llamadas(integer);
--   drop table public.api_llamadas;

create table if not exists public.api_llamadas (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid references public.organizaciones (id) on delete cascade,
  clave_id uuid references public.api_claves (id) on delete set null,
  metodo text not null check (btrim(metodo) <> '' and length(metodo) <= 16),
  ruta text not null check (btrim(ruta) <> '' and length(ruta) <= 200),
  version text not null check (btrim(version) <> '' and length(version) <= 16),
  estado_http integer not null check (estado_http between 100 and 599),
  duracion_ms integer check (duracion_ms is null or duracion_ms >= 0),
  creada_en timestamptz not null default now()
);

comment on table public.api_llamadas is
  'Auditoría de las llamadas a la API pública (F-API-01, FR-008). Sin cuerpos ni token; la escribe solo la Edge Function api-v1. Retención 90 días (private.purgar_api_llamadas).';

create index if not exists api_llamadas_clave_ventana_idx
  on public.api_llamadas (clave_id, creada_en desc);
create index if not exists api_llamadas_organizacion_idx
  on public.api_llamadas (organizacion_id, creada_en desc);
create index if not exists api_llamadas_retencion_idx
  on public.api_llamadas (creada_en);

alter table public.api_llamadas enable row level security;

create policy api_llamadas_select on public.api_llamadas
  for select to authenticated
  using ((select private.es_administrador_de(organizacion_id)));

revoke all on table public.api_llamadas from public, anon, authenticated;
grant select (id, organizacion_id, clave_id, metodo, ruta, version, estado_http, duracion_ms, creada_en)
  on table public.api_llamadas to authenticated;
-- Solo la Edge Function (service_role) inserta: la auditoría no se puede falsear
-- desde el navegador.
grant insert on table public.api_llamadas to service_role;

-- ============================================================================
-- public.api_validar_clave — resuelve el token a una clave.
--
-- Con prefijo conocido y hash que no coincide devuelve la organización y la
-- clave con `valida = false`: la llamada se audita contra esa organización
-- (FR-008). Con prefijo desconocido devuelve nulos: se audita sin
-- organización. `motivo` distingue el caso para el mensaje uniforme del
-- cliente (token_invalido / clave_revocada / clave_vencida).
-- ============================================================================

create or replace function public.api_validar_clave(p_token text)
returns table (
  valida boolean,
  clave_id uuid,
  organizacion_id uuid,
  alcances text[],
  limite_por_minuto integer,
  motivo text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prefijo text;
  v_clave public.api_claves;
begin
  v_prefijo := substring(coalesce(p_token, '') from '^msf_([0-9a-f]{8})_');

  if v_prefijo is null then
    return query select false, null::uuid, null::uuid, null::text[], null::integer, 'token_invalido';
    return;
  end if;

  select * into v_clave from public.api_claves where public.api_claves.prefijo = v_prefijo;

  if not found then
    return query select false, null::uuid, null::uuid, null::text[], null::integer, 'token_invalido';
    return;
  end if;

  if v_clave.hash is distinct from extensions.digest(p_token, 'sha256') then
    return query select false, v_clave.id, v_clave.organizacion_id, null::text[],
      v_clave.limite_por_minuto, 'token_invalido';
    return;
  end if;

  if v_clave.revocada_en is not null then
    return query select false, v_clave.id, v_clave.organizacion_id, null::text[],
      v_clave.limite_por_minuto, 'clave_revocada';
    return;
  end if;

  if v_clave.vence_en is not null and v_clave.vence_en <= now() then
    return query select false, v_clave.id, v_clave.organizacion_id, null::text[],
      v_clave.limite_por_minuto, 'clave_vencida';
    return;
  end if;

  return query select true, v_clave.id, v_clave.organizacion_id, v_clave.alcances,
    v_clave.limite_por_minuto, null::text;
end;
$$;

comment on function public.api_validar_clave(text) is
  'F-API-01: resuelve el token de la API a su clave. Solo service_role: la usa la Edge Function api-v1.';

revoke execute on function public.api_validar_clave(text) from public, anon, authenticated;
grant execute on function public.api_validar_clave(text) to service_role;

-- ============================================================================
-- public.api_controlar_limite — ventana deslizante de 60 s por clave (D-2).
--
-- El lock por clave (`pg_advisory_xact_lock`) serializa las comprobaciones concurrentes de la MISMA clave, y dentro del lock
-- se RESERVA el lugar: se inserta la fila de la llamada (estado provisorio 102) y se devuelve su id. Así N pedidos simultáneos
-- no pasan todos el control (antes la llamada se registraba recién al final y el corte «no era estricto»: FR-007). La Edge
-- Function completa esa fila al terminar (`api_registrar_llamada` con `p_reserva_id`).
--
-- Cuentan en la ventana solo las llamadas AUTENTICADAS: quedan afuera los rechazos 401 (token inválido con el prefijo de una clave
-- conocida: el prefijo es un dato visible en el panel, y 60 rechazos de un tercero dejaban a la integración legítima en 429) y los
-- 429 (un cliente bloqueado que insiste no debe alargar su propio bloqueo).
-- ============================================================================

drop function if exists public.api_controlar_limite(uuid);
create or replace function public.api_controlar_limite(p_clave_id uuid)
returns table (permitido boolean, reintentar_en_seg integer, restantes integer, reserva_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_limite integer;
  v_organizacion uuid;
  v_usadas integer;
  v_masVieja timestamptz;
  v_espera integer;
  v_reserva uuid;
begin
  select public.api_claves.limite_por_minuto, public.api_claves.organizacion_id into v_limite, v_organizacion
    from public.api_claves
   where public.api_claves.id = p_clave_id;

  if v_limite is null then
    return query select false, 60, 0, null::uuid;
    return;
  end if;

  -- Lock por clave: serializa las comprobaciones concurrentes de la misma clave.
  perform pg_advisory_xact_lock(hashtextextended(p_clave_id::text, 0));

  select count(*)::integer, min(creada_en) into v_usadas, v_masVieja
    from public.api_llamadas
   where clave_id = p_clave_id
     and creada_en > now() - interval '60 seconds'
     and estado_http not in (401, 429);

  if v_usadas >= v_limite then
    -- Segundos para que salga de la ventana la llamada más vieja.
    v_espera := greatest(
      1,
      ceil(extract(epoch from (v_masVieja + interval '60 seconds' - now())))::integer
    );
    return query select false, v_espera, 0, null::uuid;
    return;
  end if;

  -- Reserva del lugar dentro del lock (102 = en proceso): la completa `api_registrar_llamada`.
  insert into public.api_llamadas (organizacion_id, clave_id, metodo, ruta, version, estado_http)
  values (v_organizacion, p_clave_id, 'GET', '/reserva', 'v1', 102)
  returning public.api_llamadas.id into v_reserva;

  return query select true, 0, v_limite - v_usadas - 1, v_reserva;
end;
$$;

comment on function public.api_controlar_limite(uuid) is
  'F-API-01: ventana deslizante de 60 s por clave (D-2), estricta: reserva el lugar de la llamada dentro del lock. Cuentan solo las llamadas autenticadas (no los 401 ni los 429). Devuelve si pasa, en cuántos segundos reintentar, los restantes y la reserva.';

revoke execute on function public.api_controlar_limite(uuid) from public, anon, authenticated;
grant execute on function public.api_controlar_limite(uuid) to service_role;

-- ============================================================================
-- public.api_registrar_llamada — audita toda llamada, incluidas las
-- rechazadas (401 y 429). Con `p_reserva_id` completa la fila reservada por el
-- control de límite; sin él inserta una nueva. Actualiza `ultimo_uso_en` solo
-- si la llamada estuvo autenticada (no con un 401: un tercero con el prefijo
-- de una clave no puede simular su uso).
-- ============================================================================

drop function if exists public.api_registrar_llamada(uuid, uuid, text, text, text, integer, integer);
create or replace function public.api_registrar_llamada(
  p_clave_id uuid,
  p_organizacion_id uuid,
  p_metodo text,
  p_ruta text,
  p_version text,
  p_estado_http integer,
  p_duracion_ms integer,
  p_reserva_id uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actualizadas integer := 0;
begin
  if p_reserva_id is not null then
    update public.api_llamadas
       set metodo = btrim(coalesce(p_metodo, 'GET')),
           ruta = btrim(coalesce(p_ruta, '')),
           version = btrim(coalesce(p_version, '')),
           estado_http = coalesce(p_estado_http, 500),
           duracion_ms = p_duracion_ms
     where public.api_llamadas.id = p_reserva_id
       and public.api_llamadas.clave_id is not distinct from p_clave_id;
    get diagnostics v_actualizadas = row_count;
  end if;

  if v_actualizadas = 0 then
    insert into public.api_llamadas (organizacion_id, clave_id, metodo, ruta, version, estado_http, duracion_ms)
    values (p_organizacion_id, p_clave_id, btrim(coalesce(p_metodo, 'GET')),
      btrim(coalesce(p_ruta, '')), btrim(coalesce(p_version, '')),
      coalesce(p_estado_http, 500), p_duracion_ms);
  end if;

  if p_clave_id is not null and coalesce(p_estado_http, 500) <> 401 then
    update public.api_claves
       set ultimo_uso_en = now()
     where public.api_claves.id = p_clave_id;
  end if;
end;
$$;

comment on function public.api_registrar_llamada(uuid, uuid, text, text, text, integer, integer, uuid) is
  'F-API-01: audita una llamada a la API (incluidas las rechazadas); con p_reserva_id completa la fila reservada por el control de límite. Solo service_role.';

revoke execute on function public.api_registrar_llamada(uuid, uuid, text, text, text, integer, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.api_registrar_llamada(uuid, uuid, text, text, text, integer, integer, uuid)
  to service_role;

-- ============================================================================
-- private.purgar_api_llamadas — retención de 90 días (D-10). La ejecuta el
-- flow de Kestra `purgar-api-llamadas` (en el repo no hay pg_cron).
-- ============================================================================

create or replace function private.purgar_api_llamadas(p_retencion_dias integer default 90)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_borradas integer;
begin
  if p_retencion_dias is null or p_retencion_dias < 1 or p_retencion_dias > 3650 then
    raise exception 'RETENCION_INVALIDA' using errcode = '22023';
  end if;

  delete from public.api_llamadas
   where creada_en < now() - make_interval(days => p_retencion_dias);

  get diagnostics v_borradas = row_count;
  return v_borradas;
end;
$$;

comment on function private.purgar_api_llamadas(integer) is
  'F-API-01: borra las llamadas de la API más viejas que la retención (90 días por defecto, D-10). La ejecuta el flow de Kestra.';

revoke execute on function private.purgar_api_llamadas(integer) from public, anon, authenticated;
grant execute on function private.purgar_api_llamadas(integer) to kestra_orquestacion, service_role;
