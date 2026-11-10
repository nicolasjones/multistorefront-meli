-- F-API-01 (MSF-403, FR-001, FR-002): claves de API por organización.
--
-- Esquema (Principio VII): `public.api_claves` es una credencial de integración
-- genérica de plataforma (no una entidad de negocio del producto) → `public`.
-- RLS: select solo del Administrador de la organización; sin escritura directa
-- (solo las RPC de este archivo); `anon` sin privilegios.
--
-- El valor de la clave se muestra UNA sola vez (FR-001): de la clave solo se
-- persiste el hash SHA-256 y un prefijo (para poder auditar el intento con
-- organización conocida). La columna `hash` NO entra en el `grant select` de
-- columnas: ni el panel ni el navegador pueden leerla.
--
-- Token: `msf_<prefijo-8-hex>_<secreto-base64url-32-bytes>`. El prefijo se
-- busca por índice para poder auditar un token con prefijo conocido y secreto
-- equivocado (la llamada queda auditada contra esa organización).
--
-- Migración aditiva. Reversión (en una migración posterior, no en este PR):
--   revoke execute on function public.crear_clave_api(text, text[], timestamptz) from authenticated;
--   revoke execute on function public.rotar_clave_api(uuid) from authenticated;
--   revoke execute on function public.revocar_clave_api(uuid) from authenticated;
--   drop function public.crear_clave_api(text, text[], timestamptz);
--   drop function public.rotar_clave_api(uuid);
--   drop function public.revocar_clave_api(uuid);
--   drop table public.api_claves;

create table if not exists public.api_claves (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  nombre text not null check (btrim(nombre) <> '' and length(nombre) <= 120),
  prefijo text not null unique check (prefijo ~ '^[0-9a-f]{8}$'),
  hash bytea not null unique,
  alcances text[] not null check (
    cardinality(alcances) > 0
    and alcances <@ array['productos', 'stock', 'precios', 'ventas']::text[]
  ),
  limite_por_minuto integer not null default 60 check (limite_por_minuto between 1 and 1000),
  creada_por uuid not null references auth.users (id) on delete cascade,
  creada_en timestamptz not null default now(),
  vence_en timestamptz,
  revocada_en timestamptz,
  ultimo_uso_en timestamptz
);

comment on table public.api_claves is
  'Claves de API por organización (F-API-01). Solo el hash SHA-256 y un prefijo se persisten: el valor se muestra una sola vez. Sin escritura directa: solo public.crear_clave_api / rotar_clave_api / revocar_clave_api.';
comment on column public.api_claves.hash is
  'SHA-256 del token completo (extensions.digest). No se otorga a authenticated: es la credencial.';
comment on column public.api_claves.prefijo is
  'Identificador público de 8 hex (parte del token) para auditar un intento fallido sin conocer el secreto.';

create index if not exists api_claves_organizacion_idx on public.api_claves (organizacion_id);

alter table public.api_claves enable row level security;

create policy api_claves_select on public.api_claves
  for select to authenticated
  using ((select private.es_administrador_de(organizacion_id)));

revoke all on table public.api_claves from public, anon, authenticated;
grant select (id, organizacion_id, nombre, prefijo, alcances, limite_por_minuto, creada_por,
  creada_en, vence_en, revocada_en, ultimo_uso_en)
  on table public.api_claves to authenticated;

-- ============================================================================
-- Helpers privados: token y prefijo.
-- ============================================================================

-- El prefijo es un identificador, no un secreto: se persiste en claro para
-- poder resolver la organización de un token inválido y auditarlo.
create or replace function private.api_prefijo_aleatorio()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prefijo text;
begin
  loop
    v_prefijo := substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 8);
    exit when not exists (select 1 from public.api_claves where prefijo = v_prefijo);
  end loop;
  return v_prefijo;
end;
$$;

revoke execute on function private.api_prefijo_aleatorio() from public, anon, authenticated;

-- Secreto de 32 bytes en base64url (sin `+`, `/` ni `=`): el token completo
-- viaja en una cabecera HTTP y no debe traer caracteres que rompan el URL.
create or replace function private.api_secreto_aleatorio()
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
$$;

revoke execute on function private.api_secreto_aleatorio() from public, anon, authenticated;

-- ============================================================================
-- public.crear_clave_api — el Administrador de la organización crea la clave.
-- El valor se devuelve una sola vez: después solo existe el hash.
-- ============================================================================

create or replace function public.crear_clave_api(
  p_nombre text,
  p_alcances text[],
  p_vence_en timestamptz default null
)
returns table (id uuid, valor text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion_id uuid := (select private.organizacion_id());
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_alcances text[];
  v_prefijo text;
  v_token text;
  v_id uuid;
begin
  if v_organizacion_id is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede crear claves de API' using errcode = '42501';
  end if;

  if v_nombre = '' or length(v_nombre) > 120 then
    raise exception 'El nombre de la clave es obligatorio' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct btrim(a)), '{}'::text[]) into v_alcances
    from unnest(coalesce(p_alcances, '{}'::text[])) as a
   where btrim(a) <> '';

  if cardinality(v_alcances) = 0 then
    raise exception 'La clave necesita al menos un alcance' using errcode = '22023';
  end if;

  if not (v_alcances <@ array['productos', 'stock', 'precios', 'ventas']::text[]) then
    raise exception 'Alcance inválido' using errcode = '22023';
  end if;

  if p_vence_en is not null and p_vence_en <= now() then
    raise exception 'El vencimiento debe ser un instante futuro' using errcode = '22023';
  end if;

  v_prefijo := (select private.api_prefijo_aleatorio());
  v_token := 'msf_' || v_prefijo || '_' || (select private.api_secreto_aleatorio());

  insert into public.api_claves (organizacion_id, nombre, prefijo, hash, alcances, vence_en, creada_por)
  values (v_organizacion_id, v_nombre, v_prefijo, extensions.digest(v_token, 'sha256'), v_alcances,
    p_vence_en, (select auth.uid()))
  returning api_claves.id into v_id;

  return query select v_id, v_token;
end;
$$;

comment on function public.crear_clave_api(text, text[], timestamptz) is
  'F-API-01: el Administrador crea una clave de lectura de su organización. Devuelve el valor una sola vez; solo queda el hash.';

revoke execute on function public.crear_clave_api(text, text[], timestamptz) from public, anon;
grant execute on function public.crear_clave_api(text, text[], timestamptz) to authenticated;

-- ============================================================================
-- public.rotar_clave_api — la clave anterior sigue válida 24 h (D-3) y la
-- nueva conserva nombre, alcances y límite.
-- ============================================================================

create or replace function public.rotar_clave_api(p_clave_id uuid)
returns table (id uuid, valor text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clave public.api_claves;
  v_organizacion_id uuid := (select private.organizacion_id());
  v_prefijo text;
  v_token text;
  v_id uuid;
begin
  if v_organizacion_id is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede rotar claves de API' using errcode = '42501';
  end if;

  -- `public.api_claves.id` va cualificado: el parámetro de salida de la RPC
  -- también se llama `id` y, sin calificar, la referencia sería ambigua.
  select * into v_clave from public.api_claves where public.api_claves.id = p_clave_id;
  if not found then
    raise exception 'La clave no existe' using errcode = 'P0002';
  end if;

  if v_clave.organizacion_id <> v_organizacion_id then
    raise exception 'La clave pertenece a otra organización' using errcode = '42501';
  end if;

  if v_clave.revocada_en is not null then
    raise exception 'La clave está revocada' using errcode = '22023';
  end if;

  -- La gracia de 24 h de la clave anterior (D-3).
  update public.api_claves
     set vence_en = now() + interval '24 hours'
   where public.api_claves.id = p_clave_id;

  v_prefijo := (select private.api_prefijo_aleatorio());
  v_token := 'msf_' || v_prefijo || '_' || (select private.api_secreto_aleatorio());

  insert into public.api_claves (organizacion_id, nombre, prefijo, hash, alcances, limite_por_minuto, creada_por)
  values (v_clave.organizacion_id, v_clave.nombre, v_prefijo, extensions.digest(v_token, 'sha256'),
    v_clave.alcances, v_clave.limite_por_minuto, (select auth.uid()))
  returning api_claves.id into v_id;

  return query select v_id, v_token;
end;
$$;

comment on function public.rotar_clave_api(uuid) is
  'F-API-01: rota una clave de API. La anterior vence en 24 h (D-3) y la nueva conserva nombre, alcances y límite.';

revoke execute on function public.rotar_clave_api(uuid) from public, anon;
grant execute on function public.rotar_clave_api(uuid) to authenticated;

-- ============================================================================
-- public.revocar_clave_api — efecto inmediato (FR-002): la siguiente llamada
-- responde 401.
-- ============================================================================

create or replace function public.revocar_clave_api(p_clave_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion_id uuid := (select private.organizacion_id());
begin
  if v_organizacion_id is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede revocar claves de API' using errcode = '42501';
  end if;

  update public.api_claves
     set revocada_en = coalesce(revocada_en, now())
   where public.api_claves.id = p_clave_id
     and organizacion_id = v_organizacion_id;

  if not found then
    raise exception 'La clave no existe' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.revocar_clave_api(uuid) is
  'F-API-01: revoca una clave de API de la organización (efecto inmediato: la siguiente llamada responde 401).';

revoke execute on function public.revocar_clave_api(uuid) from public, anon;
grant execute on function public.revocar_clave_api(uuid) to authenticated;
