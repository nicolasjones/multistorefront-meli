-- MSF-354 (F-IMP-01, FR-001, FR-002, FR-003, FR-010): registro genérico de procesos masivos
-- (importaciones y exportaciones) para el centro de importaciones.
--
-- Esquemas (Principio VII): `public`. Es una capacidad transversal de plataforma (la usan Catálogo,
-- Stock, Mercado Libre y la exportación total) y cuelga de `ejecuciones_worker`, también `public`.
-- RLS por organización: `select` solo para administradores de la organización (D-6); sin
-- insert/update/delete desde la app (solo funciones `security definer`); `anon` sin privilegios.
--
-- Migración aditiva. Reversión (migración posterior, solo mientras no haya datos productivos):
--   drop trigger proteger_proceso_masivo on public.procesos_masivos;
--   drop function private.proteger_proceso_masivo();
--   drop function private.sanitizar_motivo_proceso(text, boolean);
--   drop table public.procesos_masivos_errores;
--   drop table public.procesos_masivos;

-- ============================================================================
-- Sanitización del motivo (FR-006): defensa en profundidad en la base. Redacta formas de secreto,
-- correos y teléfonos y acota el largo; el worker nunca debe mandar el error crudo.
-- ============================================================================

create or replace function private.sanitizar_motivo_proceso(p_texto text, p_redactar_telefonos boolean default true)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(
    btrim(
      case when p_redactar_telefonos
        then regexp_replace(t.sin_correos, '\+?\d[\d\s().-]{6,}\d', '[teléfono]', 'g')
        else t.sin_correos
      end),
    300)
  from (
    select regexp_replace(
      regexp_replace(
        regexp_replace(regexp_replace(coalesce(p_texto, ''), '[[:cntrl:]]+', ' ', 'g'),
          '(api[_-]?key|bearer|session|passwd|password|pwd|secret|token)\s*[:=]\s*\S+', '[secreto]', 'gi'),
        'eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+|://[^/\s:]+:[^/\s@]+@|AKIA[0-9A-Z]{16}', '[secreto]', 'g'),
      '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[correo]', 'g') as sin_correos
  ) t;
$$;

comment on function private.sanitizar_motivo_proceso(text, boolean) is
  'F-IMP-01 (FR-006): texto de un proceso masivo sin secretos ni correos (y, por defecto, sin teléfonos), de hasta 300 caracteres.';

revoke execute on function private.sanitizar_motivo_proceso(text, boolean) from public, anon, authenticated;

-- ============================================================================
-- public.procesos_masivos
-- ============================================================================

create table if not exists public.procesos_masivos (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id uuid references dominio.empresas (id) on delete cascade,
  tipo text not null check (tipo in ('importacion', 'exportacion')),
  funcionalidad text not null check (length(btrim(funcionalidad)) between 1 and 80),
  nombre text not null check (length(btrim(nombre)) between 1 and 160),
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'en_curso', 'completado', 'con_errores', 'fallido', 'cancelado')),
  ejecucion_id uuid unique references public.ejecuciones_worker (id) on delete set null,
  solicitado_por uuid references auth.users (id) on delete set null,
  total integer check (total is null or total >= 0),
  procesados integer not null default 0 check (procesados >= 0),
  con_errores integer not null default 0 check (con_errores >= 0),
  cancelacion_solicitada boolean not null default false,
  creado_en timestamptz not null default now(),
  iniciado_en timestamptz,
  finalizado_en timestamptz,
  check (total is null or procesados <= total),
  check (finalizado_en is null or finalizado_en >= creado_en),
  check ((estado in ('pendiente', 'en_curso')) = (finalizado_en is null))
);

comment on table public.procesos_masivos is
  'F-IMP-01 (FR-001): carga o descarga masiva con su estado y avance, ligada a su ejecución auditable de worker. Lectura solo para administradores de la organización; escritura únicamente por las funciones *_proceso_masivo.';

create index if not exists procesos_masivos_listado_idx on public.procesos_masivos (organizacion_id, creado_en desc);
create index if not exists procesos_masivos_empresa_idx on public.procesos_masivos (empresa_id) where empresa_id is not null;
create index if not exists procesos_masivos_abiertos_idx on public.procesos_masivos (organizacion_id) where estado in ('pendiente', 'en_curso');
create index if not exists procesos_masivos_solicitado_por_idx on public.procesos_masivos (solicitado_por);

alter table public.procesos_masivos enable row level security;

drop policy if exists procesos_masivos_select on public.procesos_masivos;
create policy procesos_masivos_select on public.procesos_masivos for select to authenticated
  using ((select private.es_administrador_de(organizacion_id)));

revoke all on table public.procesos_masivos from public, anon, authenticated;
grant select (id, organizacion_id, empresa_id, tipo, funcionalidad, nombre, estado, ejecucion_id, solicitado_por,
  total, procesados, con_errores, cancelacion_solicitada, creado_en, iniciado_en, finalizado_en)
  on table public.procesos_masivos to authenticated;

-- Un estado terminal no vuelve atrás (FR-002): defensa en la base además de las funciones.
create or replace function private.proteger_proceso_masivo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.estado in ('completado', 'con_errores', 'fallido', 'cancelado') and new.estado is distinct from old.estado then
    raise exception 'PROCESO_TERMINADO: el proceso ya terminó y no puede cambiar de estado' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function private.proteger_proceso_masivo() from public, anon, authenticated;

drop trigger if exists proteger_proceso_masivo on public.procesos_masivos;
create trigger proteger_proceso_masivo
  before update of estado on public.procesos_masivos
  for each row execute function private.proteger_proceso_masivo();

-- ============================================================================
-- public.procesos_masivos_errores
-- ============================================================================

create table if not exists public.procesos_masivos_errores (
  id uuid primary key default gen_random_uuid(),
  proceso_id uuid not null references public.procesos_masivos (id) on delete cascade,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  fila integer check (fila is null or fila >= 0),
  referencia text check (referencia is null or length(referencia) <= 200),
  motivo_sanitizado text not null,
  creado_en timestamptz not null default now()
);

comment on table public.procesos_masivos_errores is
  'F-IMP-01 (FR-006): errores por fila de un proceso masivo (fila, referencia, motivo sanitizado). Con tope por proceso; `procesos_masivos.con_errores` cuenta todos.';

create index if not exists procesos_masivos_errores_proceso_idx on public.procesos_masivos_errores (proceso_id, fila, creado_en);
create index if not exists procesos_masivos_errores_organizacion_idx on public.procesos_masivos_errores (organizacion_id);

alter table public.procesos_masivos_errores enable row level security;

drop policy if exists procesos_masivos_errores_select on public.procesos_masivos_errores;
create policy procesos_masivos_errores_select on public.procesos_masivos_errores for select to authenticated
  using ((select private.es_administrador_de(organizacion_id)));

revoke all on table public.procesos_masivos_errores from public, anon, authenticated;
grant select (id, proceso_id, organizacion_id, fila, referencia, motivo_sanitizado, creado_en)
  on table public.procesos_masivos_errores to authenticated;
