-- MSF-354 (F-IMP-01, FR-004): `iniciar_proceso_masivo` crea el proceso y su ejecución auditable de
-- worker (con su orden en la outbox) en una sola transacción, reutilizando `iniciar_ejecucion_worker`.
--
-- Es `security definer` (el contrato original decía invoker, pero `authenticated` no tiene insert sobre
-- `procesos_masivos`): la autorización se hace dentro, con la organización de la sesión.
--
-- Esquemas (Principio VII): solo función en `public` sobre tablas de plataforma.
-- Migración aditiva. Reversión: drop function public.iniciar_proceso_masivo(uuid, text, text, text, text, uuid, jsonb);

create or replace function public.iniciar_proceso_masivo(
  p_conexion_id uuid,
  p_capacidad text,
  p_tipo text,
  p_funcionalidad text,
  p_nombre text,
  p_empresa_id uuid default null,
  p_parametros jsonb default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_uid uuid := (select auth.uid());
  v_proceso uuid := gen_random_uuid();
  v_ejecucion uuid;
begin
  if v_org is null or v_uid is null or not (select private.es_administrador_de(v_org)) then
    raise exception 'NO_AUTORIZADO: solo un administrador de la organización inicia un proceso masivo'
      using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('importacion', 'exportacion') then
    raise exception 'TIPO_INVALIDO: el tipo debe ser importacion o exportacion' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_funcionalidad, ''))) not between 1 and 80
     or length(btrim(coalesce(p_nombre, ''))) not between 1 and 160 then
    raise exception 'ARGUMENTO_INVALIDO: funcionalidad (hasta 80) y nombre (hasta 160) son obligatorios' using errcode = '22023';
  end if;
  if p_parametros is null or jsonb_typeof(p_parametros) <> 'object' then
    raise exception 'ARGUMENTO_INVALIDO: los parámetros deben ser un objeto' using errcode = '22023';
  end if;
  if p_parametros::text ~* '(api[_-]?key|bearer|session|passwd|password|pwd|secret|token)\s*[:=]\s*\S+'
     or p_parametros::text ~ 'eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+' then
    raise exception 'SECRETO_DETECTADO: los parámetros no pueden llevar credenciales' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.conexiones c where c.id = p_conexion_id and c.organizacion_id = v_org) then
    raise exception 'NO_AUTORIZADO: la conexión no pertenece a la organización' using errcode = '42501';
  end if;
  if p_empresa_id is not null and not exists (
    select 1 from dominio.empresas e where e.id = p_empresa_id and e.organizacion_id = v_org
  ) then
    raise exception 'EMPRESA_INVALIDA: la empresa no pertenece a la organización' using errcode = '22023';
  end if;

  -- Ejecución auditable + orden de despacho; propaga YA_EN_CURSO, CAPACIDAD_NO_HABILITADA, etc.
  v_ejecucion := public.iniciar_ejecucion_worker(
    p_conexion_id, p_capacidad, 'manual', v_uid,
    jsonb_build_object('proceso_id', v_proceso, 'parametros', p_parametros)
  );

  insert into public.procesos_masivos
    (id, organizacion_id, empresa_id, tipo, funcionalidad, nombre, ejecucion_id, solicitado_por)
  values (v_proceso, v_org, p_empresa_id, p_tipo, btrim(p_funcionalidad), btrim(p_nombre), v_ejecucion, v_uid);

  return v_proceso;
end;
$$;

comment on function public.iniciar_proceso_masivo(uuid, text, text, text, text, uuid, jsonb) is
  'F-IMP-01 (FR-004): crea el proceso masivo (pendiente) y su ejecución de worker con orden de despacho en una transacción. Solo administradores. Errores: NO_AUTORIZADO, TIPO_INVALIDO, ARGUMENTO_INVALIDO, SECRETO_DETECTADO, EMPRESA_INVALIDA y los del ciclo (YA_EN_CURSO, CAPACIDAD_NO_HABILITADA).';

revoke execute on function public.iniciar_proceso_masivo(uuid, text, text, text, text, uuid, jsonb) from public, anon;
grant execute on function public.iniciar_proceso_masivo(uuid, text, text, text, text, uuid, jsonb) to authenticated;
