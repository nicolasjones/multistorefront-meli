-- F-STK-04 (MSF-249, épica MSF-231): correcciones de la revisión del PR #154.
-- Esquema: sin tablas nuevas.
--  * `stock.actualizado`: `ocurrido_en` = clock_timestamp() dentro del disparador. `creado_en` es
--    now() (inicio de la transacción) y no es monótono por producto; el disparador corre bajo el
--    lock de la existencia, así que clock_timestamp() sí lo es y el consumidor puede ordenar por él.
--  * `reclamar_eventos`: un reclamo vencido con `intentos >= p_max_intentos` pasa a `agotada`
--    (antes se reintentaba sin fin). Se agrega el 4.º parámetro `p_max_intentos` (1–20, def. 3).
--  * `resolver_evento`: `p_max_intentos` acotado a 1–20 y la demora se calcula en bigint (sin desborde).
--
-- Migración aditiva (reemplaza funciones de la misma rama). Reversión: reaplicar el cuerpo de
-- 20261021161000 / 20261021161100 y `drop function private.reclamar_eventos(text, integer, integer, integer)`.

create or replace function private.emitir_stock_actualizado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.cola_eventos (organizacion_id, tipo, clave_idempotencia, carga)
  values (
    new.organizacion_id,
    'stock.actualizado',
    new.id::text,
    jsonb_build_object(
      'organizacion_id', new.organizacion_id,
      'producto_id', new.producto_id,
      'movimiento_id', new.id,
      'tipo_movimiento', new.tipo,
      'cantidad', new.saldo,
      'diferencia', new.diferencia,
      'ocurrido_en', clock_timestamp()
    )
  )
  on conflict (organizacion_id, tipo, clave_idempotencia) do nothing;
  return new;
end;
$$;

drop function if exists private.reclamar_eventos(text, integer, integer);

create or replace function private.reclamar_eventos(
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
  if not (select rolsuper from pg_catalog.pg_roles where rolname = session_user)
    and session_user <> 'kestra_orquestacion' then
    raise exception 'NO_AUTORIZADO: solo kestra_orquestacion reclama eventos' using errcode = 'P0001';
  end if;
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
      ultimo_error_sanitizado = coalesce(c.ultimo_error_sanitizado, 'RECLAMO_VENCIDO'),
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

create or replace function private.resolver_evento(
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
  if not (select rolsuper from pg_catalog.pg_roles where rolname = session_user)
    and session_user <> 'kestra_orquestacion' then
    raise exception 'NO_AUTORIZADO: solo kestra_orquestacion resuelve eventos' using errcode = 'P0001';
  end if;
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

revoke execute on function private.reclamar_eventos(text, integer, integer, integer) from public, anon, authenticated;
grant execute on function private.reclamar_eventos(text, integer, integer, integer) to kestra_orquestacion;
revoke execute on function private.resolver_evento(uuid, integer, text, text, integer, integer) from public, anon, authenticated;
grant execute on function private.resolver_evento(uuid, integer, text, text, integer, integer) to kestra_orquestacion;
