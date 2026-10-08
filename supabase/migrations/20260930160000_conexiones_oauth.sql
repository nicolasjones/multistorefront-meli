-- Conexiones OAuth de plataforma vía Nango (spec
-- 20260930-153545-conexiones-oauth-nango). Migración aditiva (Technology
-- Gates) — nada se destruye acá. Reversión, en orden inverso a como se crea:
--   drop function public.actualizar_integracion_oauth(uuid, boolean);
--   drop function public.registrar_integracion_oauth(text, text);
--   drop function public.marcar_conexion_oauth_invalida(uuid, text);
--   drop function public.confirmar_conexion_oauth(uuid);
--   drop function public.iniciar_conexion_oauth(uuid, uuid);
--   drop table eventos_conexion_oauth;
--   drop table conexiones_oauth;
--   drop table integraciones_oauth;
--
-- No modifica `conexiones` (spec 013): esa tabla sigue siendo exclusiva de
-- credenciales usuario/contraseña de negocio, con custodia en Vault. Acá no
-- hay ningún secreto que guardar — Nango self-hosted (infra/nango/) es la
-- única custodia del token de proveedor; esta migración solo lleva el
-- catálogo de integraciones y el bookkeeping de qué organización conectó
-- cuál, para RLS y auditoría (research.md R4).

-- ============================================================================
-- Tablas (data-model.md)
-- ============================================================================

create table integraciones_oauth (
  id uuid primary key default gen_random_uuid(),
  clave text not null unique,
  nombre text not null,
  habilitada boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table integraciones_oauth is
  'Catálogo de plataforma: proveedores OAuth dados de alta en el motor de autenticación compartido (Nango self-hosted). clave es el provider_config_key de Nango (p. ej. "google"). Alta/baja únicamente vía public.registrar_integracion_oauth/actualizar_integracion_oauth (superadmin) — agregar un proveedor nuevo no requiere una migración (FR-006).';

create table conexiones_oauth (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizaciones (id) on delete cascade,
  integracion_id uuid not null references integraciones_oauth (id) on delete restrict,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'activa', 'con_error')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organizacion_id, integracion_id)
);

comment on table conexiones_oauth is
  'Autorización OAuth de una organización para una integración (spec conexiones OAuth). id se reutiliza tal cual como connection_id de Nango — no existe columna de mapeo aparte ni columna de credencial: el token vive únicamente en nango-db. unique(organizacion_id, integracion_id) a propósito, distinto de "conexiones" (spec 013 permite varias por sistema externo): acá una conexión OAuth es un login en nombre de la organización, reautorizar reutiliza la misma fila/connection_id en vez de crear una nueva.';

create index conexiones_oauth_organizacion_id_idx on conexiones_oauth (organizacion_id);

create table eventos_conexion_oauth (
  id bigint generated always as identity primary key,
  conexion_id uuid not null references conexiones_oauth (id) on delete cascade,
  tipo text not null check (tipo in ('creada', 'reautorizada', 'invalidada')),
  actor uuid references auth.users (id) on delete set null,
  motivo text,
  created_at timestamptz not null default clock_timestamp()
);

comment on table eventos_conexion_oauth is
  'Auditoría mínima de cada conexión OAuth (Principio III), mismo criterio que "alertas" (spec 013). actor nulo cuando el evento lo produce un backend/worker sin sesión de usuario (siempre el caso de "invalidada"). motivo debe quedar sanitizado por quien llama — nunca el token ni la respuesta cruda del proveedor (contracts/obtener-token-oauth.md).';

create index eventos_conexion_oauth_conexion_id_id_idx on eventos_conexion_oauth (conexion_id, id desc);

-- ============================================================================
-- Funciones (schema public: alcanzables por PostgREST, mismo criterio que
-- crear_conexion/actualizar_credencial_conexion de spec 013 — ver su nota de
-- desvío: private es inalcanzable por supabaseClient.rpc(...))
-- ============================================================================

create or replace function public.iniciar_conexion_oauth(
  p_organizacion_id uuid,
  p_integracion_id uuid
)
returns public.conexiones_oauth
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_habilitada boolean;
  v_row public.conexiones_oauth;
begin
  if not (select private.es_administrador_de(p_organizacion_id)) then
    raise exception 'No puede gestionar conexiones de esta organización' using errcode = '42501';
  end if;

  select habilitada into v_habilitada from public.integraciones_oauth where id = p_integracion_id;

  if v_habilitada is null then
    raise exception 'La integración % no existe', p_integracion_id using errcode = 'P0002';
  end if;

  if not v_habilitada then
    raise exception 'La integración % no está habilitada', p_integracion_id using errcode = '42501';
  end if;

  -- Get-or-create: si ya existe la fila (unique organizacion_id+integracion_id),
  -- la devuelve tal cual (sin tocar estado/created_at) para que el frontend
  -- reutilice el mismo id/connection_id al reautorizar (contracts/conectar-oauth.md #5).
  insert into public.conexiones_oauth (organizacion_id, integracion_id, created_by)
  values (p_organizacion_id, p_integracion_id, (select auth.uid()))
  on conflict (organizacion_id, integracion_id)
    do update set organizacion_id = excluded.organizacion_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.iniciar_conexion_oauth(uuid, uuid) is
  'Contrato: specs/20260930-153545-conexiones-oauth-nango/contracts/conectar-oauth.md #2. Devuelve la fila (id = connection_id de Nango) para que el frontend inicie nango.auth(clave, id) con @nangohq/frontend.';

revoke execute on function public.iniciar_conexion_oauth(uuid, uuid) from public;
grant execute on function public.iniciar_conexion_oauth(uuid, uuid) to authenticated;

create or replace function public.confirmar_conexion_oauth(p_conexion_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion_id uuid;
  v_estado text;
begin
  select organizacion_id, estado into v_organizacion_id, v_estado
  from public.conexiones_oauth
  where id = p_conexion_id;

  if v_organizacion_id is null then
    raise exception 'La conexión % no existe', p_conexion_id using errcode = 'P0002';
  end if;

  if not (select private.es_administrador_de(v_organizacion_id)) then
    raise exception 'No puede gestionar conexiones de esta organización' using errcode = '42501';
  end if;

  update public.conexiones_oauth
  set estado = 'activa', updated_at = clock_timestamp()
  where id = p_conexion_id;

  insert into public.eventos_conexion_oauth (conexion_id, tipo, actor)
  values (p_conexion_id, case when v_estado = 'pendiente' then 'creada' else 'reautorizada' end, (select auth.uid()));
end;
$$;

comment on function public.confirmar_conexion_oauth(uuid) is
  'Contrato: specs/20260930-153545-conexiones-oauth-nango/contracts/conectar-oauth.md #3. Llamar únicamente cuando nango.auth(...) resolvió con éxito en el navegador — mismo nivel de confianza que crear_conexion (spec 013) para una acción reportada por quien la completó.';

revoke execute on function public.confirmar_conexion_oauth(uuid) from public;
grant execute on function public.confirmar_conexion_oauth(uuid) to authenticated;

create or replace function public.marcar_conexion_oauth_invalida(p_conexion_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conexiones_oauth
  set estado = 'con_error', updated_at = clock_timestamp()
  where id = p_conexion_id;

  if not found then
    raise exception 'La conexión % no existe', p_conexion_id using errcode = 'P0002';
  end if;

  insert into public.eventos_conexion_oauth (conexion_id, tipo, motivo)
  values (p_conexion_id, 'invalidada', p_motivo);
end;
$$;

comment on function public.marcar_conexion_oauth_invalida(uuid, text) is
  'Contrato: specs/20260930-153545-conexiones-oauth-nango/contracts/obtener-token-oauth.md (Paso 3). Uso esperado: el backend/worker de un producto derivado, autenticado con su propio service_role, cuando Nango no pudo refrescar el token. p_motivo debe llegar sanitizado (nunca el token ni la respuesta cruda del proveedor) — responsabilidad del llamador, mismo criterio que contracts/ejecucion-segura.md (spec 014). Sin GRANT a authenticated a propósito (mismo criterio que private.marcar_conexion_credencial_invalida de spec 013): esta función reporta un fallo detectado por un backend, no una acción de una persona.';

revoke execute on function public.marcar_conexion_oauth_invalida(uuid, text) from public, authenticated, anon;
grant execute on function public.marcar_conexion_oauth_invalida(uuid, text) to service_role;

create or replace function public.registrar_integracion_oauth(p_clave text, p_nombre text)
returns public.integraciones_oauth
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.integraciones_oauth;
begin
  if not (select private.is_superadmin()) then
    raise exception 'Requiere superadmin' using errcode = '42501';
  end if;

  insert into public.integraciones_oauth (clave, nombre)
  values (p_clave, p_nombre)
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.registrar_integracion_oauth(text, text) is
  'Alta de un tipo de integración OAuth en el catálogo de plataforma (Historia 4). No crea nada en Nango: eso se hace en su dashboard antes de llamar esta función (infra/nango/README.md). Superadmin únicamente.';

revoke execute on function public.registrar_integracion_oauth(text, text) from public;
grant execute on function public.registrar_integracion_oauth(text, text) to authenticated;

create or replace function public.actualizar_integracion_oauth(p_integracion_id uuid, p_habilitada boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_superadmin()) then
    raise exception 'Requiere superadmin' using errcode = '42501';
  end if;

  update public.integraciones_oauth set habilitada = p_habilitada where id = p_integracion_id;

  if not found then
    raise exception 'La integración % no existe', p_integracion_id using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.actualizar_integracion_oauth(uuid, boolean) is
  'Habilita/deshabilita una integración para nuevas conexiones (Historia 4) — no afecta conexiones ya activas. Superadmin únicamente.';

revoke execute on function public.actualizar_integracion_oauth(uuid, boolean) from public;
grant execute on function public.actualizar_integracion_oauth(uuid, boolean) to authenticated;

-- ============================================================================
-- RLS
-- ============================================================================

alter table integraciones_oauth enable row level security;
alter table conexiones_oauth enable row level security;
alter table eventos_conexion_oauth enable row level security;

-- integraciones_oauth: catálogo de plataforma, no dato de una organización —
-- cualquier persona autenticada lo lee (para poblar la pantalla de
-- conexiones); solo superadmin lo escribe, y únicamente a través de las
-- funciones de arriba (sin policy de insert/update: sin GRANT de tabla para
-- esas operaciones, igual que conexiones en spec 013).
create policy integraciones_oauth_select on integraciones_oauth
  for select to authenticated
  using (true);

-- conexiones_oauth: mismo criterio de acceso que conexiones (FR-009 de spec
-- 013, aplicado por analogía) — administrador de esa organización o
-- superadmin. Sin policy de insert/update/delete: todo pasa por
-- iniciar_conexion_oauth/confirmar_conexion_oauth/marcar_conexion_oauth_invalida
-- (security definer, bypassan RLS como dueño de la tabla).
create policy conexiones_oauth_select on conexiones_oauth
  for select to authenticated
  using ((select private.es_administrador_de(organizacion_id)));

-- eventos_conexion_oauth: mismo criterio, vía join implícito a conexiones_oauth.
create policy eventos_conexion_oauth_select on eventos_conexion_oauth
  for select to authenticated
  using (
    exists (
      select 1 from public.conexiones_oauth c
      where c.id = eventos_conexion_oauth.conexion_id
        and (select private.es_administrador_de(c.organizacion_id))
    )
  );

-- ============================================================================
-- Grants (auto_expose_new_tables = false: hacen falta explícitos)
-- ============================================================================

revoke all on table integraciones_oauth from anon, authenticated;
grant select (id, clave, nombre, habilitada, created_at) on table integraciones_oauth to authenticated;

revoke all on table conexiones_oauth from anon, authenticated;
grant select (id, organizacion_id, integracion_id, estado, created_by, created_at, updated_at)
  on table conexiones_oauth to authenticated;

revoke all on table eventos_conexion_oauth from anon, authenticated;
grant select (id, conexion_id, tipo, actor, motivo, created_at) on table eventos_conexion_oauth to authenticated;
