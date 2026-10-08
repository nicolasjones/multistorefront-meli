-- Generaliza iniciar_ejecucion_worker (spec 016) con un parámetro opcional
-- p_detalle. Motivador real: una capacidad con parámetros propios de la
-- corrida (ej. un rango de fechas elegido en el disparo manual) necesita
-- que ese dato viaje junto con el INSERT de ejecuciones_worker, no recién
-- al cerrar -- un trigger AFTER INSERT sobre esa tabla (para notificar a
-- un sistema externo del disparo, por ejemplo) dispara dentro del mismo
-- INSERT y no puede esperar a un UPDATE posterior para ver ese dato: un
-- UPDATE no reactiva un trigger de INSERT. cerrar_ejecucion_worker ya
-- acepta detalle al cerrar (spec 016 original); esto agrega el mismo campo
-- también al abrir, sin cambiar su semántica (extensible, sin secretos).
-- Compatible con las llamadas existentes de 3/4 argumentos (default '{}').
--
-- CREATE OR REPLACE con un parámetro nuevo crea un overload en vez de
-- reemplazar (Postgres identifica la función por su lista de tipos
-- declarados) -- por eso drop + create en vez de replace, con los grants
-- re-otorgados abajo. Reversión: repetir este mismo patrón (drop del
-- signature de 5 argumentos, create con el de 4) usando el cuerpo de
-- iniciar_ejecucion_worker de 20260920000000_ciclo_ejecuciones_workers.sql.

drop function public.iniciar_ejecucion_worker(uuid, text, text, uuid);

create function public.iniciar_ejecucion_worker(
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

  select * into v_capacidad
  from public.capacidades_ejecucion cap
  where cap.conexion_id = p_conexion_id and cap.clave = p_clave_capacidad;

  if not found or not v_capacidad.habilitada or v_conexion.estado <> 'activa' then
    raise exception 'CAPACIDAD_NO_HABILITADA: % no está registrada y habilitada para la conexión %', p_clave_capacidad, p_conexion_id using errcode = 'P0001';
  end if;

  perform private.autorizar_llamante_ciclo(v_conexion.organizacion_id);

  -- Cierre perezoso por timeout (R2): las vencidas quedan auditadas como
  -- timeout antes de que el nuevo intento continúe (FR-003/SC-002).
  update public.ejecuciones_worker e
  set estado = 'timeout',
      finalizada_en = clock_timestamp(),
      motivo_sanitizado = 'TIMEOUT:' || v_capacidad.tiempo_max_seg || 's'
  where e.organizacion_id = v_conexion.organizacion_id
    and e.capacidad_id = v_capacidad.id
    and e.estado = 'en_curso'
    and e.iniciada_en < clock_timestamp() - make_interval(secs => v_capacidad.tiempo_max_seg);

  if exists (
    select 1 from public.ejecuciones_worker e
    where e.organizacion_id = v_conexion.organizacion_id
      and e.capacidad_id = v_capacidad.id
      and e.estado = 'en_curso'
  ) then
    raise exception 'YA_EN_CURSO: ya hay una ejecución activa para esta organización y capacidad' using errcode = 'P0001';
  end if;

  insert into public.ejecuciones_worker (organizacion_id, conexion_id, capacidad_id, origen, actor, detalle)
  values (
    v_conexion.organizacion_id, p_conexion_id, v_capacidad.id, p_origen,
    case when p_origen = 'manual' then p_actor else null end,
    coalesce(p_detalle, '{}'::jsonb)
  )
  returning id into v_nueva_id;

  return v_nueva_id;
end;
$$;

comment on function public.iniciar_ejecucion_worker(uuid, text, text, uuid, jsonb) is
  'Contrato: specs/016-ciclo-ejecuciones-workers/contracts/ciclo-ejecuciones.md. Único punto de inicio (US1). Errores: ORIGEN_INVALIDO, ACTOR_REQUERIDO, CONEXION_DESCONOCIDA, CAPACIDAD_NO_HABILITADA, NO_AUTORIZADO, YA_EN_CURSO. p_detalle (extensible, sin secretos) queda disponible para un trigger AFTER INSERT sobre ejecuciones_worker desde el mismo INSERT. En public (no private): Refine la invoca vía supabaseClient.rpc — mismo criterio que crear_conexion (spec 013).';

revoke execute on function public.iniciar_ejecucion_worker(uuid, text, text, uuid, jsonb) from public, anon;
grant execute on function public.iniciar_ejecucion_worker(uuid, text, text, uuid, jsonb) to authenticated;
grant execute on function public.iniciar_ejecucion_worker(uuid, text, text, uuid, jsonb) to kestra_orquestacion;

-- Reconciliación para roles worker_* ya aprovisionados: el drop de arriba se
-- llevó su grant sobre la firma vieja: re-otorgar sobre la nueva.
do $$
declare
  r record;
begin
  for r in select rol_db from public.servidores_organizacion loop
    execute format('grant execute on function public.iniciar_ejecucion_worker(uuid, text, text, uuid, jsonb) to %I', r.rol_db);
  end loop;
end;
$$;

-- aprovisionar_servidor_organizacion (spec 013/016) debe otorgar sobre la
-- nueva firma a los roles worker_* que se aprovisionen de acá en más.
create or replace function public.aprovisionar_servidor_organizacion(
  p_organizacion_id uuid,
  p_host text,
  p_usuario_ssh text,
  p_credencial_ssh text,
  p_puerto integer default 22
)
returns table (
  id uuid,
  organizacion_id uuid,
  host text,
  puerto_ssh integer,
  usuario_ssh text,
  rol_db text,
  created_at timestamptz,
  password_rol text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rol_db text;
  v_password text;
  v_ssh_vault_id uuid;
  v_db_vault_id uuid;
  v_servidor public.servidores_organizacion;
begin
  if not (select private.is_superadmin()) then
    raise exception 'Solo un superadmin puede aprovisionar un servidor de organización' using errcode = '42501';
  end if;

  if not exists (select 1 from public.organizaciones o where o.id = p_organizacion_id) then
    raise exception 'La organización % no existe', p_organizacion_id using errcode = 'P0002';
  end if;

  if exists (select 1 from public.servidores_organizacion s where s.organizacion_id = p_organizacion_id) then
    raise exception 'La organización % ya tiene un servidor aprovisionado', p_organizacion_id using errcode = '23505';
  end if;

  v_rol_db := 'worker_' || replace(p_organizacion_id::text, '-', '');
  v_password := encode(extensions.gen_random_bytes(24), 'base64');

  execute format('create role %I login password %L', v_rol_db, v_password);
  execute format('grant usage on schema private to %I', v_rol_db);
  execute format('grant execute on function private.organizacion_del_rol_actual() to %I', v_rol_db);
  execute format('grant execute on function private.autorizar_llamante_ciclo(uuid) to %I', v_rol_db);
  execute format('grant workers_orquestacion to %I', v_rol_db);
  execute format('grant execute on function public.iniciar_ejecucion_worker(uuid, text, text, uuid, jsonb) to %I', v_rol_db);
  execute format('grant execute on function public.cerrar_ejecucion_worker(uuid, text, text, jsonb, text, text) to %I', v_rol_db);

  v_ssh_vault_id := vault.create_secret(p_credencial_ssh, v_rol_db || '_ssh');
  v_db_vault_id := vault.create_secret(v_password, v_rol_db || '_db');

  insert into public.servidores_organizacion (
    organizacion_id, host, puerto_ssh, usuario_ssh,
    credencial_ssh_vault_id, rol_db, credencial_db_vault_id
  )
  values (
    p_organizacion_id, p_host, coalesce(p_puerto, 22), p_usuario_ssh,
    v_ssh_vault_id, v_rol_db, v_db_vault_id
  )
  returning * into v_servidor;

  return query
    select v_servidor.id, v_servidor.organizacion_id, v_servidor.host, v_servidor.puerto_ssh,
           v_servidor.usuario_ssh, v_servidor.rol_db, v_servidor.created_at, v_password;
end;
$$;

comment on function public.aprovisionar_servidor_organizacion(uuid, text, text, text, integer) is
  'Contrato: specs/013-orquestacion-multi-organizacion/contracts/gestion-conexiones-y-servidores.md (FR-014). Otorga al rol worker creado los grants del ciclo de ejecuciones sobre iniciar_ejecucion_worker(...,jsonb) y cerrar_ejecucion_worker.';
