-- Destrabar conexiones en credencial_invalida o error (bug
-- conexion-invalida-trabada, capacidad worker-execution-cycle; FR-013 de la
-- spec 013). Desde la spec 016, iniciar_ejecucion_worker rechazaba toda
-- conexión no activa y el genérico solo recorría las activa: la ejecución
-- exitosa que limpia el estado no podía ocurrir nunca.
--
-- Reglas (ver .specify/bugs/conexion-invalida-trabada/assessment.md):
-- - error no bloquea ningún origen ni el recorrido del genérico.
-- - credencial_invalida no se reintenta sola: el programado la saltea; sale
--   por actualizar_credencial_conexion (vuelve a activa, como una conexión
--   nueva) o por un disparo manual de un administrador autenticado. Cada
--   camino es un único intento (sin retry desde worker-execution-cycle 1.2.0).
--
-- Migración aditiva: solo create or replace de tres funciones; no toca
-- tablas ni datos. Reversión: restaurar los cuerpos anteriores —
--   public.iniciar_ejecucion_worker: 20260923172738_iniciar_ejecucion_outbox.sql
--   private.organizaciones_activas_para_conector y
--   public.actualizar_credencial_conexion: 20260914150000_orquestacion_multi_organizacion.sql
-- (los grants se conservan con create or replace).

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
  v_jwt_role text;
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
  if not found or not v_capacidad.habilitada then
    raise exception 'CAPACIDAD_NO_HABILITADA: % no está registrada y habilitada para la conexión %', p_clave_capacidad, p_conexion_id using errcode = 'P0001';
  end if;

  -- FR-013: error no bloquea. credencial_invalida solo admite el disparo
  -- manual de una sesión authenticated (autorizar_llamante_ciclo exige que
  -- sea administradora); un worker o Kestra no pueden forzarlo.
  if v_conexion.estado = 'credencial_invalida' then
    begin
      v_jwt_role := (nullif(current_setting('request.jwt.claims', true), '')::json->>'role');
    exception when others then
      v_jwt_role := null;
    end;
    if p_origen <> 'manual' or v_jwt_role is distinct from 'authenticated' then
      raise exception 'CONEXION_CREDENCIAL_INVALIDA: la conexión % tiene la credencial rechazada; actualizala o iniciá la ejecución manualmente', p_conexion_id using errcode = 'P0001';
    end if;
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
  'Contrato: specs/019-outbox-ejecuciones/contracts/despacho-outbox.md. El inicio manual persiste ejecución y orden de despacho en la misma transacción; no realiza HTTP ni llama a Kestra. Orígenes programada y kestra no generan una orden para evitar recursión de despacho. FR-013 (bug conexion-invalida-trabada): una conexión en error no bloquea; en credencial_invalida solo se acepta el disparo manual de un administrador autenticado (CONEXION_CREDENCIAL_INVALIDA en otro caso).';

create or replace function private.organizaciones_activas_para_conector(
  p_sistema_externo text
)
returns table (organizacion_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  -- error no bloquea (FR-013); credencial_invalida se saltea hasta que se
  -- actualice la credencial o un administrador dispare a mano.
  select distinct c.organizacion_id
  from public.conexiones c
  where c.sistema_externo = p_sistema_externo
    and c.estado in ('activa', 'error')
    and not exists (
      select 1
      from public.excepciones_flow_generico e
      where e.organizacion_id = c.organizacion_id
        and e.conector_id = p_sistema_externo
    )
  order by c.organizacion_id;
$$;

comment on function private.organizaciones_activas_para_conector(text) is
  'Contrato: specs/013-orquestacion-multi-organizacion/contracts/orquestacion-kestra.md (US2, FR-005). Devuelve los UUID de organizaciones con una conexión activa o en error (FR-013: error no bloquea) para el conector, excluyendo las que tienen flow dedicado y las de credencial_invalida. Kestra no recibe SELECT directo sobre conexiones ni excepciones_flow_generico.';

create or replace function public.actualizar_credencial_conexion(
  p_conexion_id uuid,
  p_nueva_credencial text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion_id uuid;
  v_vault_id uuid;
begin
  select c.organizacion_id, c.credencial_vault_id into v_organizacion_id, v_vault_id
  from public.conexiones c where c.id = p_conexion_id;

  if v_organizacion_id is null then
    raise exception 'La conexión % no existe', p_conexion_id using errcode = 'P0002';
  end if;

  if not (select private.es_administrador_de(v_organizacion_id)) then
    raise exception 'No puede gestionar conexiones de esta organización' using errcode = '42501';
  end if;

  perform vault.update_secret(v_vault_id, p_nueva_credencial);

  -- Una credencial nueva se presume válida, como al crear la conexión: sale
  -- de credencial_invalida para que la próxima ejecución la pruebe (FR-013).
  update public.conexiones
  set estado = case when estado = 'credencial_invalida' then 'activa' else estado end,
      updated_at = clock_timestamp()
  where id = p_conexion_id;
end;
$$;

comment on function public.actualizar_credencial_conexion(uuid, text) is
  'Contrato: specs/013-orquestacion-multi-organizacion/contracts/gestion-conexiones-y-servidores.md. Rota el secreto de Vault de una conexión existente sin cambiar su id. Una conexión en credencial_invalida vuelve a activa para que la próxima ejecución pruebe la credencial nueva (FR-013, bug conexion-invalida-trabada); error y activa no cambian. No devuelve la credencial anterior ni la nueva. En public (no private): ver nota de desvío al inicio de 20260914150000_orquestacion_multi_organizacion.sql.';
