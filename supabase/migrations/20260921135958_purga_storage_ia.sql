-- Storage no admite DELETE directo por SQL: el runtime borra por Storage API
-- y confirma aquí la purga de metadatos sólo tras ese borrado idempotente.

create or replace function private.evidencias_ia_pendientes_purga(p_hasta timestamptz default clock_timestamp())
returns table (interaccion_id uuid, evidencia_path text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not pg_catalog.pg_has_role(session_user, 'workers_orquestacion', 'member') then raise exception 'Runtime no autorizado para IA' using errcode = '42501'; end if;
  return query select id, evidencia_path from public.ia_interacciones where evidencia_path is not null and purga_pendiente_en <= p_hasta order by purga_pendiente_en;
end;
$$;

create or replace function private.finalizar_purga_evidencias_ia(p_interacciones uuid[])
returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_cantidad integer;
begin
  if not pg_catalog.pg_has_role(session_user, 'workers_orquestacion', 'member') then raise exception 'Runtime no autorizado para IA' using errcode = '42501'; end if;
  delete from public.ia_eventos_interaccion where interaccion_id = any(p_interacciones);
  with actualizadas as (
    update public.ia_interacciones set evidencia_path = null, resultado_sanitizado = null, error_sanitizado = null
    where id = any(p_interacciones) and evidencia_path is not null returning id
  ) select count(*) into v_cantidad from actualizadas;
  return v_cantidad;
end;
$$;

revoke all on function private.evidencias_ia_pendientes_purga(timestamptz), private.finalizar_purga_evidencias_ia(uuid[]) from public, anon, authenticated, kestra_orquestacion;
grant execute on function private.evidencias_ia_pendientes_purga(timestamptz), private.finalizar_purga_evidencias_ia(uuid[]) to workers_orquestacion;
