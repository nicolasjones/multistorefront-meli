-- MSF-369 · F-OPS-03 (épica MSF-206, revisión independiente QA y Code/Security): `evaluar_monitoreo` sin tormenta
-- de alertas y sin falsos positivos.
--
--   * MEDIO (tormenta): la fuente `cola` usaba `despachos_ejecucion.id` como clave, así que N órdenes trabadas
--     generaban N alertas. Ahora se agrupa por organización: una alerta `cola` por organización (clave = el id de la
--     organización) con la cantidad de órdenes en el motivo. Además cada corrida devuelve como máximo 20
--     notificaciones: las primeras 19 y una fila de resumen («y N alertas más abiertas»); las demás se marcan
--     notificadas (quedan visibles en `alertas_monitoreo`). Si Kestra pierde red y caen N tiendas a la vez, el webhook
--     recibe a lo sumo 20 envíos por corrida.
--   * MEDIO (falso positivo): cancelar un proceso pendiente cierra su ejecución `fallida` con motivo `CANCELADA`;
--     eso ya no se cuenta como fallo de sincronización.
--   * MEDIO (huérfanos): antes de evaluar se cierran por tiempo máximo las ejecuciones de procesos masivos que no
--     terminaron (`private.cerrar_procesos_masivos_vencidos`), así la UI no queda sondeando para siempre.
--
-- Misma firma y grants que 20270214200001 (`create or replace`); la fila de resumen lleva `alerta_id` nulo.
-- Esquemas (Principio VII): función en `public` sobre tablas de plataforma. Migración aditiva.
-- Reversión (migración posterior): restaurar el cuerpo de `evaluar_monitoreo` de 20270214200001.

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
declare
  c_max_notificaciones constant integer := 20;
  v_pendientes integer;
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

  -- Cierra por tiempo máximo las ejecuciones de procesos masivos que quedaron colgadas (antes de derivar eventos).
  perform private.cerrar_procesos_masivos_vencidos();

  -- Sincronización: un evento `fallo` por ejecución terminada mal. Una cancelación del usuario (`CANCELADA`) no es
  -- un fallo de sincronización.
  insert into public.eventos_monitoreo (organizacion_id, fuente, clave, resultado, motivo_sanitizado, ocurrido_en)
  select e.organizacion_id, 'sincronizacion', e.organizacion_id::text || ':' || c.clave, 'fallo',
    private.sanitizar_motivo_monitoreo(e.motivo_sanitizado), e.finalizada_en
  from public.ejecuciones_worker e
  join public.capacidades_ejecucion c on c.id = e.capacidad_id
  where e.estado in ('fallida', 'timeout')
    and e.finalizada_en is not null
    and e.motivo_sanitizado is distinct from 'CANCELADA'
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
  having count(*) >= case when m.fuente = 'aplicacion' and m.clave not like 'monitor:%' then 1 else p_fallos end;

  -- Cola: UNA condición por organización (no por orden), con la cantidad de órdenes que no avanzan.
  insert into pg_temp.condiciones_monitoreo
  select 'cola', d.organizacion_id::text, d.organizacion_id,
    count(*)::text || ' órdenes de despacho sin avanzar hace ' || p_cola_min || ' min o más'
  from public.despachos_ejecucion d
  where d.estado in ('pendiente', 'reclamada')
    and d.updated_at <= now() - make_interval(mins => p_cola_min)
  group by d.organizacion_id;

  update public.alertas_monitoreo a
  set estado = 'resuelta', resuelta_en = now()
  where a.estado = 'abierta'
    and not exists (
      select 1 from pg_temp.condiciones_monitoreo k where k.fuente = a.fuente and k.clave = a.clave)
    and (a.fuente <> 'aplicacion' or exists (
      select 1 from public.eventos_monitoreo ok
      where ok.fuente = a.fuente and ok.clave = a.clave and ok.resultado = 'ok' and ok.ocurrido_en > a.abierta_en));

  insert into public.alertas_monitoreo as a (fuente, clave, organizacion_id, motivo_sanitizado)
  select k.fuente, k.clave, k.organizacion_id, private.sanitizar_motivo_monitoreo(k.motivo)
  from pg_temp.condiciones_monitoreo k
  on conflict (fuente, clave) where estado = 'abierta' do nothing;

  -- Pendientes de notificar, con tope por corrida: hasta c_max_notificaciones - 1 alertas y un resumen del resto.
  select count(*) into v_pendientes
  from public.alertas_monitoreo a where a.estado = 'abierta' and a.notificada_en is null;

  if v_pendientes <= c_max_notificaciones then
    return query
    select a.id, a.fuente, a.clave, a.organizacion_id, a.motivo_sanitizado
    from public.alertas_monitoreo a
    where a.estado = 'abierta' and a.notificada_en is null
    order by a.abierta_en, a.id;
  else
    return query
    select a.id, a.fuente, a.clave, a.organizacion_id, a.motivo_sanitizado
    from public.alertas_monitoreo a
    where a.estado = 'abierta' and a.notificada_en is null
    order by a.abierta_en, a.id
    limit c_max_notificaciones - 1;

    -- El resto queda cubierto por el resumen (el detalle sigue en alertas_monitoreo).
    update public.alertas_monitoreo a
    set notificada_en = now()
    where a.id in (
      select r.id from public.alertas_monitoreo r
      where r.estado = 'abierta' and r.notificada_en is null
      order by r.abierta_en, r.id
      offset c_max_notificaciones - 1);

    return query
    select null::uuid, 'resumen'::text, 'resumen'::text, null::uuid,
      'y ' || (v_pendientes - (c_max_notificaciones - 1)) || ' alertas más abiertas (ver alertas_monitoreo)';
  end if;
end;
$$;

comment on function public.evaluar_monitoreo(integer, integer, integer) is
  'MSF-369: abre/resuelve alertas por umbral (5 fallos en 10 min; cola 15 min, una alerta por organización) y devuelve las pendientes de notificar, hasta 20 por corrida (la última puede ser un resumen con alerta_id nulo); el flow marca cada una con marcar_alerta_notificada tras enviarla. Las cancelaciones de usuario no cuentan como fallos.';

revoke all on function public.evaluar_monitoreo(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.evaluar_monitoreo(integer, integer, integer) to kestra_orquestacion;
