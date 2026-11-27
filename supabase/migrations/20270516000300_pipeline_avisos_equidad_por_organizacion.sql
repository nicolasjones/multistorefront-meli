-- MSF-840 (lote 101): equidad por organización en el pipeline de avisos y webhooks.
--
-- Problema: el reclamo de `public.cola_eventos` (`private.reclamar_eventos_interno`) y de `public.api_entregas`
-- (`private.api_reclamar_entregas`) ordenaba por antigüedad global. Una importación de 5.000 productos encola 5.000 eventos
-- `precio.actualizado` de UNA organización y, a 20 por corrida, las demás esperaban ~250 minutos detrás de ellos.
--
-- Qué hace: el lote se arma por rondas («round-robin»). Cada fila recibe su posición dentro de su organización
-- (`row_number() over (partition by organizacion_id order by antigüedad)`) y el lote toma primero todas las posiciones 1 de
-- todas las organizaciones, después las posiciones 2, etc. Con 2 organizaciones y un lote de 20, cada una recibe 10 aunque una
-- tenga 5.000 pendientes y la otra 12; si una tiene 3, esas 3 salen y el resto del lote es de la otra (no se desperdicia cupo).
-- Dentro de una organización se conserva el orden por antigüedad (FIFO). No cambia ninguna firma, resultado ni reintento.
--
-- Fuera de alcance (a medir con volumen real antes de decidirlo, ver docs/api-publica-webhooks.md): prioridad por tipo y equidad
-- por destino dentro de una organización (un destino lento sigue ocupando una de las 2 ranuras del flow).
--
-- Reversión (migración posterior): recrear las dos funciones con el orden global por antigüedad de las migraciones
-- 20261018180400_cola_eventos_interno.sql (`order by c.proximo_intento_en, c.created_at ... limit p_limite`) y
-- 20270302100000_api_seguimientos_msf233.sql (`order by d.proximo_intento_en, d.creada_en ... limit p_limite`).

create or replace function private.reclamar_eventos_interno(
  p_tipo text, p_limite integer default 10, p_duracion_reclamo_seg integer default 300, p_max_intentos integer default 3)
returns table (evento_id uuid, organizacion_id uuid, tipo text, clave_idempotencia text, carga jsonb, intento integer, vence_en timestamptz)
language plpgsql
security definer
set search_path = ''
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
  with elegidos as (
    -- Equidad por organización: primero la posición 1 de cada una, luego la 2, etc. (FIFO dentro de cada una).
    select r.id
      from (
        select k.id, k.proximo_intento_en, k.created_at,
               row_number() over (partition by k.organizacion_id order by k.proximo_intento_en, k.created_at, k.id) as ronda
          from public.cola_eventos k
         where k.tipo = p_tipo and k.estado = 'pendiente' and k.proximo_intento_en <= clock_timestamp()
      ) r
     order by r.ronda, r.proximo_intento_en, r.created_at, r.id
     limit p_limite
  ), candidatos as (
    select c.id from public.cola_eventos c
     where c.id in (select e.id from elegidos e) and c.estado = 'pendiente'
     order by c.proximo_intento_en, c.created_at, c.id
       for update skip locked
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

create or replace function private.api_reclamar_entregas(p_limite integer default 20, p_lease_seg integer default 300)
returns setof public.api_entregas
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limite is null or p_limite < 1 or p_limite > 100 then
    raise exception 'LIMITE_INVALIDO' using errcode = '22023';
  end if;
  if p_lease_seg is null or p_lease_seg < 1 or p_lease_seg > 3600 then
    raise exception 'DURACION_INVALIDA' using errcode = '22023';
  end if;

  -- Un reclamo vencido vuelve a estar disponible; si ya gastó los 5 intentos
  -- (D-6) queda agotada.
  update public.api_entregas d
     set estado = case when d.intentos >= 5 then 'agotada' else 'pendiente' end,
         reclamada_en = null, vence_en = null,
         proximo_intento_en = clock_timestamp(),
         ultimo_error_sanitizado = 'RECLAMO_VENCIDO',
         actualizada_en = clock_timestamp()
   where d.estado = 'reclamada' and d.vence_en <= clock_timestamp();

  return query
  with elegidas as (
    -- Equidad por organización (ver el encabezado). Una suscripción PAUSADA conserva sus entregas pendientes y las recibe al
    -- reactivarse (no se pierden ni se entregan mientras está pausada).
    select r.id
      from (
        select d.id, d.proximo_intento_en, d.creada_en,
               row_number() over (partition by d.organizacion_id order by d.proximo_intento_en, d.creada_en, d.id) as ronda
          from public.api_entregas d
          join public.api_suscripciones s on s.id = d.suscripcion_id and s.activa
         where d.estado = 'pendiente' and d.proximo_intento_en <= clock_timestamp()
      ) r
     order by r.ronda, r.proximo_intento_en, r.creada_en, r.id
     limit p_limite
  ), candidatas as (
    select d.id from public.api_entregas d
     where d.id in (select e.id from elegidas e) and d.estado = 'pendiente'
     order by d.proximo_intento_en, d.creada_en, d.id
       for update skip locked
  ), reclamadas as (
    update public.api_entregas d
       set estado = 'reclamada', intentos = d.intentos + 1,
           reclamada_en = clock_timestamp(),
           vence_en = clock_timestamp() + make_interval(secs => p_lease_seg),
           actualizada_en = clock_timestamp()
      from candidatas c where d.id = c.id
     returning d.*
  )
  select * from reclamadas;
end;
$$;
