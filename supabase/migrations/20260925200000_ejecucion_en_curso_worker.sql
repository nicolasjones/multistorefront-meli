-- Verificación de ejecución en curso para workers (bug
-- reintentos-credencial-invalida, capacidad worker-execution-cycle).
-- Un reintento del despacho (o una orden manual ya cerrada) no debe abrir un
-- navegador ni hacer login contra el sistema externo: el worker consulta
-- esta función antes de cualquier efecto externo y, si devuelve falso, sale
-- con el código 78 (EJECUCION_NO_EN_CURSO), que el flow no reintenta.
--
-- Migración aditiva: crea funciones y grants; no toca tablas ni datos.
-- Reversión:
--   revoke execute on function private.ejecucion_worker_en_curso(uuid) from workers_orquestacion;
--   drop function private.ejecucion_worker_en_curso(uuid);
--   drop function private.estado_ejecucion_vigente(uuid);

-- Lógica de estado, sin autorización ni grants: la usa el wrapper de abajo y
-- la prueba pgTAP (en Supabase local postgres no es superusuario y no puede
-- adoptar el session_user de un worker).
create or replace function private.estado_ejecucion_vigente(p_ejecucion_id uuid)
returns table (organizacion_id uuid, en_curso boolean)
language sql
stable
security definer
set search_path = ''
as $$
  -- Una en_curso que ya superó tiempo_max_seg tampoco está vigente: la
  -- cerrará como timeout el próximo iniciar_ejecucion_worker (R2 de la
  -- spec 016); esta función no escribe.
  select e.organizacion_id,
         e.estado = 'en_curso'
           and e.iniciada_en >= clock_timestamp() - make_interval(secs => c.tiempo_max_seg)
  from public.ejecuciones_worker e
  join public.capacidades_ejecucion c on c.id = e.capacidad_id
  where e.id = p_ejecucion_id;
$$;

comment on function private.estado_ejecucion_vigente(uuid) is
  'Bug reintentos-credencial-invalida. Organización dueña y vigencia (en_curso dentro de tiempo_max_seg) de una ejecución. Sin grants: solo la llama private.ejecucion_worker_en_curso.';

revoke execute on function private.estado_ejecucion_vigente(uuid) from public, anon, authenticated;

create or replace function private.ejecucion_worker_en_curso(p_ejecucion_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_estado record;
begin
  -- Mismo criterio que obtener_credencial_para_worker (spec 014): el rol se
  -- valida por session_user y membresía, y la organización se deriva del rol.
  if session_user not like 'worker\_%'
     or not pg_catalog.pg_has_role(session_user, 'workers_orquestacion', 'member') then
    raise exception 'NO_AUTORIZADO: solo un worker consulta el estado de su ejecución' using errcode = 'P0001';
  end if;

  select * into v_estado from private.estado_ejecucion_vigente(p_ejecucion_id);
  if not found then
    raise exception 'EJECUCION_DESCONOCIDA: %', p_ejecucion_id using errcode = 'P0001';
  end if;

  if v_estado.organizacion_id is distinct from private.organizacion_del_rol_actual() then
    raise exception 'NO_AUTORIZADO: el worker solo opera sobre su propia organización' using errcode = 'P0001';
  end if;

  return v_estado.en_curso;
end;
$$;

comment on function private.ejecucion_worker_en_curso(uuid) is
  'Bug reintentos-credencial-invalida (workers/CONTRATO.md). El worker la llama antes de abrir un navegador o contactar al sistema externo; falso => sale con 78 y EJECUCION_NO_EN_CURSO:<ejecucion_id>. Errores: NO_AUTORIZADO, EJECUCION_DESCONOCIDA. Solo lectura.';

revoke execute on function private.ejecucion_worker_en_curso(uuid) from public, anon, authenticated;
-- Los roles worker_* heredan de workers_orquestacion (spec 014): el grant
-- alcanza a los aprovisionados y a los futuros sin tocar
-- aprovisionar_servidor_organizacion.
grant execute on function private.ejecucion_worker_en_curso(uuid) to workers_orquestacion;

-- Resultado del despacho en los flows plantilla. Kestra 1.3.35 no condiciona
-- `retry` por código de salida: ante una falla no reintentable despacho_ssh
-- termina en 0 con el output no_reintentable, y esta función (la única tarea
-- posterior de la secuencia) falla con <MOTIVO>:<conexion_id>, que el handler
-- errors clasifica. Sin motivo, marca la conexión activa como hasta ahora.
-- Se hace en la tarea JDBC existente y no en una tarea Fail/Assert nueva
-- porque sumar una tarea a la secuencia del ForEach del flow genérico agota
-- el heap de Kestra al guardarlo (ver
-- .specify/bugs/reintentos-credencial-invalida/fix.md).
-- Reversión: revoke execute on function
--   private.resolver_resultado_despacho(uuid, text) from kestra_orquestacion;
--   drop function private.resolver_resultado_despacho(uuid, text);
create or replace function private.resolver_resultado_despacho(
  p_conexion_id uuid,
  p_no_reintentable text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(p_no_reintentable, '') = '' then
    perform private.marcar_conexion_activa(p_conexion_id);
    return;
  end if;

  -- Lista cerrada (workers/CONTRATO.md): nunca se refleja texto arbitrario
  -- del worker en el error que leen los handlers.
  if p_no_reintentable not in ('CREDENCIAL_INVALIDA', 'EJECUCION_NO_EN_CURSO', 'YA_EN_CURSO',
                               'CAPACIDAD_NO_HABILITADA', 'CONFIGURACION_INVALIDA', 'NO_REINTENTABLE') then
    raise exception 'MOTIVO_INVALIDO' using errcode = 'P0001';
  end if;

  raise exception '%:%', p_no_reintentable, p_conexion_id using errcode = 'P0001';
end;
$$;

comment on function private.resolver_resultado_despacho(uuid, text) is
  'Bug reintentos-credencial-invalida. Sin motivo: marcar_conexion_activa (FR-013). Con motivo no reintentable de la lista de workers/CONTRATO.md: falla con <MOTIVO>:<conexion_id> sin tocar la conexión, para que la tarea Kestra falle sin retry y el handler errors la clasifique.';

revoke execute on function private.resolver_resultado_despacho(uuid, text) from public, anon, authenticated;
grant execute on function private.resolver_resultado_despacho(uuid, text) to kestra_orquestacion;
