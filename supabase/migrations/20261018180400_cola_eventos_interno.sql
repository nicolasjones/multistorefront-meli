-- F-STK-04 (MSF-249, épica MSF-231): correcciones de la 2.ª revisión del PR #154 y del CI.
-- Esquema: sin tablas nuevas.
--  * La lógica de `reclamar_eventos` y `resolver_evento` pasa a `*_interno` (sin la guarda de rol);
--    las funciones públicas de `private` conservan la guarda de `session_user` y delegan. Motivo: en CI
--    `postgres` no es superusuario ni `kestra_orquestacion`, así que pgTAP no podía ejercitar la lógica
--    (precedente: orquestacion_multi_organizacion.test.sql). Las `*_interno` solo las ejecuta el dueño:
--    se les revoca todo a public, anon y authenticated y no se otorgan a nadie.
--  * Un reclamo vencido deja siempre `RECLAMO_VENCIDO` como motivo (antes conservaba un error viejo).
--
-- Migración aditiva. Reversión: `drop function private.reclamar_eventos_interno(text, integer, integer, integer);
-- drop function private.resolver_evento_interno(uuid, integer, text, text, integer, integer);` y reaplicar el
-- cuerpo de 20261018180300 para las dos funciones públicas.

create or replace function private.reclamar_eventos_interno(
  p_tipo text,
  p_limite integer default 10,
  p_duracion_reclamo_seg integer default 300,
  p_max_intentos integer default 3
)
returns table (
  evento_id uuid, organizacion_id uuid, tipo text, clave_idempotencia text,
  carga jsonb, intento integer, vence_en timestamptz
)
language plpgsql security definer set search_path = ''
as $$
begin
  if p_tipo is null or btrim(p_tipo) = '' then
    raise exception 'TIPO_INVALIDO: el tipo de evento es obligatorio' using errcode = 'P0001';
  end if;
  if p_limite is null or p_limite < 1 or p_limite > 100 then
    raise exception 'LIMITE_INVALIDO: el límite debe estar entre 1 y 100' using errcode = 'P0001';
  end if;
  if p_duracion_reclamo_seg is null or p_duracion_reclamo_seg < 1 or p_duracion_reclamo_seg > 3600 then
    raise exception 'DURACION_INVALIDA: la duración debe estar entre 1 y 3600 segundos' using errcode = 'P0001';
  end if;

  if p_max_intentos is null or p_max_intentos < 1 or p_max_intentos > 20 then
    raise exception 'MAX_INTENTOS_INVALIDO: el máximo de intentos debe estar entre 1 y 20' using errcode = 'P0001';
  end if;

  -- Un reclamo vencido vuelve a estar disponible, o pasa a agotada si ya gastó sus intentos.
  update public.cola_eventos c
  set estado = case when c.intentos >= p_max_intentos then 'agotada' else 'pendiente' end,
      reclamada_en = null, vence_en = null,
      proximo_intento_en = clock_timestamp(),
      ultimo_error_sanitizado = 'RECLAMO_VENCIDO',
      updated_at = clock_timestamp()
  where c.tipo = p_tipo and c.estado = 'reclamada' and c.vence_en <= clock_timestamp();

  return query
  with candidatos as (
    select c.id from public.cola_eventos c
    where c.tipo = p_tipo and c.estado = 'pendiente' and c.proximo_intento_en <= clock_timestamp()
    order by c.proximo_intento_en, c.created_at for update skip locked limit p_limite
  ), reclamados as (
    update public.cola_eventos c
    set estado = 'reclamada', intentos = c.intentos + 1,
        reclamada_en = clock_timestamp(),
        vence_en = clock_timestamp() + make_interval(secs => p_duracion_reclamo_seg),
        updated_at = clock_timestamp()
    from candidatos k where c.id = k.id
    returning c.id, c.organizacion_id, c.tipo, c.clave_idempotencia, c.carga, c.intentos, c.vence_en
  )
  select r.id, r.organizacion_id, r.tipo, r.clave_idempotencia, r.carga, r.intentos, r.vence_en
  from reclamados r;
end;
$$;
create or replace function private.resolver_evento_interno(
  p_evento_id uuid,
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
  if p_accion is null or p_accion not in ('confirmar', 'liberar', 'agotar')
    or p_intento is null or p_intento < 1
    or p_demora_seg is null or p_demora_seg < 1
    or p_max_intentos is null or p_max_intentos < 1 or p_max_intentos > 20 then
    raise exception 'ARGUMENTO_INVALIDO' using errcode = 'P0001';
  end if;
  if p_motivo_sanitizado is not null and length(p_motivo_sanitizado) > 500 then
    raise exception 'MOTIVO_INVALIDO' using errcode = 'P0001';
  end if;

  if p_accion = 'confirmar' then
    update public.cola_eventos set estado = 'completada', reclamada_en = null,
      vence_en = null, updated_at = clock_timestamp()
    where id = p_evento_id and estado = 'reclamada' and intentos = p_intento
      and vence_en > clock_timestamp();
  elsif p_accion = 'agotar' then
    update public.cola_eventos set estado = 'agotada', reclamada_en = null,
      vence_en = null, ultimo_error_sanitizado = coalesce(p_motivo_sanitizado, 'AGOTADO'),
      updated_at = clock_timestamp()
    where id = p_evento_id and estado = 'reclamada' and intentos = p_intento
      and vence_en > clock_timestamp();
  else
    update public.cola_eventos set
      estado = case when intentos >= p_max_intentos then 'agotada' else 'pendiente' end,
      reclamada_en = null, vence_en = null,
      proximo_intento_en = case when intentos >= p_max_intentos then proximo_intento_en
        else clock_timestamp() + make_interval(secs => p_demora_seg::bigint * power(2, least(intentos - 1, 30))::bigint) end,
      ultimo_error_sanitizado = coalesce(p_motivo_sanitizado, 'FALLA_TRANSITORIA'),
      updated_at = clock_timestamp()
    where id = p_evento_id and estado = 'reclamada' and intentos = p_intento
      and vence_en > clock_timestamp();
  end if;
  if not found then
    raise exception 'RECLAMO_NO_VIGENTE' using errcode = 'P0001';
  end if;
  select estado into v_estado from public.cola_eventos where id = p_evento_id;
  return v_estado;
end;
$$;
create or replace function private.reclamar_eventos(
  p_tipo text, p_limite integer default 10, p_duracion_reclamo_seg integer default 300, p_max_intentos integer default 3
)
returns table (
  evento_id uuid, organizacion_id uuid, tipo text, clave_idempotencia text,
  carga jsonb, intento integer, vence_en timestamptz
)
language plpgsql security definer set search_path = ''
as $$
begin
  if not (select rolsuper from pg_catalog.pg_roles where rolname = session_user)
    and session_user <> 'kestra_orquestacion' then
    raise exception 'NO_AUTORIZADO: solo kestra_orquestacion reclama eventos' using errcode = 'P0001';
  end if;
  return query select * from private.reclamar_eventos_interno(p_tipo, p_limite, p_duracion_reclamo_seg, p_max_intentos);
end;
$$;

create or replace function private.resolver_evento(
  p_evento_id uuid, p_intento integer, p_accion text, p_motivo_sanitizado text default null,
  p_demora_seg integer default 60, p_max_intentos integer default 3
)
returns text
language plpgsql security definer set search_path = ''
as $$
begin
  if not (select rolsuper from pg_catalog.pg_roles where rolname = session_user)
    and session_user <> 'kestra_orquestacion' then
    raise exception 'NO_AUTORIZADO: solo kestra_orquestacion resuelve eventos' using errcode = 'P0001';
  end if;
  return private.resolver_evento_interno(p_evento_id, p_intento, p_accion, p_motivo_sanitizado, p_demora_seg, p_max_intentos);
end;
$$;

revoke execute on function private.reclamar_eventos_interno(text, integer, integer, integer) from public, anon, authenticated;
revoke execute on function private.resolver_evento_interno(uuid, integer, text, text, integer, integer) from public, anon, authenticated;
revoke execute on function private.reclamar_eventos(text, integer, integer, integer) from public, anon, authenticated;
grant execute on function private.reclamar_eventos(text, integer, integer, integer) to kestra_orquestacion;
revoke execute on function private.resolver_evento(uuid, integer, text, text, integer, integer) from public, anon, authenticated;
grant execute on function private.resolver_evento(uuid, integer, text, text, integer, integer) to kestra_orquestacion;
