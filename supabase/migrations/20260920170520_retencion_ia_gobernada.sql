-- Auditoría, resolución y retención de interacciones IA (spec 016, US3).

create or replace function private.registrar_evento_interaccion_ia(
  p_interaccion_id uuid,
  p_estado text,
  p_detalle_sanitizado jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_actual text; v_secuencia integer;
begin
  if not pg_catalog.pg_has_role(session_user, 'workers_orquestacion', 'member') and not private.is_superadmin() then raise exception 'Runtime no autorizado para IA' using errcode = '42501'; end if;
  if jsonb_typeof(p_detalle_sanitizado) <> 'object' then raise exception 'Detalle IA inválido' using errcode = '22023'; end if;
  select estado into v_actual from public.ia_interacciones where id = p_interaccion_id for update;
  if v_actual is null then raise exception 'Interacción IA inexistente' using errcode = '22023'; end if;
  if not ((v_actual = 'iniciada' and p_estado in ('preparando','rechazada','cancelada')) or (v_actual = 'preparando' and p_estado in ('invocando','rechazada','cancelada')) or (v_actual = 'invocando' and p_estado in ('respuesta_validada','fallida_tecnica','revision_humana','rechazada')) or (v_actual = 'respuesta_validada' and p_estado in ('completada','rechazada','revision_humana')) or (v_actual = 'revision_humana' and p_estado in ('completada','rechazada','cancelada'))) then raise exception 'Transición IA inválida' using errcode = '22023'; end if;
  select coalesce(max(secuencia), 0) + 1 into v_secuencia from public.ia_eventos_interaccion where interaccion_id = p_interaccion_id;
  insert into public.ia_eventos_interaccion (interaccion_id, secuencia, tipo, detalle_sanitizado) values (p_interaccion_id, v_secuencia, p_estado, p_detalle_sanitizado);
  update public.ia_interacciones set estado = p_estado, finalizada_en = case when p_estado in ('completada','rechazada','fallida_tecnica','cancelada') then clock_timestamp() else finalizada_en end, error_sanitizado = case when p_estado in ('rechazada','fallida_tecnica') then coalesce(p_detalle_sanitizado->>'motivo', error_sanitizado) else error_sanitizado end where id = p_interaccion_id;
end;
$$;

create or replace function private.purgar_evidencias_ia(p_hasta timestamptz default clock_timestamp())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_cantidad integer;
begin
  if not pg_catalog.pg_has_role(session_user, 'workers_orquestacion', 'member') then raise exception 'Runtime no autorizado para IA' using errcode = '42501'; end if;
  with vencidas as (
    select id, evidencia_path from public.ia_interacciones where evidencia_path is not null and purga_pendiente_en <= p_hasta for update
  ), objetos as (
    delete from storage.objects objeto using vencidas where objeto.bucket_id = 'ia-evidencias' and objeto.name = vencidas.evidencia_path
  ), eventos as (
    delete from public.ia_eventos_interaccion where interaccion_id in (select id from vencidas)
  ), actualizadas as (
    update public.ia_interacciones set evidencia_path = null, resultado_sanitizado = null, error_sanitizado = null where id in (select id from vencidas) returning id
  ) select count(*) into v_cantidad from actualizadas;
  return v_cantidad;
end;
$$;

create or replace function public.resolver_revision_ia(p_interaccion_id uuid, p_estado_final text, p_detalle_sanitizado jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_superadmin() then raise exception 'Solo el superadmin puede resolver revisiones IA' using errcode = '42501'; end if;
  if p_estado_final not in ('completada','rechazada','cancelada') then raise exception 'Estado final IA inválido' using errcode = '22023'; end if;
  perform private.registrar_evento_interaccion_ia(p_interaccion_id, p_estado_final, p_detalle_sanitizado);
end;
$$;

revoke all on function private.registrar_evento_interaccion_ia(uuid, text, jsonb), private.purgar_evidencias_ia(timestamptz) from public, anon, authenticated, kestra_orquestacion;
revoke all on function public.resolver_revision_ia(uuid, text, jsonb) from public, anon;
grant execute on function private.registrar_evento_interaccion_ia(uuid, text, jsonb), private.purgar_evidencias_ia(timestamptz) to workers_orquestacion;
grant execute on function public.resolver_revision_ia(uuid, text, jsonb) to authenticated;
