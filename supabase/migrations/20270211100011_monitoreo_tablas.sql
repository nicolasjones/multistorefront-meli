-- MSF-369 · F-OPS-03 (épica MSF-206, FR-024, FR-031): eventos y alertas de monitoreo.
-- Esquema: `public` — es infraestructura transversal de la plataforma (como `ejecuciones_worker` o
-- `respaldos`), no una entidad de negocio del producto (Principio VII).
-- RLS: lectura solo para el operador de plataforma (superadmin); sin escritura directa (solo funciones
-- que ejecuta `kestra_orquestacion`, ver la migración siguiente); `anon` sin ningún privilegio.
-- Los motivos se guardan ya sanitizados: nunca el error crudo ni datos personales.
--
-- Migración aditiva. Reversión (migración posterior, solo mientras no haya datos productivos):
--   drop table public.alertas_monitoreo;
--   drop table public.eventos_monitoreo;

create table public.eventos_monitoreo (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid references public.organizaciones (id) on delete cascade,
  fuente text not null check (fuente in ('tienda', 'sincronizacion', 'cola', 'aplicacion')),
  clave text not null check (length(clave) between 1 and 200),
  resultado text not null check (resultado in ('ok', 'fallo')),
  motivo_sanitizado text check (length(motivo_sanitizado) <= 200),
  ocurrido_en timestamptz not null default now()
);

create index eventos_monitoreo_fuente_clave_idx
  on public.eventos_monitoreo (fuente, clave, ocurrido_en desc);
create index eventos_monitoreo_organizacion_idx
  on public.eventos_monitoreo (organizacion_id) where organizacion_id is not null;

create table public.alertas_monitoreo (
  id uuid primary key default gen_random_uuid(),
  fuente text not null check (fuente in ('tienda', 'sincronizacion', 'cola', 'aplicacion')),
  clave text not null check (length(clave) between 1 and 200),
  organizacion_id uuid references public.organizaciones (id) on delete cascade,
  estado text not null default 'abierta' check (estado in ('abierta', 'resuelta')),
  motivo_sanitizado text check (length(motivo_sanitizado) <= 200),
  abierta_en timestamptz not null default now(),
  notificada_en timestamptz,
  resuelta_en timestamptz,
  check ((estado = 'resuelta') = (resuelta_en is not null))
);

-- Una sola alerta abierta por fuente y clave (FR-028): la base deduplica, no el flow.
create unique index alertas_monitoreo_abierta_unica
  on public.alertas_monitoreo (fuente, clave) where estado = 'abierta';
create index alertas_monitoreo_organizacion_idx
  on public.alertas_monitoreo (organizacion_id) where organizacion_id is not null;

comment on table public.eventos_monitoreo is
  'MSF-369 (F-OPS-03): resultado ok/fallo de una fuente monitoreada (tienda, sincronizacion, cola, aplicacion). Escritura solo por registrar_evento_monitoreo; lectura solo superadmin.';
comment on table public.alertas_monitoreo is
  'MSF-369 (F-OPS-03): una alerta abierta por (fuente, clave), notificada una vez; pasa a resuelta al normalizarse. Escritura solo por evaluar_monitoreo; lectura solo superadmin.';

alter table public.eventos_monitoreo enable row level security;
alter table public.alertas_monitoreo enable row level security;

create policy eventos_monitoreo_select on public.eventos_monitoreo for select to authenticated
  using ((select private.is_superadmin()));
create policy alertas_monitoreo_select on public.alertas_monitoreo for select to authenticated
  using ((select private.is_superadmin()));

revoke all on table public.eventos_monitoreo from public, anon, authenticated;
revoke all on table public.alertas_monitoreo from public, anon, authenticated;
grant select on table public.eventos_monitoreo to authenticated;
grant select on table public.alertas_monitoreo to authenticated;
