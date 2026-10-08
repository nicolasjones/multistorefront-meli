-- Panel de funcionalidades por organización (spec 009). Reversión:
-- primero deshabilitar (borrar de organizaciones_features) toda fila que
-- dependa de una funcionalidad a retirar, después retirar RLS/RPCs/tablas
-- en orden inverso a como se crean acá. Conservar eventos_features hasta
-- exportar o eliminar explícitamente su historial.

-- ============================================================================
-- Tablas
-- ============================================================================

create table features (
  id text primary key,
  nombre text not null,
  descripcion text,
  creado_por uuid references auth.users (id) on delete set null,
  creado_en timestamptz not null default now(),
  constraint features_id_formato check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

comment on table features is
  'Catálogo genérico de funcionalidades activables por organización. Arranca vacío: cada funcionalidad real se registra a sí misma vía su propia migración (registrar_feature), nunca por una pantalla. Ver data-model.md.';

create table organizaciones_features (
  feature_id text not null references features (id) on delete cascade,
  organizacion_id uuid not null references organizaciones (id) on delete cascade,
  habilitado_por uuid not null references auth.users (id) on delete cascade,
  habilitado_en timestamptz not null default now(),
  primary key (feature_id, organizacion_id)
);

comment on table organizaciones_features is
  'Toggle directo de una funcionalidad para una organización puntual. Sin fila = deshabilitada (fail-closed, FR-003). Borrar la fila es deshabilitar.';

create table eventos_features (
  id bigint generated always as identity primary key,
  feature_id text not null references features (id) on delete cascade,
  organizacion_id uuid references organizaciones (id) on delete cascade,
  actor_user_id uuid not null references auth.users (id) on delete cascade,
  accion text not null check (
    accion in ('feature_registrada', 'habilitada', 'deshabilitada')
  ),
  detalle jsonb,
  created_at timestamptz not null default clock_timestamp()
);

comment on table eventos_features is
  'Auditoría append-only de altas de catálogo y cambios de habilitación (FR-005, SC-003). organizacion_id nulo en eventos de catálogo.';

create index eventos_features_feature_id_id_idx on eventos_features (feature_id, id desc);

-- ============================================================================
-- Funciones private (security definer, search_path = '')
-- ============================================================================

-- "¿Mi organización activa tiene esta funcionalidad habilitada?" (FR-006).
-- Único punto que una funcionalidad futura debe llamar desde su propio RLS
-- (using (private.tiene_feature('mi-feature') and ...)) — no solo para
-- ocultar UI, también como control real de datos.
create or replace function private.tiene_feature(p_feature_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organizaciones_features of
    where of.feature_id = p_feature_id
      and of.organizacion_id = (select private.organizacion_id())
  );
$$;

comment on function private.tiene_feature(text) is
  'Contrato: specs/009-panel-de-funcionalidades/data-model.md. Resuelve la organización activa (private.organizacion_id()) — un superadmin sin organización activa siempre da false (FR-009).';

-- "¿Puedo ver ESTA fila puntual de organizaciones_features?" — compara el
-- organizacion_id de la FILA, no la de "acceso en general". Nunca
-- reemplazar por tiene_feature() acá: mismo tipo de bug de aislamiento
-- multi-tenant real que ya se encontró y corrigió en la spec 007
-- (puede_ver_reporte vs puede_ver_asignacion, ver data-model.md de esa
-- spec) — una función pensada para "tengo acceso en general" no filtra
-- fila por fila cuando la tabla tiene una fila por organización.
create or replace function private.puede_ver_feature_organizacion(
  p_feature_id text,
  p_organizacion_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_organizacion_id = (select private.organizacion_id())
    and exists (
      select 1 from public.organizaciones_features of
      where of.feature_id = p_feature_id
        and of.organizacion_id = p_organizacion_id
    );
$$;

comment on function private.puede_ver_feature_organizacion(text, uuid) is
  'Contrato: specs/009-panel-de-funcionalidades/data-model.md. No reemplazar por private.tiene_feature() — ver research.md #6.';

-- ============================================================================
-- RPCs (public, security definer, search_path = '')
-- ============================================================================

create or replace function public.registrar_feature(
  p_id text,
  p_nombre text,
  p_descripcion text default null
)
returns public.features
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_feature public.features;
begin
  if not (select private.is_superadmin()) then
    raise exception 'Solo un superadmin puede registrar funcionalidades' using errcode = '42501';
  end if;

  if p_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'El id de la funcionalidad debe ser minúsculas, números y guiones (ej. "mi-feature")' using errcode = '22023';
  end if;

  insert into public.features (id, nombre, descripcion, creado_por)
  values (p_id, p_nombre, p_descripcion, (select auth.uid()))
  returning * into v_feature;

  insert into public.eventos_features (feature_id, actor_user_id, accion)
  values (v_feature.id, (select auth.uid()), 'feature_registrada');

  return v_feature;
end;
$$;

comment on function public.registrar_feature(text, text, text) is
  'Contrato: specs/009-panel-de-funcionalidades/contracts/gestion-funcionalidades.md. Se llama desde la migración de la funcionalidad real que la registra, nunca desde una pantalla (research.md #2). Un p_id repetido rompe por la PK a propósito — no es on conflict do nothing.';

revoke execute on function public.registrar_feature(text, text, text) from public;
grant execute on function public.registrar_feature(text, text, text) to authenticated;

create or replace function public.habilitar_feature(
  p_feature_id text,
  p_organizacion_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filas integer;
begin
  if not (select private.is_superadmin()) then
    raise exception 'Solo un superadmin puede habilitar funcionalidades' using errcode = '42501';
  end if;

  if not exists (select 1 from public.features where id = p_feature_id) then
    raise exception 'La funcionalidad % no existe', p_feature_id using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.organizaciones where id = p_organizacion_id) then
    raise exception 'La organización % no existe', p_organizacion_id using errcode = 'P0002';
  end if;

  insert into public.organizaciones_features (feature_id, organizacion_id, habilitado_por)
  values (p_feature_id, p_organizacion_id, (select auth.uid()))
  on conflict (feature_id, organizacion_id) do nothing;

  get diagnostics v_filas = row_count;

  -- Idempotente (Principio III): si ya estaba habilitada, no duplica el evento.
  if v_filas > 0 then
    insert into public.eventos_features (feature_id, organizacion_id, actor_user_id, accion)
    values (p_feature_id, p_organizacion_id, (select auth.uid()), 'habilitada');
  end if;
end;
$$;

comment on function public.habilitar_feature(text, uuid) is
  'Contrato: specs/009-panel-de-funcionalidades/contracts/gestion-funcionalidades.md.';

revoke execute on function public.habilitar_feature(text, uuid) from public;
grant execute on function public.habilitar_feature(text, uuid) to authenticated;

create or replace function public.deshabilitar_feature(
  p_feature_id text,
  p_organizacion_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filas integer;
begin
  if not (select private.is_superadmin()) then
    raise exception 'Solo un superadmin puede deshabilitar funcionalidades' using errcode = '42501';
  end if;

  delete from public.organizaciones_features
  where feature_id = p_feature_id and organizacion_id = p_organizacion_id;

  get diagnostics v_filas = row_count;

  if v_filas > 0 then
    insert into public.eventos_features (feature_id, organizacion_id, actor_user_id, accion)
    values (p_feature_id, p_organizacion_id, (select auth.uid()), 'deshabilitada');
  end if;
end;
$$;

comment on function public.deshabilitar_feature(text, uuid) is
  'Contrato: specs/009-panel-de-funcionalidades/contracts/gestion-funcionalidades.md. Deshabilitar algo ya deshabilitado es un no-op (Principio III) — no duplica el evento.';

revoke execute on function public.deshabilitar_feature(text, uuid) from public;
grant execute on function public.deshabilitar_feature(text, uuid) to authenticated;

create or replace function public.tiene_feature_publica(p_feature_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.tiene_feature(p_feature_id);
$$;

comment on function public.tiene_feature_publica(text) is
  'Contrato: specs/009-panel-de-funcionalidades/contracts/gestion-funcionalidades.md. Wrapper público de private.tiene_feature — el frontend no resuelve "organización efectiva" por su cuenta.';

revoke execute on function public.tiene_feature_publica(text) from public;
grant execute on function public.tiene_feature_publica(text) to authenticated;

-- ============================================================================
-- RLS
-- ============================================================================

alter table features enable row level security;
alter table organizaciones_features enable row level security;
alter table eventos_features enable row level security;

-- No abierto a cualquier authenticated: dejarlo así filtraría a cualquier
-- organización qué funcionalidades existen en el sistema aunque no las
-- tenga (research.md #4, FR-008).
create policy features_select on features
  for select to authenticated
  using (
    (select private.is_superadmin())
    or (select private.tiene_feature(features.id))
  );

-- Usa puede_ver_feature_organizacion (compara organizacion_id de la FILA),
-- nunca tiene_feature() acá — ver el comentario de esa función arriba.
create policy organizaciones_features_select on organizaciones_features
  for select to authenticated
  using (
    (select private.is_superadmin())
    or (select private.puede_ver_feature_organizacion(organizaciones_features.feature_id, organizaciones_features.organizacion_id))
  );

create policy eventos_features_select on eventos_features
  for select to authenticated
  using (
    (select private.is_superadmin())
    or (
      organizacion_id is not null
      and organizacion_id = (select private.organizacion_id())
      and (select private.puede_escribir())
    )
  );

-- ============================================================================
-- Grants (auto_expose_new_tables = false: hacen falta explícitos; patrón
-- endurecido de la spec 007 — solo select directo, mutaciones únicamente
-- vía las RPCs de arriba)
-- ============================================================================

revoke all on table features from anon, authenticated;
grant select on table features to authenticated;

revoke all on table organizaciones_features from anon, authenticated;
grant select on table organizaciones_features to authenticated;

revoke all on table eventos_features from anon, authenticated;
grant select on table eventos_features to authenticated;
