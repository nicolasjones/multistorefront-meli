-- Transiciones con fencing por intento. Solo Kestra puede confirmar, liberar
-- o agotar el reclamo que todavía posee.

create or replace function private.resolver_despacho_ejecucion(
  p_despacho_id uuid,
  p_intento integer,
  p_accion text,
  p_motivo_sanitizado text default null,
  p_demora_seg integer default 60,
  p_max_intentos integer default 3
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare v_estado text;
begin
  if session_user <> 'kestra_orquestacion' then
    raise exception 'NO_AUTORIZADO: solo kestra_orquestacion resuelve despachos' using errcode = 'P0001';
  end if;
  if p_accion not in ('confirmar', 'liberar', 'agotar') or p_intento < 1
    or p_demora_seg < 1 or p_max_intentos < 1 then
    raise exception 'ARGUMENTO_INVALIDO' using errcode = 'P0001';
  end if;
  if p_motivo_sanitizado is not null and length(p_motivo_sanitizado) > 500 then
    raise exception 'MOTIVO_INVALIDO' using errcode = 'P0001';
  end if;

  if p_accion = 'confirmar' then
    update public.despachos_ejecucion set estado = 'completada', reclamada_en = null,
      vence_en = null, updated_at = clock_timestamp()
    where id = p_despacho_id and estado = 'reclamada' and intentos = p_intento
      and vence_en > clock_timestamp();
  elsif p_accion = 'agotar' then
    update public.despachos_ejecucion set estado = 'agotada', reclamada_en = null,
      vence_en = null, ultimo_error_sanitizado = coalesce(p_motivo_sanitizado, 'AGOTADO'), updated_at = clock_timestamp()
    where id = p_despacho_id and estado = 'reclamada' and intentos = p_intento;
  else
    update public.despachos_ejecucion set
      estado = case when intentos >= p_max_intentos then 'agotada' else 'pendiente' end,
      reclamada_en = null, vence_en = null,
      proximo_intento_en = case when intentos >= p_max_intentos then proximo_intento_en else clock_timestamp() + make_interval(secs => p_demora_seg) end,
      ultimo_error_sanitizado = coalesce(p_motivo_sanitizado, 'FALLA_TRANSITORIA'), updated_at = clock_timestamp()
    where id = p_despacho_id and estado = 'reclamada' and intentos = p_intento;
  end if;
  if not found then
    raise exception 'RECLAMO_NO_VIGENTE' using errcode = 'P0001';
  end if;
  select estado into v_estado from public.despachos_ejecucion where id = p_despacho_id;
  return v_estado;
end;
$$;

revoke execute on function private.resolver_despacho_ejecucion(uuid, integer, text, text, integer, integer) from public, anon, authenticated;
grant execute on function private.resolver_despacho_ejecucion(uuid, integer, text, text, integer, integer) to kestra_orquestacion;
