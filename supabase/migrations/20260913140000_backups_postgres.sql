-- Backups automáticos de la base de datos (spec 011). Reversión: sin
-- dependencias de ninguna otra spec, nada más que revertir en orden
-- inverso a como se crea acá —
--   drop function public.finalizar_respaldo_error(bigint, text);
--   drop function public.finalizar_respaldo_completado(bigint, bigint, text);
--   drop function public.iniciar_respaldo(text);
--   drop role kestra_backups;
--   drop table respaldos;

-- ============================================================================
-- Tabla
-- ============================================================================

create table respaldos (
  id bigint generated always as identity primary key,
  origen text not null check (origen in ('programado', 'manual')),
  estado text not null default 'en_progreso' check (estado in ('en_progreso', 'completado', 'error')),
  iniciado_en timestamptz not null default clock_timestamp(),
  finalizado_en timestamptz,
  tamano_bytes bigint,
  ubicacion text,
  motivo_error text,
  constraint respaldos_estado_consistente check (
    (estado = 'en_progreso' and finalizado_en is null
      and tamano_bytes is null and ubicacion is null and motivo_error is null)
    or (estado = 'completado' and finalizado_en is not null
      and tamano_bytes is not null and ubicacion is not null and motivo_error is null)
    or (estado = 'error' and finalizado_en is not null and motivo_error is not null)
  )
);

comment on table respaldos is
  'Historial de respaldos completos de la base (spec 011). Escrita únicamente por Kestra (rol kestra_backups) vía las 3 funciones de abajo — nunca por un authenticated. Ver data-model.md.';

-- Respaldo a nivel de base de datos del chequeo que ya hace
-- iniciar_respaldo (FR-003): impide dos filas en_progreso simultáneas.
create unique index respaldos_un_solo_en_progreso
  on respaldos (estado)
  where estado = 'en_progreso';

-- ============================================================================
-- Rol de servicio para Kestra (research.md R1/R2)
-- ============================================================================

-- Sin ningún otro privilegio por defecto: ni siquiera SELECT directo sobre
-- respaldos. Solo lo que las "grant execute" de abajo le otorguen.
-- Contraseña placeholder — nunca un valor real acá, se rota por entorno
-- con "alter role kestra_backups with password '...'" usando
-- KESTRA_BACKUPS_DB_PASSWORD (research.md R8, documentado en quickstart.md).
-- Guardado con chequeo de pg_roles: los roles son objetos de clúster, no de
-- schema, así que "supabase db reset" (pnpm db:reset:ci) no los borra al
-- recrear el schema public. Sin este chequeo, correr la migración dos veces
-- sobre el mismo clúster (como pasa en runners self-hosted con Postgres
-- persistente entre jobs de CI) falla con "role already exists".
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'kestra_backups'
  ) then
    create role kestra_backups with login password 'reemplazar-por-entorno';
  end if;
end
$$;

comment on role kestra_backups is
  'Rol de mínimo privilegio para la conexión JDBC directa de Kestra (spec 011) — no pasa por PostgREST/Supabase Auth, por eso no tiene auth.uid() ni le aplica private.is_superadmin() (research.md R2). Solo EXECUTE sobre iniciar_respaldo/finalizar_respaldo_completado/finalizar_respaldo_error.';

-- ============================================================================
-- Funciones (public, security definer, search_path = '')
-- ============================================================================

create or replace function public.iniciar_respaldo(p_origen text)
returns public.respaldos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_respaldo public.respaldos;
begin
  if p_origen not in ('programado', 'manual') then
    raise exception 'Origen de respaldo inválido: %', p_origen using errcode = '22023';
  end if;

  -- Auto-sanar una fila colgada por una caída real del proceso
  -- (research.md R5) antes de intentar arrancar un backup nuevo — si no,
  -- el índice único de más abajo bloquearía todo backup futuro para
  -- siempre.
  update public.respaldos
    set estado = 'error',
        finalizado_en = clock_timestamp(),
        motivo_error = 'Backup interrumpido: quedó en progreso más de 3 horas sin resolverse (probable caída del proceso que lo ejecutaba).'
    where estado = 'en_progreso'
      and iniciado_en < clock_timestamp() - interval '3 hours';

  begin
    insert into public.respaldos (origen, estado, iniciado_en)
    values (p_origen, 'en_progreso', clock_timestamp())
    returning * into v_respaldo;
  exception
    when unique_violation then
      raise exception 'Ya hay un respaldo en progreso' using errcode = '55006';
  end;

  return v_respaldo;
end;
$$;

comment on function public.iniciar_respaldo(text) is
  'Contrato: specs/011-backups-postgres/contracts/respaldo-postgres.md. Primer paso de todo flow de backup (programado o manual). Si ya hay uno en progreso (no vencido), corta con errcode 55006 y el flow debe terminar ahí, sin ejecutar pg_dump (FR-003).';

revoke execute on function public.iniciar_respaldo(text) from public, authenticated, anon;
grant execute on function public.iniciar_respaldo(text) to kestra_backups;

create or replace function public.finalizar_respaldo_completado(
  p_id bigint,
  p_tamano_bytes bigint,
  p_ubicacion text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.respaldos
  set estado = 'completado',
      finalizado_en = clock_timestamp(),
      tamano_bytes = p_tamano_bytes,
      ubicacion = p_ubicacion
  where id = p_id and estado = 'en_progreso';
$$;

comment on function public.finalizar_respaldo_completado(bigint, bigint, text) is
  'Contrato: specs/011-backups-postgres/contracts/respaldo-postgres.md. No-op si la fila no está en_progreso (evita pisar un estado ya resuelto).';

revoke execute on function public.finalizar_respaldo_completado(bigint, bigint, text) from public, authenticated, anon;
grant execute on function public.finalizar_respaldo_completado(bigint, bigint, text) to kestra_backups;

create or replace function public.finalizar_respaldo_error(p_id bigint, p_motivo text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.respaldos
  set estado = 'error',
      finalizado_en = clock_timestamp(),
      motivo_error = p_motivo
  where id = p_id and estado = 'en_progreso';
$$;

comment on function public.finalizar_respaldo_error(bigint, text) is
  'Contrato: specs/011-backups-postgres/contracts/respaldo-postgres.md. Llamada desde el bloque errors: del flow (FR-006, FR-008) — cualquier falla en cualquier paso termina acá, nunca deja la fila en en_progreso.';

revoke execute on function public.finalizar_respaldo_error(bigint, text) from public, authenticated, anon;
grant execute on function public.finalizar_respaldo_error(bigint, text) to kestra_backups;

-- ============================================================================
-- RLS
-- ============================================================================

alter table respaldos enable row level security;

-- Sin policy de insert/update/delete para authenticated ni anon: las
-- únicas mutaciones posibles son las 3 funciones de arriba, y solo
-- kestra_backups puede ejecutarlas (FR-011). Ningún rol de organización
-- puede ver esta tabla, ni siquiera indirectamente.
create policy respaldos_select on respaldos
  for select to authenticated
  using ((select private.is_superadmin()));

-- ============================================================================
-- Grants (auto_expose_new_tables = false: hace falta explícito)
-- ============================================================================

revoke all on table respaldos from anon, authenticated;
grant select on table respaldos to authenticated;
