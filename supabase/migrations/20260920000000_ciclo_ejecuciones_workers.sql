-- Ciclo de ejecuciones de workers (spec 016). Migración aditiva
-- (Technology Gates) — nada se destruye acá. Reversión: en orden inverso a
-- como se crea:
--   drop function registrar_adopcion_ciclo(text);            -- historia US3
--   drop function public.cerrar_ejecucion_worker(uuid, text, text, jsonb, text, text); -- US2
--   drop function public.iniciar_ejecucion_worker(uuid, text, text, uuid); -- US1
--   drop policy evidencias_insert_worker on storage.objects;
--   drop policy evidencias_select_admin on storage.objects;
--   delete from storage.buckets where id = 'evidencias-ejecuciones';
--   drop table adopciones_template;
--   drop table ejecuciones_worker;
--   drop table capacidades_ejecucion;
-- Nota: las funciones iniciar/cerrar/registrar se agregan en este mismo
-- archivo en sus historias (T008/T012/T018) — la reversión de cada una vive
-- con su bloque, como arriba.
--
-- Tablas de plataforma en esquema public (como conexiones/alertas de la
-- spec 013), nunca en dominio (FR-012). Escritura solo vía funciones
-- SECURITY DEFINER; authenticated sin INSERT/UPDATE/DELETE directo (R5).

-- ============================================================================
-- Tablas (data-model.md) — T004
-- ============================================================================

create table capacidades_ejecucion (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizaciones (id) on delete cascade,
  conexion_id uuid not null references conexiones (id) on delete cascade,
  clave text not null,
  tiempo_max_seg integer not null default 1800 check (tiempo_max_seg > 0),
  habilitada boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conexion_id, clave)
);

comment on table capacidades_ejecucion is
  'Automatización identificable que una conexión puede ejecutar (spec 016, FR-004/FR-010). Una organización puede tener varias conexiones al mismo sistema (spec 013, R10), por eso la unicidad es por (conexion_id, clave). Escritura únicamente vía funciones de ciclo de ejecución.';

create index capacidades_ejecucion_organizacion_id_idx on capacidades_ejecucion (organizacion_id);

create table ejecuciones_worker (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizaciones (id) on delete cascade,
  conexion_id uuid references conexiones (id) on delete set null,
  capacidad_id uuid not null references capacidades_ejecucion (id) on delete cascade,
  origen text not null check (origen in ('manual', 'programada', 'kestra')),
  estado text not null default 'en_curso' check (estado in ('en_curso', 'exitosa', 'fallida', 'timeout')),
  actor uuid references auth.users (id) on delete set null,
  iniciada_en timestamptz not null default now(),
  finalizada_en timestamptz,
  motivo_sanitizado text,
  detalle jsonb not null default '{}',
  archivo_original_path text,
  evidencia_path text,
  check (finalizada_en is null or finalizada_en >= iniciada_en)
);

comment on table ejecuciones_worker is
  'Registro auditable de un intento de automatización (spec 016, FR-001/FR-005/FR-006). organizacion_id redundante a propósito: permite RLS e índice parcial sin join. motivo_sanitizado y detalle nunca contienen secretos (FR-009, ver cerrar_ejecucion). archivo_original_path/evidencia_path son rutas del bucket evidencias-ejecuciones, nunca bytes. Escritura únicamente vía iniciar_ejecucion/cerrar_ejecucion.';

-- Una sola ejecución activa por organización y capacidad (R1, FR-002/SC-001).
create unique index ejecucion_activa_unica on ejecuciones_worker (organizacion_id, capacidad_id)
  where estado = 'en_curso';

create index ejecuciones_worker_historial_idx on ejecuciones_worker (organizacion_id, capacidad_id, iniciada_en desc);
create index ejecuciones_worker_conexion_id_idx on ejecuciones_worker (conexion_id);

create table adopciones_template (
  origen text primary key,
  version text not null,
  adoptada_en timestamptz not null default now()
);

comment on table adopciones_template is
  'Registro verificable de qué versión del template adoptó este producto para cada capacidad genérica (spec 016, FR-011/SC-005, R7). Escritura únicamente vía registrar_adopcion_ciclo (idempotente).';

-- ============================================================================
-- RLS (Principio I, SC-003) — T005
-- ============================================================================

alter table capacidades_ejecucion enable row level security;
alter table ejecuciones_worker enable row level security;
alter table adopciones_template enable row level security;

-- Historial y capacidades: administradores de la organización dueña y
-- superadmins (FR-007). Sin policies de insert/update/delete: el único
-- camino son las funciones (mismo patrón que conexiones en la spec 013).
create policy capacidades_ejecucion_select on capacidades_ejecucion
  for select to authenticated
  using ((select private.es_administrador_de(organizacion_id)));

create policy ejecuciones_worker_select on ejecuciones_worker
  for select to authenticated
  using ((select private.es_administrador_de(organizacion_id)));

-- Versión adoptada: lectura de plataforma, solo superadmin.
create policy adopciones_template_select on adopciones_template
  for select to authenticated
  using ((select private.is_superadmin()));

-- ============================================================================
-- Grants (auto_expose_new_tables = false: hacen falta explícitos)
-- ============================================================================

revoke all on table capacidades_ejecucion from anon, authenticated;
grant select (id, organizacion_id, conexion_id, clave, tiempo_max_seg, habilitada, created_at, updated_at)
  on table capacidades_ejecucion to authenticated;

revoke all on table ejecuciones_worker from anon, authenticated;
grant select (id, organizacion_id, conexion_id, capacidad_id, origen, estado, actor, iniciada_en, finalizada_en, motivo_sanitizado, detalle, archivo_original_path, evidencia_path)
  on table ejecuciones_worker to authenticated;

revoke all on table adopciones_template from anon, authenticated;
grant select on table adopciones_template to authenticated;

-- ============================================================================
-- Bucket de evidencia (R3) — T006
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('evidencias-ejecuciones', 'evidencias-ejecuciones', false)
on conflict (id) do nothing;

-- Helper separado para la policy de Storage. La función histórica
-- organizacion_del_rol_actual() conserva su contrato restringido a worker_*;
-- esta variante es segura para que Storage pueda evaluarla también desde
-- sesiones authenticated: devuelve NULL para cualquier session_user que no
-- sea un worker y nunca amplía el acceso a datos de la organización.
create or replace function private.organizacion_del_rol_actual_para_storage()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when session_user like 'worker\_%' then (
      select s.organizacion_id
      from public.servidores_organizacion s
      where s.rol_db = session_user
      limit 1
    )
    else null::uuid
  end;
$$;

revoke execute on function private.organizacion_del_rol_actual_para_storage() from public;
grant execute on function private.organizacion_del_rol_actual_para_storage() to authenticated;

-- Lectura: administradores de la organización dueña (prefijo
-- <organizacion_id>/...) y superadmins. Refine descarga por URL firmada,
-- nunca con service-role en el navegador.
create policy evidencias_select_admin on storage.objects
  for select to authenticated
  using (
    bucket_id = 'evidencias-ejecuciones'
    and (
      (select private.is_superadmin())
      or (
        array_length(storage.foldername(name), 1) >= 1
        and (select private.es_administrador_de(((storage.foldername(name))[1])::uuid))
      )
    )
  );

-- Escritura: solo el rol worker_<organizacion_id> de la organización dueña
-- del prefijo (resuelto por session_user via
-- private.organizacion_del_rol_actual, R5 — EXECUTE otorgado por rol al
-- aprovisionar, spec 013). Sin EXECUTE sobre esa función (authenticated,
-- anon) el check falla cerrado: sin vía de subida directa desde el
-- navegador; el worker sube y pasa rutas a cerrar_ejecucion (contrato).
create policy evidencias_insert_worker on storage.objects
  for insert to public
  with check (
    bucket_id = 'evidencias-ejecuciones'
    and array_length(storage.foldername(name), 1) >= 1
    and case
      when session_user like 'worker\_%'
      then ((storage.foldername(name))[1])::uuid = (select private.organizacion_del_rol_actual_para_storage())
      else false
    end
  );

-- ============================================================================
-- Autorización del llamante (R5) — T008
-- ============================================================================
--
-- Tres vías legítimas, sin claims falsificables:
-- 1. JWT con rol authenticated (PostgREST/Refine, y pgTAP con claims
--    fijados): manda auth.uid() + private.es_administrador_de.
-- 2. session_user = kestra_orquestacion (JDBC directo): despachador
--    confiable, ya filtró organizaciones elegibles (R6).
-- 3. session_user = worker_<id> (conexión directa del worker): la
--    organización se deriva del rol de sesión, nunca de un parámetro (R5).
-- Superuser (dueño/operador, p. ej. el runner de migraciones o pgTAP como
-- postgres) bypassa como bypassa RLS: sin efecto sobre privilegios reales,
-- que ya son totales para ese rol.
create or replace function private.autorizar_llamante_ciclo(p_organizacion_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_jwt_role text;
begin
  if (select rolsuper from pg_roles where rolname = session_user) then
    return;
  end if;

  if session_user = 'kestra_orquestacion' then
    return;
  end if;

  begin
    v_jwt_role := (nullif(current_setting('request.jwt.claims', true), '')::json->>'role');
  exception when others then
    v_jwt_role := null;
  end;

  if v_jwt_role = 'authenticated' then
    if (select private.es_administrador_de(p_organizacion_id)) then
      return;
    end if;
    raise exception 'NO_AUTORIZADO: se requiere ser administrador de la organización %', p_organizacion_id using errcode = 'P0001';
  end if;

  if session_user like 'worker\_%' then
    if (select private.organizacion_del_rol_actual()) = p_organizacion_id then
      return;
    end if;
    raise exception 'NO_AUTORIZADO: el worker solo opera sobre su propia organización' using errcode = 'P0001';
  end if;

  raise exception 'NO_AUTORIZADO: llamante no reconocido para el ciclo de ejecuciones' using errcode = 'P0001';
end;
$$;

comment on function private.autorizar_llamante_ciclo(uuid) is
  'Punto único de autorización de iniciar/cerrar_ejecucion (spec 016, R5/FR-007/FR-008). JWT manda por auth.uid(); kestra_orquestacion es despachador confiable; worker_* deriva su org de session_user.';

revoke execute on function private.autorizar_llamante_ciclo(uuid) from public;
grant execute on function private.autorizar_llamante_ciclo(uuid) to authenticated;
grant execute on function private.autorizar_llamante_ciclo(uuid) to kestra_orquestacion;

-- ============================================================================
-- iniciar_ejecucion_worker (US1: FR-002, FR-003, FR-004) — T008
-- ============================================================================

create or replace function public.iniciar_ejecucion_worker(
  p_conexion_id uuid,
  p_clave_capacidad text,
  p_origen text,
  p_actor uuid default null
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

  insert into public.ejecuciones_worker (organizacion_id, conexion_id, capacidad_id, origen, actor)
  values (
    v_conexion.organizacion_id, p_conexion_id, v_capacidad.id, p_origen,
    case when p_origen = 'manual' then p_actor else null end
  )
  returning id into v_nueva_id;

  return v_nueva_id;
end;
$$;

comment on function public.iniciar_ejecucion_worker(uuid, text, text, uuid) is
  'Contrato: specs/016-ciclo-ejecuciones-workers/contracts/ciclo-ejecuciones.md. Único punto de inicio (US1). Errores: ORIGEN_INVALIDO, ACTOR_REQUERIDO, CONEXION_DESCONOCIDA, CAPACIDAD_NO_HABILITADA, NO_AUTORIZADO, YA_EN_CURSO. En public (no private): Refine la invoca vía supabaseClient.rpc — mismo criterio que crear_conexion (spec 013).';

revoke execute on function public.iniciar_ejecucion_worker(uuid, text, text, uuid) from public, anon;
grant execute on function public.iniciar_ejecucion_worker(uuid, text, text, uuid) to authenticated;
grant execute on function public.iniciar_ejecucion_worker(uuid, text, text, uuid) to kestra_orquestacion;

-- Los roles worker_* necesitan EXECUTE sobre el helper y el inicio para
-- iniciar/cerrar sus propias ejecuciones (FR-008): se otorga al
-- aprovisionar (nuevos) y se reconcilia abajo (existentes) — mismo patrón
-- que organizacion_del_rol_actual en la spec 013/014.
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
  execute format('grant execute on function public.iniciar_ejecucion_worker(uuid, text, text, uuid) to %I', v_rol_db);

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
  'Contrato: specs/013-orquestacion-multi-organizacion/contracts/gestion-conexiones-y-servidores.md (FR-014). Spec 016 agrega el grant del ciclo de ejecuciones (autorizar_llamante_ciclo + iniciar_ejecucion) al rol worker creado — cerrar_ejecucion se agrega en US2 con el mismo patrón.';

-- Reconciliación aditiva para roles ya aprovisionados (R7): solo grants,
-- nunca recrea ni toca nada existente.
do $$
declare
  r record;
begin
  for r in select rol_db from public.servidores_organizacion loop
    execute format('grant execute on function private.autorizar_llamante_ciclo(uuid) to %I', r.rol_db);
    execute format('grant execute on function public.iniciar_ejecucion_worker(uuid, text, text, uuid) to %I', r.rol_db);
  end loop;
end;
$$;

-- ============================================================================
-- cerrar_ejecucion_worker (US2: FR-005, FR-006, FR-009) — T012
-- ============================================================================

create or replace function public.cerrar_ejecucion_worker(
  p_ejecucion_id uuid,
  p_estado_final text,
  p_motivo_sanitizado text,
  p_detalle jsonb default '{}',
  p_archivo_path text default null,
  p_evidencia_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ejecucion public.ejecuciones_worker;
  -- Formas de secreto en texto recuperable (FR-009, R4): par clave=valor
  -- sensible, JWT, credencial embebida en URL y formato de access key.
  -- Defensa en profundidad sobre la redacción en origen del worker: filtra
  -- por forma, nunca compara contra secretos reales (que jamás deben
  -- llegar como parámetro).
  c_patron_secreto constant text :=
    '(?i)(api[_-]?key|bearer|session|passwd|password|pwd|secret|token)\s*[:=]\s*\S+'
    || '|eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+'
    || '|://[^/\s:]+:[^/\s@]+@'
    || '|AKIA[0-9A-Z]{16}';
begin
  if p_estado_final not in ('exitosa', 'fallida') then
    raise exception 'ESTADO_INVALIDO: % no es un estado final (exitosa, fallida)', p_estado_final using errcode = 'P0001';
  end if;

  select * into v_ejecucion from public.ejecuciones_worker e where e.id = p_ejecucion_id for update;
  if not found then
    raise exception 'EJECUCION_DESCONOCIDA: %', p_ejecucion_id using errcode = 'P0001';
  end if;

  -- Cierre idempotente: un segundo cierre no altera la fila (FR-005, edge
  -- case "termina dos veces"). Solo timeout lo escribe el cierre perezoso
  -- de iniciar_ejecucion, nunca esta función.
  if v_ejecucion.estado <> 'en_curso' then
    raise exception 'YA_CERRADA: la ejecución % ya está en estado %', p_ejecucion_id, v_ejecucion.estado using errcode = 'P0001';
  end if;

  perform private.autorizar_llamante_ciclo(v_ejecucion.organizacion_id);

  if coalesce(p_motivo_sanitizado, '') ~ c_patron_secreto
     or coalesce(p_detalle, '{}')::text ~ c_patron_secreto then
    raise exception 'SECRETO_DETECTADO: motivo o detalle con forma de credencial, sesión o token' using errcode = 'P0001';
  end if;

  -- La evidencia y el archivo original solo se adjuntan al éxito (FR-006):
  -- una falla posterior jamás sustituye la referencia del último éxito.
  if p_estado_final = 'fallida' and (p_archivo_path is not null or p_evidencia_path is not null) then
    raise exception 'EVIDENCIA_SOLO_EXITO: una ejecución fallida no adjunta archivo ni evidencia' using errcode = 'P0001';
  end if;

  update public.ejecuciones_worker e
  set estado = p_estado_final,
      finalizada_en = clock_timestamp(),
      motivo_sanitizado = p_motivo_sanitizado,
      detalle = coalesce(p_detalle, '{}'),
      archivo_original_path = case when p_estado_final = 'exitosa' then p_archivo_path else null end,
      evidencia_path = case when p_estado_final = 'exitosa' then p_evidencia_path else null end
  where e.id = p_ejecucion_id;

  return p_ejecucion_id;
end;
$$;

comment on function public.cerrar_ejecucion_worker(uuid, text, text, jsonb, text, text) is
  'Contrato: specs/016-ciclo-ejecuciones-workers/contracts/ciclo-ejecuciones.md. Único punto de cierre manual (US2). Errores: ESTADO_INVALIDO, EJECUCION_DESCONOCIDA, YA_CERRADA, NO_AUTORIZADO, SECRETO_DETECTADO, EVIDENCIA_SOLO_EXITO. En public (no private): mismo criterio que iniciar_ejecucion.';

revoke execute on function public.cerrar_ejecucion_worker(uuid, text, text, jsonb, text, text) from public, anon;
grant execute on function public.cerrar_ejecucion_worker(uuid, text, text, jsonb, text, text) to authenticated;
grant execute on function public.cerrar_ejecucion_worker(uuid, text, text, jsonb, text, text) to kestra_orquestacion;

-- Grants del ciclo para roles nuevos y existentes (mismo patrón que T008).
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
  execute format('grant execute on function public.iniciar_ejecucion_worker(uuid, text, text, uuid) to %I', v_rol_db);
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
  'Contrato: specs/013-orquestacion-multi-organizacion/contracts/gestion-conexiones-y-servidores.md (FR-014). Spec 016 agrega los grants del ciclo de ejecuciones (autorizar_llamante_ciclo, iniciar_ejecucion, cerrar_ejecucion) al rol worker creado.';

do $$
declare
  r record;
begin
  for r in select rol_db from public.servidores_organizacion loop
    execute format('grant execute on function public.cerrar_ejecucion_worker(uuid, text, text, jsonb, text, text) to %I', r.rol_db);
  end loop;
end;
$$;

-- ============================================================================
-- registrar_adopcion_ciclo (US3: FR-011, SC-005) — T018
-- ============================================================================

create or replace function public.registrar_adopcion_ciclo(p_version_template text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_superadmin()) then
    raise exception 'NO_AUTORIZADO: solo un superadmin registra la adopción del ciclo' using errcode = 'P0001';
  end if;

  if coalesce(nullif(btrim(p_version_template), ''), '') = '' then
    raise exception 'VERSION_REQUERIDA: hay que indicar la versión del template de origen' using errcode = 'P0001';
  end if;

  insert into public.adopciones_template (origen, version, adoptada_en)
  values ('ciclo-ejecuciones', btrim(p_version_template), now())
  on conflict (origen) do update
    set version = excluded.version, adoptada_en = excluded.adoptada_en;

  return btrim(p_version_template);
end;
$$;

comment on function public.registrar_adopcion_ciclo(text) is
  'Contrato: specs/016-ciclo-ejecuciones-workers/contracts/adopcion-reconciliacion.md. Registra de forma idempotente qué versión del template adoptó el producto (US3). Solo superadmin; en public para invocarla vía RPC.';

revoke execute on function public.registrar_adopcion_ciclo(text) from public, anon;
grant execute on function public.registrar_adopcion_ciclo(text) to authenticated;
