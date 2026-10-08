-- Orquestación multi-organización: clasificación de fallos desde Kestra.
-- Migración aditiva; no elimina ni modifica objetos existentes.

create or replace function private.procesar_falla_orquestacion(
  p_organizacion_id uuid,
  p_conexion_id uuid,
  p_motivo text
)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if coalesce(p_motivo, '') like '%CREDENCIAL_INVALIDA:%' then
    perform private.marcar_conexion_credencial_invalida(p_conexion_id, p_motivo);
    perform private.registrar_alerta('credencial', p_organizacion_id, p_conexion_id, p_motivo);
  else
    perform private.registrar_alerta('tecnica', p_organizacion_id, p_conexion_id, p_motivo);
  end if;
end;
$$;

revoke all on function private.procesar_falla_orquestacion(uuid, uuid, text) from public;
grant execute on function private.procesar_falla_orquestacion(uuid, uuid, text) to kestra_orquestacion;
