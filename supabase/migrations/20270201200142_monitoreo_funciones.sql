-- MSF-369 · F-OPS-03 (épica MSF-206, FR-026 a FR-028, FR-031): registro de eventos y evaluación de umbrales.
-- Esquema: `public` (las llama Kestra por el rol técnico, no la app). La base calcula umbrales y deduplica;
-- Kestra solo sondea y notifica (Principio III). Ejecutables únicamente por `kestra_orquestacion`
-- (revoke a public, anon y authenticated).
--
-- `evaluar_monitoreo(p_ventana_min, p_fallos, p_cola_min)`:
--   · abre una alerta por (fuente, clave) con >= p_fallos fallos en la ventana (tienda, sincronizacion;
--     aplicacion con un fallo, porque el flow ya contó contra el umbral); sincronizacion se deriva de
--     ejecuciones_worker fallida/timeout por capacidad (clave `<organizacion_id>:<capacidad>`);
--   · abre una alerta `cola` por orden de despacho pendiente/reclamada sin avanzar p_cola_min minutos;
--   · resuelve las abiertas que dejaron de cumplir el umbral (tienda: último evento ok; el resto: ya no
--     hay condición);
--   · devuelve SOLO las alertas nuevas y las marca notificadas (idempotente: dos llamadas seguidas no repiten).
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.tiendas_a_sondear();
--   drop function public.evaluar_monitoreo(integer, integer, integer);
--   drop function public.registrar_evento_monitoreo(text, text, text, text, uuid);
--   drop function private.sanitizar_motivo_monitoreo(text);

create or replace function private.sanitizar_motivo_monitoreo(p_motivo text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(left(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(coalesce(p_motivo, ''),
            '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[correo]', 'g'),
          '(?i)bearer\s+\S+', '[token]', 'g'),
        '[A-Za-z0-9_-]{32,}', '[token]', 'g'),
      '\+?\d[\d\s().-]{6,}\d', '[numero]', 'g'),
    200), '');
$$;

revoke all on function private.sanitizar_motivo_monitoreo(text) from public, anon, authenticated;

create or replace function public.registrar_evento_monitoreo(
  p_fuente text,
  p_clave text,
  p_resultado text,
  p_motivo text default null,
  p_organizacion_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- postgres / supabase_admin no son superusuarios reales en Supabase: se admiten por nombre (mantenimiento y pgTAP).
  if session_user not in ('kestra_orquestacion', 'postgres', 'supabase_admin')
    and not (select rolsuper from pg_catalog.pg_roles where rolname = session_user) then
    raise exception 'NO_AUTORIZADO: solo kestra_orquestacion registra eventos de monitoreo' using errcode = 'P0001';
  end if;
  if p_fuente not in ('tienda', 'sincronizacion', 'cola', 'aplicacion') then
    raise exception 'FUENTE_INVALIDA: la fuente no es válida' using errcode = 'P0001';
  end if;
  if p_resultado not in ('ok', 'fallo') then
    raise exception 'RESULTADO_INVALIDO: el resultado debe ser ok o fallo' using errcode = 'P0001';
  end if;
  if p_clave is null or btrim(p_clave) = '' or length(p_clave) > 200 then
    raise exception 'CLAVE_INVALIDA: la clave es obligatoria (hasta 200 caracteres)' using errcode = 'P0001';
  end if;

  -- clock_timestamp() (no now()): dos eventos de la misma transacción conservan su orden.
  insert into public.eventos_monitoreo (organizacion_id, fuente, clave, resultado, motivo_sanitizado, ocurrido_en)
  values (p_organizacion_id, p_fuente, p_clave, p_resultado,
    case when p_resultado = 'fallo' then private.sanitizar_motivo_monitoreo(p_motivo) end, clock_timestamp());
end;
$$;

create or replace function public.evaluar_monitoreo(
  p_ventana_min integer default 10,
  p_fallos integer default 5,
  p_cola_min integer default 15
)
returns table (fuente text, clave text, organizacion_id uuid, motivo_sanitizado text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- postgres / supabase_admin no son superusuarios reales en Supabase: se admiten por nombre (mantenimiento y pgTAP).
  if session_user not in ('kestra_orquestacion', 'postgres', 'supabase_admin')
    and not (select rolsuper from pg_catalog.pg_roles where rolname = session_user) then
    raise exception 'NO_AUTORIZADO: solo kestra_orquestacion evalúa el monitoreo' using errcode = 'P0001';
  end if;
  if p_ventana_min is null or p_ventana_min < 1 or p_ventana_min > 1440
    or p_fallos is null or p_fallos < 1 or p_fallos > 1000
    or p_cola_min is null or p_cola_min < 1 or p_cola_min > 1440 then
    raise exception 'UMBRAL_INVALIDO: ventana 1–1440 min, fallos 1–1000, cola 1–1440 min' using errcode = 'P0001';
  end if;

  -- Una evaluación a la vez: dos ciclos solapados no abren la misma alerta dos veces.
  perform pg_advisory_xact_lock(hashtext('evaluar_monitoreo'));

  -- La sincronización se deriva del ciclo de ejecuciones: un evento `fallo` por ejecución terminada mal.
  insert into public.eventos_monitoreo (organizacion_id, fuente, clave, resultado, motivo_sanitizado, ocurrido_en)
  select e.organizacion_id, 'sincronizacion', e.organizacion_id::text || ':' || c.clave, 'fallo',
    private.sanitizar_motivo_monitoreo(e.motivo_sanitizado), e.finalizada_en
  from public.ejecuciones_worker e
  join public.capacidades_ejecucion c on c.id = e.capacidad_id
  where e.estado in ('fallida', 'timeout')
    and e.finalizada_en is not null
    and e.finalizada_en > now() - make_interval(mins => p_ventana_min)
    and not exists (
      select 1 from public.eventos_monitoreo m
      where m.fuente = 'sincronizacion' and m.clave = e.organizacion_id::text || ':' || c.clave
        and m.organizacion_id = e.organizacion_id and m.ocurrido_en = e.finalizada_en
    );

  -- Condiciones activas: fuente/clave que cruzan el umbral ahora.
  create temporary table if not exists pg_temp.condiciones_monitoreo (
    fuente text, clave text, organizacion_id uuid, motivo text
  ) on commit drop;
  truncate pg_temp.condiciones_monitoreo;

  insert into pg_temp.condiciones_monitoreo
  select m.fuente, m.clave, (array_agg(m.organizacion_id order by m.ocurrido_en desc))[1],
    count(*)::text || ' fallos en ' || p_ventana_min || ' min'
  from public.eventos_monitoreo m
  where m.resultado = 'fallo'
    and m.ocurrido_en > now() - make_interval(mins => p_ventana_min)
    -- Tienda y aplicación: un `ok` posterior al fallo corta la racha.
    and not (m.fuente in ('tienda', 'aplicacion') and exists (
      select 1 from public.eventos_monitoreo ok
      where ok.fuente = m.fuente and ok.clave = m.clave and ok.resultado = 'ok' and ok.ocurrido_en > m.ocurrido_en))
  group by m.fuente, m.clave
  -- Aplicación: el flow ya contó los eventos de la herramienta de errores contra el umbral y registra
  -- un único `fallo` cuando lo cruza (FR-033); alcanza con uno dentro de la ventana.
  having count(*) >= case when m.fuente = 'aplicacion' then 1 else p_fallos end;

  insert into pg_temp.condiciones_monitoreo
  select 'cola', d.id::text, d.organizacion_id,
    'orden de despacho sin avanzar hace ' || p_cola_min || ' min o más'
  from public.despachos_ejecucion d
  where d.estado in ('pendiente', 'reclamada')
    and d.updated_at <= now() - make_interval(mins => p_cola_min);

  -- Resuelve las abiertas que ya no cumplen la condición.
  update public.alertas_monitoreo a
  set estado = 'resuelta', resuelta_en = now()
  where a.estado = 'abierta'
    and not exists (
      select 1 from pg_temp.condiciones_monitoreo k where k.fuente = a.fuente and k.clave = a.clave);

  -- Abre las nuevas (el índice único parcial deduplica) y las devuelve ya notificadas.
  return query
  with nuevas as (
    insert into public.alertas_monitoreo as a (fuente, clave, organizacion_id, motivo_sanitizado, notificada_en)
    select k.fuente, k.clave, k.organizacion_id, private.sanitizar_motivo_monitoreo(k.motivo), now()
    from pg_temp.condiciones_monitoreo k
    on conflict (fuente, clave) where estado = 'abierta' do nothing
    returning a.fuente, a.clave, a.organizacion_id, a.motivo_sanitizado
  )
  select n.fuente, n.clave, n.organizacion_id, n.motivo_sanitizado from nuevas n;
end;
$$;

comment on function public.registrar_evento_monitoreo(text, text, text, text, uuid) is
  'MSF-369: registra un evento ok/fallo de una fuente. Solo kestra_orquestacion; el motivo se sanitiza en la base.';
comment on function public.evaluar_monitoreo(integer, integer, integer) is
  'MSF-369: abre/resuelve alertas por umbral (por defecto 5 fallos en 10 min; cola 15 min) y devuelve solo las nuevas ya marcadas notificadas.';

revoke all on function public.registrar_evento_monitoreo(text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.evaluar_monitoreo(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.registrar_evento_monitoreo(text, text, text, text, uuid) to kestra_orquestacion;
grant execute on function public.evaluar_monitoreo(integer, integer, integer) to kestra_orquestacion;

-- Lista las tiendas con dominio para el sondeo (FR-025). Se expone como función y no como grant sobre
-- `dominio.tiendas` para que el rol técnico no gane acceso de lectura al esquema de dominio.
create or replace function public.tiendas_a_sondear()
returns table (dominio text, organizacion_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- postgres / supabase_admin no son superusuarios reales en Supabase: se admiten por nombre (mantenimiento y pgTAP).
  if session_user not in ('kestra_orquestacion', 'postgres', 'supabase_admin')
    and not (select rolsuper from pg_catalog.pg_roles where rolname = session_user) then
    raise exception 'NO_AUTORIZADO: solo kestra_orquestacion lista las tiendas a sondear' using errcode = 'P0001';
  end if;
  return query
  select t.dominio, t.organizacion_id from dominio.tiendas t
  where t.dominio is not null and t.dominio <> ''
  order by t.dominio;
end;
$$;

comment on function public.tiendas_a_sondear() is
  'MSF-369: dominios de dominio.tiendas que sondea el flow monitoreo-salud-tiendas. Solo kestra_orquestacion.';
revoke all on function public.tiendas_a_sondear() from public, anon, authenticated;
grant execute on function public.tiendas_a_sondear() to kestra_orquestacion;
