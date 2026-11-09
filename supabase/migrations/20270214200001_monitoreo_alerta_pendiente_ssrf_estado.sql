-- MSF-369 · F-OPS-03 (hallazgos de la revisión retroactiva). Esquema: `public`. Migración aditiva e idempotente.
--
-- 1. Alerta «pendiente de notificar»: `evaluar_monitoreo` ya no marca `notificada_en` al abrir la alerta (si el
--    webhook fallaba, soporte no se enteraba nunca). Ahora la alerta nace sin `notificada_en`, la función
--    devuelve las abiertas SIN notificar (nuevas y las que quedaron pendientes de corridas anteriores) y el flow
--    llama a `marcar_alerta_notificada(id)` DESPUÉS de enviar bien. Si el envío falla, se reintenta en la
--    próxima corrida. Cambia el tipo de retorno (agrega `alerta_id`), por eso se recrea la función.
-- 2. Una alerta `aplicacion` solo se resuelve con un `ok` posterior a su apertura (si el conteo del monitor
--    falla no hay `ok`, y no se resuelve sola); el fallo del propio monitor se registra como fuente
--    `aplicacion` con clave `monitor:<proyecto>` y alerta tras `p_fallos` fallos en la ventana.
-- 3. `tiendas_a_sondear` solo devuelve nombres DNS públicos (sin IP, `localhost` ni sufijos internos): el flow
--    hace un GET al dominio del tenant y no debe poder apuntar a la red interna (SSRF ciego).
-- 4. Vista `estado_tiendas_monitoreo` (solo superadmin): último chequeo por tienda y estado «caida» (RF-OPS-03-3).
--
-- Reversión (migración posterior): drop view public.estado_tiendas_monitoreo;
--   drop function public.marcar_alerta_notificada(uuid); y restaurar evaluar_monitoreo/tiendas_a_sondear de 20270211100012.

drop function if exists public.evaluar_monitoreo(integer, integer, integer);

create or replace function public.evaluar_monitoreo(
  p_ventana_min integer default 10,
  p_fallos integer default 5,
  p_cola_min integer default 15
)
returns table (alerta_id uuid, fuente text, clave text, organizacion_id uuid, motivo_sanitizado text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
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
    and not (m.fuente in ('tienda', 'aplicacion') and exists (
      select 1 from public.eventos_monitoreo ok
      where ok.fuente = m.fuente and ok.clave = m.clave and ok.resultado = 'ok' and ok.ocurrido_en > m.ocurrido_en))
  group by m.fuente, m.clave
  -- Aplicación: el flow ya contó contra el umbral y registra un único `fallo`; alcanza con uno. La excepción
  -- es el fallo del propio monitor (clave `monitor:…`): alerta tras p_fallos fallos seguidos.
  having count(*) >= case when m.fuente = 'aplicacion' and m.clave not like 'monitor:%' then 1 else p_fallos end;

  insert into pg_temp.condiciones_monitoreo
  select 'cola', d.id::text, d.organizacion_id,
    'orden de despacho sin avanzar hace ' || p_cola_min || ' min o más'
  from public.despachos_ejecucion d
  where d.estado in ('pendiente', 'reclamada')
    and d.updated_at <= now() - make_interval(mins => p_cola_min);

  -- Resuelve las abiertas que ya no cumplen la condición. Una `aplicacion` exige además un `ok` posterior a su
  -- apertura: si el monitor no pudo contar (no hay `ok`), la alerta no se resuelve sola.
  update public.alertas_monitoreo a
  set estado = 'resuelta', resuelta_en = now()
  where a.estado = 'abierta'
    and not exists (
      select 1 from pg_temp.condiciones_monitoreo k where k.fuente = a.fuente and k.clave = a.clave)
    and (a.fuente <> 'aplicacion' or exists (
      select 1 from public.eventos_monitoreo ok
      where ok.fuente = a.fuente and ok.clave = a.clave and ok.resultado = 'ok' and ok.ocurrido_en > a.abierta_en));

  -- Abre las nuevas (sin `notificada_en`; el índice único parcial deduplica).
  insert into public.alertas_monitoreo as a (fuente, clave, organizacion_id, motivo_sanitizado)
  select k.fuente, k.clave, k.organizacion_id, private.sanitizar_motivo_monitoreo(k.motivo)
  from pg_temp.condiciones_monitoreo k
  on conflict (fuente, clave) where estado = 'abierta' do nothing;

  -- Devuelve las pendientes de notificar: las recién abiertas y las que no se pudieron enviar antes.
  return query
  select a.id, a.fuente, a.clave, a.organizacion_id, a.motivo_sanitizado
  from public.alertas_monitoreo a
  where a.estado = 'abierta' and a.notificada_en is null
  order by a.abierta_en, a.id;
end;
$$;

create or replace function public.marcar_alerta_notificada(p_alerta_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filas integer;
begin
  if session_user not in ('kestra_orquestacion', 'postgres', 'supabase_admin')
    and not (select rolsuper from pg_catalog.pg_roles where rolname = session_user) then
    raise exception 'NO_AUTORIZADO: solo kestra_orquestacion marca alertas notificadas' using errcode = 'P0001';
  end if;
  update public.alertas_monitoreo set notificada_en = now()
  where id = p_alerta_id and notificada_en is null;
  get diagnostics v_filas = row_count;
  return v_filas > 0;
end;
$$;

comment on function public.evaluar_monitoreo(integer, integer, integer) is
  'MSF-369: abre/resuelve alertas por umbral (5 fallos en 10 min; cola 15 min) y devuelve las abiertas pendientes de notificar; el flow las marca con marcar_alerta_notificada tras enviarlas.';
comment on function public.marcar_alerta_notificada(uuid) is
  'MSF-369: marca una alerta como notificada (después de enviarla bien). Solo kestra_orquestacion. Devuelve false si ya estaba marcada o no existe.';

revoke all on function public.evaluar_monitoreo(integer, integer, integer) from public, anon, authenticated;
revoke all on function public.marcar_alerta_notificada(uuid) from public, anon, authenticated;
grant execute on function public.evaluar_monitoreo(integer, integer, integer) to kestra_orquestacion;
grant execute on function public.marcar_alerta_notificada(uuid) to kestra_orquestacion;

-- Solo nombres DNS públicos: al menos dos etiquetas, TLD alfabético (descarta IP decimal, hex y octal, puertos
-- y corchetes) y sin `localhost` ni sufijos de red interna.
-- Regla de «nombre DNS público sondeable» en un solo lugar (y probable por comportamiento en pgTAP): dos o más etiquetas
-- DNS válidas, el TLD empieza con letra (descarta IPs, 0x7f.1 y decimales), sin puerto, corchetes, unicode ni punto final,
-- y sin sufijos de red interna. No resuelve DNS: un nombre público que apunte a una IP privada se mitiga con el egress de Kestra.
create or replace function private.dominio_sondeable(p_dominio text)
returns boolean
language sql
immutable
set search_path = ''
as $f$
  select p_dominio is not null
    and lower(p_dominio) ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$'
    and lower(p_dominio) !~ '(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|private|arpa)$';
$f$;

revoke all on function private.dominio_sondeable(text) from public, anon, authenticated;

create or replace function public.tiendas_a_sondear()
returns table (dominio text, organizacion_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if session_user not in ('kestra_orquestacion', 'postgres', 'supabase_admin')
    and not (select rolsuper from pg_catalog.pg_roles where rolname = session_user) then
    raise exception 'NO_AUTORIZADO: solo kestra_orquestacion lista las tiendas a sondear' using errcode = 'P0001';
  end if;
  return query
  select t.dominio, t.organizacion_id from dominio.tiendas t
  where private.dominio_sondeable(t.dominio)
  order by t.dominio;
end;
$$;

revoke all on function public.tiendas_a_sondear() from public, anon, authenticated;
grant execute on function public.tiendas_a_sondear() to kestra_orquestacion;

-- Estado por tienda para soporte: último chequeo y «caida» si hay alerta abierta. security_invoker: aplica la RLS
-- de eventos_monitoreo/alertas_monitoreo (solo superadmin; el resto recibe 0 filas).
create or replace view public.estado_tiendas_monitoreo
with (security_invoker = true) as
select distinct on (e.clave)
  e.clave as dominio,
  e.organizacion_id,
  e.ocurrido_en as ultimo_chequeo_at,
  case when exists (
    select 1 from public.alertas_monitoreo a where a.fuente = 'tienda' and a.clave = e.clave and a.estado = 'abierta')
    then 'caida' when e.resultado = 'ok' then 'operativa' else 'con_fallos' end as estado,
  e.motivo_sanitizado as detalle
from public.eventos_monitoreo e
where e.fuente = 'tienda'
order by e.clave, e.ocurrido_en desc;

comment on view public.estado_tiendas_monitoreo is
  'MSF-369: último chequeo por tienda (caida / con_fallos / operativa). Solo superadmin por RLS de las tablas base.';
revoke all on table public.estado_tiendas_monitoreo from public, anon, authenticated;
grant select on table public.estado_tiendas_monitoreo to authenticated;
