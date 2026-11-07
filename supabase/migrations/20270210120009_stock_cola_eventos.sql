-- F-STK-04 (MSF-249, épica MSF-231, FR-004, FR-007): cola durable de eventos de dominio.
--
-- Esquema (Principio VII): `public.cola_eventos` es infraestructura transversal de eventos
-- de dominio de la plataforma (no una entidad de negocio de Stock; la consumirán
-- integraciones de otros componentes) → `public`, igual que `despachos_ejecucion`.
-- No se reutiliza `despachos_ejecucion`: su `ejecucion_id` es `not null unique` hacia
-- `ejecuciones_worker` y no admite eventos sin ejecución. Se copia el modelo, no el código.
-- RLS: select solo del Administrador de la organización; sin políticas ni privilegios de
-- escritura para `authenticated` (la escribe solo el disparador); `anon` sin privilegios.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes los eventos pendientes):
--   drop table public.cola_eventos;

create table public.cola_eventos (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  tipo text not null check (btrim(tipo) <> ''),
  clave_idempotencia text not null check (btrim(clave_idempotencia) <> ''),
  carga jsonb not null,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'reclamada', 'completada', 'agotada')),
  intentos integer not null default 0 check (intentos >= 0),
  proximo_intento_en timestamptz not null default now(),
  reclamada_en timestamptz,
  vence_en timestamptz,
  ultimo_error_sanitizado text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organizacion_id, tipo, clave_idempotencia),
  check ((estado = 'reclamada' and reclamada_en is not null and vence_en is not null)
    or (estado <> 'reclamada' and reclamada_en is null and vence_en is null))
);

comment on table public.cola_eventos is
  'Cola durable de eventos de dominio (F-STK-04). La escribe solo el disparador; la consumirá un worker en Etapa 2.';

create index cola_eventos_pendientes_idx
  on public.cola_eventos (tipo, proximo_intento_en, created_at) where estado = 'pendiente';
create index cola_eventos_reclamos_idx
  on public.cola_eventos (vence_en) where estado = 'reclamada';

alter table public.cola_eventos enable row level security;

create policy cola_eventos_select on public.cola_eventos
  for select to authenticated
  using ((select private.es_administrador_de(organizacion_id)));

revoke all on table public.cola_eventos from public, anon, authenticated;
grant select (id, organizacion_id, tipo, clave_idempotencia, carga, estado, intentos,
  proximo_intento_en, reclamada_en, vence_en, ultimo_error_sanitizado, created_at, updated_at)
  on table public.cola_eventos to authenticated;
