-- Outbox durable y aislada (spec 019 / T004).
-- Reversión: revoke grants/policy; drop indexes; drop table public.despachos_ejecucion.

create table public.despachos_ejecucion (
  id uuid primary key default gen_random_uuid(),
  ejecucion_id uuid not null unique references public.ejecuciones_worker (id) on delete cascade,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'reclamada', 'completada', 'agotada', 'cancelada')),
  intentos integer not null default 0 check (intentos >= 0),
  proximo_intento_en timestamptz not null default now(),
  reclamada_en timestamptz,
  vence_en timestamptz,
  ultimo_error_sanitizado text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((estado = 'reclamada' and reclamada_en is not null and vence_en is not null)
    or (estado <> 'reclamada' and reclamada_en is null and vence_en is null))
);

create index despachos_ejecucion_pendientes_idx on public.despachos_ejecucion (proximo_intento_en, created_at) where estado = 'pendiente';
create index despachos_ejecucion_reclamos_idx on public.despachos_ejecucion (vence_en) where estado = 'reclamada';

alter table public.despachos_ejecucion enable row level security;
create policy despachos_ejecucion_select on public.despachos_ejecucion for select to authenticated
  using ((select private.es_administrador_de(organizacion_id)));

revoke all on table public.despachos_ejecucion from public, anon, authenticated;
grant select (id, ejecucion_id, organizacion_id, estado, intentos, proximo_intento_en,
  reclamada_en, vence_en, ultimo_error_sanitizado, created_at, updated_at)
  on table public.despachos_ejecucion to authenticated;
