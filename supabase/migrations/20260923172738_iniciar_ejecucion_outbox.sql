-- La creación manual de una ejecución y de su orden de despacho comparten
-- transacción. No hay trigger ni efecto externo: Kestra reclama la orden luego.
-- Reversión: restaurar el cuerpo de iniciar_ejecucion_worker de
-- 20260923120000_detalle_inicio_ejecucion.sql.

create or replace function public.iniciar_ejecucion_worker(
  p_conexion_id uuid,
  p_clave_capacidad text,
  p_origen text,
  p_actor uuid default null,
  p_detalle jsonb default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conexion public.conexiones;
  v_capacidad public.capacidades_ejecucion;
  v_nueva_id uuid;
begin
  if p_origen not in ('manual', 'programada', 'kestra') then
    raise exception 'ORIGEN_INVALIDO: % no es manual, programada ni kestra', p_origen using errcode = 'P0001';
  end if;
  if p_origen = 'manual' and p_actor is null then
    raise exception 'ACTOR_REQUERIDO: un disparo manual debe registrar quién lo inició' using errcode = 'P0001';
  end if;

  select * into v_conexion from public.conexiones c where c.id = p_conexion_id;
  if not found then
    raise exception 'CONEXION_DESCONOCIDA: %', p_conexion_id using errcode = 'P0001';
  end if;
  select * into v_capacidad from public.capacidades_ejecucion cap
  where cap.conexion_id = p_conexion_id and cap.clave = p_clave_capacidad;
  if not found or not v_capacidad.habilitada or v_conexion.estado <> 'activa' then
    raise exception 'CAPACIDAD_NO_HABILITADA: % no está registrada y habilitada para la conexión %', p_clave_capacidad, p_conexion_id using errcode = 'P0001';
  end if;

  perform private.autorizar_llamante_ciclo(v_conexion.organizacion_id);
  update public.ejecuciones_worker e
  set estado = 'timeout', finalizada_en = clock_timestamp(),
      motivo_sanitizado = 'TIMEOUT:' || v_capacidad.tiempo_max_seg || 's'
  where e.organizacion_id = v_conexion.organizacion_id
    and e.capacidad_id = v_capacidad.id
    and e.estado = 'en_curso'
    and e.iniciada_en < clock_timestamp() - make_interval(secs => v_capacidad.tiempo_max_seg);
  if exists (
    select 1 from public.ejecuciones_worker e
    where e.organizacion_id = v_conexion.organizacion_id
      and e.capacidad_id = v_capacidad.id and e.estado = 'en_curso'
  ) then
    raise exception 'YA_EN_CURSO: ya hay una ejecución activa para esta organización y capacidad' using errcode = 'P0001';
  end if;

  insert into public.ejecuciones_worker (organizacion_id, conexion_id, capacidad_id, origen, actor, detalle)
  values (v_conexion.organizacion_id, p_conexion_id, v_capacidad.id, p_origen,
    case when p_origen = 'manual' then p_actor else null end,
    coalesce(p_detalle, '{}'::jsonb))
  returning id into v_nueva_id;

  if p_origen = 'manual' then
    insert into public.despachos_ejecucion (ejecucion_id, organizacion_id)
    values (v_nueva_id, v_conexion.organizacion_id);
  end if;

  return v_nueva_id;
end;
$$;

comment on function public.iniciar_ejecucion_worker(uuid, text, text, uuid, jsonb) is
  'Contrato: specs/019-outbox-ejecuciones/contracts/despacho-outbox.md. El inicio manual persiste ejecución y orden de despacho en la misma transacción; no realiza HTTP ni llama a Kestra. Orígenes programada y kestra no generan una orden para evitar recursión de despacho.';
