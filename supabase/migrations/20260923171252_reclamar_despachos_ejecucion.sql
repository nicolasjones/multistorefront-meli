-- Reclamo exclusivo y recuperable de la outbox (spec 019 / T005).
-- Reversión: revoke execute on function private.reclamar_despachos_ejecucion(integer, integer)
-- from kestra_orquestacion; drop function private.reclamar_despachos_ejecucion(integer, integer);

create or replace function private.reclamar_despachos_ejecucion(
  p_limite integer default 10,
  p_duracion_reclamo_seg integer default 300
)
returns table (
  despacho_id uuid, ejecucion_id uuid, organizacion_id uuid, conexion_id uuid,
  clave_capacidad text, detalle jsonb, intento integer, vence_en timestamptz
)
language plpgsql security definer set search_path = ''
as $$
begin
  if not (select rolsuper from pg_catalog.pg_roles where rolname = session_user)
    and session_user <> 'kestra_orquestacion' then
    raise exception 'NO_AUTORIZADO: solo kestra_orquestacion reclama despachos' using errcode = 'P0001';
  end if;
  if p_limite is null or p_limite < 1 or p_limite > 100 then
    raise exception 'LIMITE_INVALIDO: el límite debe estar entre 1 y 100' using errcode = 'P0001';
  end if;
  if p_duracion_reclamo_seg is null or p_duracion_reclamo_seg < 1 or p_duracion_reclamo_seg > 3600 then
    raise exception 'DURACION_INVALIDA: la duración debe estar entre 1 y 3600 segundos' using errcode = 'P0001';
  end if;

  update public.despachos_ejecucion d
  set estado = 'pendiente', reclamada_en = null, vence_en = null,
      proximo_intento_en = clock_timestamp(),
      ultimo_error_sanitizado = coalesce(d.ultimo_error_sanitizado, 'RECLAMO_VENCIDO'),
      updated_at = clock_timestamp()
  where d.estado = 'reclamada' and d.vence_en <= clock_timestamp();

  return query
  with candidatos as (
    select d.id from public.despachos_ejecucion d
    where d.estado = 'pendiente' and d.proximo_intento_en <= clock_timestamp()
    order by d.proximo_intento_en, d.created_at for update skip locked limit p_limite
  ), reclamados as (
    update public.despachos_ejecucion d
    set estado = 'reclamada', intentos = d.intentos + 1,
        reclamada_en = clock_timestamp(),
        vence_en = clock_timestamp() + make_interval(secs => p_duracion_reclamo_seg),
        updated_at = clock_timestamp()
    from candidatos c where d.id = c.id
    returning d.id, d.ejecucion_id, d.organizacion_id, d.intentos, d.vence_en
  )
  select r.id, r.ejecucion_id, r.organizacion_id, e.conexion_id, c.clave,
         e.detalle, r.intentos, r.vence_en
  from reclamados r join public.ejecuciones_worker e on e.id = r.ejecucion_id
  join public.capacidades_ejecucion c on c.id = e.capacidad_id;
end;
$$;

revoke execute on function private.reclamar_despachos_ejecucion(integer, integer) from public, anon, authenticated;
grant execute on function private.reclamar_despachos_ejecucion(integer, integer) to kestra_orquestacion;
