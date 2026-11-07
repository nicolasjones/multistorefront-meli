-- MSF-354 (F-IMP-01, FR-008): si la ejecución de un proceso masivo termina `fallida` o `timeout` y el
-- proceso sigue abierto (el worker murió sin cerrarlo), pasa a `fallido`. No cambia `ejecuciones_worker`.
--
-- Esquemas (Principio VII): función en `private` (sin grants) y trigger sobre una tabla de plataforma.
-- Migración aditiva. Reversión (migración posterior):
--   drop trigger reconciliar_proceso_masivo on public.ejecuciones_worker;
--   drop function private.reconciliar_proceso_masivo();

create or replace function private.reconciliar_proceso_masivo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_registrados integer;
begin
  with cerrados as (
    update public.procesos_masivos p
    set estado = 'fallido', finalizado_en = clock_timestamp(),
        iniciado_en = coalesce(p.iniciado_en, clock_timestamp())
    where p.ejecucion_id = new.id and p.estado in ('pendiente', 'en_curso')
    returning p.id, p.organizacion_id
  ), motivos as (
    insert into public.procesos_masivos_errores (proceso_id, organizacion_id, motivo_sanitizado)
    select c.id, c.organizacion_id,
           coalesce(nullif(private.sanitizar_motivo_proceso(new.motivo_sanitizado), ''), 'La ejecución terminó con error')
    from cerrados c
    returning 1
  )
  select count(*) into v_registrados from motivos;
  return new;
end;
$$;

comment on function private.reconciliar_proceso_masivo() is
  'F-IMP-01 (FR-008): cierra como fallido el proceso abierto cuya ejecución termina fallida o timeout.';

revoke execute on function private.reconciliar_proceso_masivo() from public, anon, authenticated;

create trigger reconciliar_proceso_masivo
  after update of estado on public.ejecuciones_worker
  for each row
  when (new.estado in ('fallida', 'timeout') and old.estado is distinct from new.estado)
  execute function private.reconciliar_proceso_masivo();
