-- Corrige la ambigüedad entre columnas de salida y columnas de la tabla.
create or replace function private.evidencias_ia_pendientes_purga(p_hasta timestamptz default clock_timestamp())
returns table (interaccion_id uuid, evidencia_path text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not pg_catalog.pg_has_role(session_user, 'workers_orquestacion', 'member') then raise exception 'Runtime no autorizado para IA' using errcode = '42501'; end if;
  return query
  select interaccion.id, interaccion.evidencia_path
  from public.ia_interacciones interaccion
  where interaccion.evidencia_path is not null and interaccion.purga_pendiente_en <= p_hasta
  order by interaccion.purga_pendiente_en;
end;
$$;
