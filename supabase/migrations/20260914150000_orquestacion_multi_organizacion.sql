-- Orquestación de workers multi-organización (spec 013). Migración aditiva
-- (Technology Gates) — nada se destruye acá. Reversión: en orden inverso a
-- como se crea:
--   drop function private.registrar_alerta(text, uuid, uuid, text);
--   drop function private.marcar_conexion_credencial_invalida(uuid, text);
--   drop function private.marcar_conexion_activa(uuid);
--   drop function private.datos_despacho_conexion(uuid, text);
--   drop function public.obtener_credencial_servidor(uuid);
--   drop function public.obtener_credencial_conexion(uuid);
--   drop function public.actualizar_credencial_conexion(uuid, text);
--   drop function public.crear_conexion(uuid, text, text);
--   drop function private.organizacion_del_rol_actual();
--   drop function public.aprovisionar_servidor_organizacion(uuid, text, integer, text, text);
--   drop function private.es_administrador_de(uuid);
--   drop role kestra_orquestacion;
--   drop table alertas;
--   drop table excepciones_flow_generico;
--   drop table conexiones;
--   drop table servidores_organizacion;
-- Nota: revertir en un ambiente con servidores ya aprovisionados implica
-- además borrar a mano cada rol worker_<organizacion_id sin guiones>
-- creado dinámicamente por aprovisionar_servidor_organizacion — no están
-- listados acá porque no existen hasta el primer aprovisionamiento.
--
-- Desvío (Fase 3, T016): las 5 funciones que Refine llama directo desde el
-- navegador (aprovisionar_servidor_organizacion, crear_conexion,
-- actualizar_credencial_conexion, obtener_credencial_conexion,
-- obtener_credencial_servidor) viven en public, no en private como decían
-- data-model.md/contracts/ original — supabase/config.toml solo expone
-- "public"/"graphql_public" a PostgREST (api.schemas): una función en
-- private es inalcanzable por supabaseClient.rpc(...) sin importar su
-- GRANT, exactamente el bug que esto corrige. Mismo criterio que el resto
-- del repo (public.agregar_miembro, public.habilitar_feature,
-- public.entrar_a_organizacion, etc.): private queda reservado para
-- helpers que ninguna sesión de PostgREST necesita invocar directo
-- (es_administrador_de, organizacion_del_rol_actual, marcar_conexion_*,
-- registrar_alerta — estas dos últimas y registrar_alerta las usa
-- kestra_orquestacion por JDBC directo, no por PostgREST). Cada función no
-- cambió de lógica, solo de schema — el chequeo de permiso interno sigue
-- siendo el único punto de decisión (R4).

-- supabase_vault ya viene instalada en la imagen de Postgres de Supabase;
-- queda explícita acá porque es el primer uso en este repo (research.md R3).
create extension if not exists supabase_vault;

-- ============================================================================
-- Tablas (data-model.md)
-- ============================================================================

create table servidores_organizacion (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null unique references organizaciones (id) on delete cascade,
  host text not null,
  puerto_ssh integer not null default 22,
  usuario_ssh text not null,
  credencial_ssh_vault_id uuid not null,
  rol_db text not null unique,
  credencial_db_vault_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table servidores_organizacion is
  'Servidor Docker propio de cada organización, alcanzable por SSH desde el servidor central (spec 013). Un servidor por organización (unique). credencial_ssh_vault_id/credencial_db_vault_id referencian vault.secrets — nunca en texto plano acá (R3). Escritura únicamente vía public.aprovisionar_servidor_organizacion.';

create table conexiones (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizaciones (id) on delete cascade,
  sistema_externo text not null,
  estado text not null default 'activa' check (estado in ('activa', 'error', 'credencial_invalida')),
  credencial_vault_id uuid not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table conexiones is
  'Vínculo entre una organización y un sistema externo (spec 013). Sin índice único sobre (organizacion_id, sistema_externo): una organización puede tener más de una conexión al mismo sistema (R10, FR-021). credencial_vault_id referencia vault.secrets, nunca en texto plano acá — el valor descifrado sale únicamente por public.obtener_credencial_conexion.';

create index conexiones_organizacion_id_idx on conexiones (organizacion_id);

create table excepciones_flow_generico (
  organizacion_id uuid not null references organizaciones (id) on delete cascade,
  conector_id text not null,
  created_at timestamptz not null default now(),
  primary key (organizacion_id, conector_id)
);

comment on table excepciones_flow_generico is
  'La presencia de una fila excluye a esa organización del flow genérico de ese conector porque la atiende un flow dedicado (FR-005). Gestión exclusiva de superadmin — sin pantalla de Refine (contracts/orquestacion-kestra.md).';

create table alertas (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('tecnica', 'credencial')),
  organizacion_id uuid references organizaciones (id) on delete set null,
  conexion_id uuid references conexiones (id) on delete set null,
  motivo text not null,
  created_at timestamptz not null default clock_timestamp()
);

comment on table alertas is
  'Registro auditable de cada alerta disparada (Principio III), independiente del canal de notificación real (FR-011). organizacion_id nulo para una falla técnica sin organización puntual (por ejemplo, el propio Kestra). Escritura únicamente vía private.registrar_alerta.';

create index alertas_organizacion_id_id_idx on alertas (organizacion_id, id desc);

-- ============================================================================
-- Rol de servicio para Kestra (research.md R2, mismo patrón que kestra_backups)
-- ============================================================================

-- Guardado con chequeo de pg_roles (los roles son objetos de clúster, no de
-- schema): sin este chequeo, correr la migración dos veces sobre el mismo
-- clúster falla con "role already exists" (mismo motivo que kestra_backups).
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'kestra_orquestacion'
  ) then
    create role kestra_orquestacion with login password 'reemplazar-por-entorno';
  end if;
end
$$;

comment on role kestra_orquestacion is
  'Rol de mínimo privilegio para la conexión JDBC directa de Kestra hacia las tablas de orquestación multi-organización (spec 013) — mismo patrón que kestra_backups (spec 011). No crece con cada organización nueva (FR-008): es un único rol para todo Kestra, no uno por organización. Solo EXECUTE sobre las funciones SECURITY DEFINER de esta migración; el rol por organización es worker_<organizacion_id>, aparte (ver servidores_organizacion.rol_db).';

-- ============================================================================
-- Funciones (schema private, security definer, search_path = '')
-- ============================================================================

create or replace function private.es_administrador_de(p_organizacion_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_superadmin())
    or exists (
      select 1 from public.usuarios_organizacion u
      where u.user_id = (select auth.uid())
        and u.organizacion_id = p_organizacion_id
        and u.rol_id = 'administrador'
    );
$$;

comment on function private.es_administrador_de(uuid) is
  'true si quien llama es administrador de esa organización puntual, o superadmin (FR-009). Punto único que las políticas RLS de servidores_organizacion/conexiones y las funciones de gestión de esta spec usan para decidir acceso — misma forma que private.puede_gestionar_membresias (spec 005).';

grant execute on function private.es_administrador_de(uuid) to authenticated;

create or replace function private.organizacion_del_rol_actual()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.organizacion_id
  from public.servidores_organizacion s
  where s.rol_db = session_user
  limit 1;
$$;

comment on function private.organizacion_del_rol_actual() is
  'Resuelve la organización dueña del rol de Postgres que abrió esta conexión. Usa session_user, no current_user: dentro de una función security definer, current_user pasa a ser el dueño de la función (postgres), no quien llamó — session_user sí conserva la identidad real de la conexión (verificado empíricamente; difiere de la redacción informal de tasks.md/data-model.md, que dice "current_user"). Pensada para que las políticas RLS de las tablas de dominio de una implementación futura (spec 012) resuelvan la organización de un rol worker_* sin depender de un claim que el propio worker podría fijar (R5). EXECUTE se otorga rol por rol al aprovisionar cada servidor (public.aprovisionar_servidor_organizacion) — no existe un grupo worker_* genérico en Postgres.';

-- Sin este revoke, el EXECUTE a PUBLIC que Postgres otorga por defecto a
-- toda función nueva quedaría alcanzable por cualquier authenticated (ya
-- tiene USAGE sobre private desde la spec 003) — exactamente lo que este
-- mecanismo no debe permitir: solo el rol worker_* puntual que se le
-- concede explícito más abajo.
revoke execute on function private.organizacion_del_rol_actual() from public;

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
  -- Único rol que puede resolver su propia organización vía
  -- organizacion_del_rol_actual() — sin esto, el rol nuevo no tendría ni
  -- siquiera USAGE sobre el schema private (R5).
  execute format('grant usage on schema private to %I', v_rol_db);
  execute format('grant execute on function private.organizacion_del_rol_actual() to %I', v_rol_db);

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
  'Contrato: specs/013-orquestacion-multi-organizacion/contracts/gestion-conexiones-y-servidores.md (FR-014). Crea el rol worker_<organizacion_id>, genera su contraseña, guarda ambas credenciales en Vault e inserta la fila — todo en una sola llamada. password_rol viaja SOLO en el resultado de esta llamada: no queda recuperable en texto plano después (mismo criterio que cualquier secret manager, ver quickstart.md). Falla con 23505 si la organización ya tiene servidor: no hay "reemplazar servidor" en esta spec. En public (no private): es la función que Refine llama vía supabaseClient.rpc — private no es alcanzable por PostgREST (api.schemas en supabase/config.toml), ver nota de desvío al inicio del archivo.';

revoke execute on function public.aprovisionar_servidor_organizacion(uuid, text, text, text, integer) from public;
grant execute on function public.aprovisionar_servidor_organizacion(uuid, text, text, text, integer) to authenticated;

create or replace function public.crear_conexion(
  p_organizacion_id uuid,
  p_sistema_externo text,
  p_credencial text
)
returns public.conexiones
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vault_id uuid;
  v_conexion public.conexiones;
begin
  if not (select private.es_administrador_de(p_organizacion_id)) then
    raise exception 'No puede gestionar conexiones de esta organización' using errcode = '42501';
  end if;

  if not exists (select 1 from public.organizaciones o where o.id = p_organizacion_id) then
    raise exception 'La organización % no existe', p_organizacion_id using errcode = 'P0002';
  end if;

  v_vault_id := vault.create_secret(p_credencial);

  insert into public.conexiones (organizacion_id, sistema_externo, credencial_vault_id, created_by)
  values (p_organizacion_id, p_sistema_externo, v_vault_id, (select auth.uid()))
  returning * into v_conexion;

  return v_conexion;
end;
$$;

comment on function public.crear_conexion(uuid, text, text) is
  'Contrato: specs/013-orquestacion-multi-organizacion/contracts/gestion-conexiones-y-servidores.md. La app nunca inserta la fila directo con el valor plano: esta función guarda la credencial en Vault y crea la fila en un solo paso, con estado inicial activa. En public (no private): ver nota de desvío al inicio del archivo.';

revoke execute on function public.crear_conexion(uuid, text, text) from public;
grant execute on function public.crear_conexion(uuid, text, text) to authenticated;

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

  update public.conexiones set updated_at = clock_timestamp() where id = p_conexion_id;
end;
$$;

comment on function public.actualizar_credencial_conexion(uuid, text) is
  'Contrato: specs/013-orquestacion-multi-organizacion/contracts/gestion-conexiones-y-servidores.md. Rota el secreto de Vault de una conexión existente sin cambiar su id ni su estado. No devuelve la credencial anterior ni la nueva. En public (no private): ver nota de desvío al inicio del archivo.';

revoke execute on function public.actualizar_credencial_conexion(uuid, text) from public;
grant execute on function public.actualizar_credencial_conexion(uuid, text) to authenticated;

create or replace function public.obtener_credencial_conexion(p_conexion_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organizacion_id uuid;
  v_vault_id uuid;
begin
  select c.organizacion_id, c.credencial_vault_id into v_organizacion_id, v_vault_id
  from public.conexiones c where c.id = p_conexion_id;

  -- Existencia y permiso se resuelven en un único chequeo/mensaje: no hace
  -- falta distinguir "no existe" de "no tiene permiso" para quien pide una
  -- credencial (R4) — es información que no aporta y sí podría filtrar.
  if v_organizacion_id is null or not (
    session_user = 'kestra_orquestacion'
    or (select private.es_administrador_de(v_organizacion_id))
  ) then
    raise exception 'No puede leer la credencial de esta conexión' using errcode = '42501';
  end if;

  return (select vs.decrypted_secret from vault.decrypted_secrets vs where vs.id = v_vault_id);
end;
$$;

comment on function public.obtener_credencial_conexion(uuid) is
  'Contrato: specs/013-orquestacion-multi-organizacion/contracts/gestion-conexiones-y-servidores.md (R4). Único punto de acceso a la credencial de negocio descifrada: valida permiso antes de leer vault.decrypted_secrets, nunca expuesta directo (FR-006/FR-007). session_user = kestra_orquestacion cubre la ejecución real (JDBC directo, no PostgREST); un administrador de la organización (o superadmin) puede usarla igual desde Refine, por ejemplo para una prueba de conexión — por eso vive en public y no en private, ver nota de desvío al inicio del archivo.';

revoke execute on function public.obtener_credencial_conexion(uuid) from public;
grant execute on function public.obtener_credencial_conexion(uuid) to authenticated;
grant execute on function public.obtener_credencial_conexion(uuid) to kestra_orquestacion;

create or replace function public.obtener_credencial_servidor(p_organizacion_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_vault_id uuid;
begin
  select s.credencial_ssh_vault_id into v_vault_id
  from public.servidores_organizacion s where s.organizacion_id = p_organizacion_id;

  if v_vault_id is null or not (
    session_user = 'kestra_orquestacion'
    or (select private.es_administrador_de(p_organizacion_id))
  ) then
    raise exception 'No puede leer la credencial del servidor de esta organización' using errcode = '42501';
  end if;

  return (select vs.decrypted_secret from vault.decrypted_secrets vs where vs.id = v_vault_id);
end;
$$;

comment on function public.obtener_credencial_servidor(uuid) is
  'Contrato: specs/013-orquestacion-multi-organizacion/contracts/gestion-conexiones-y-servidores.md (R4). Ídem public.obtener_credencial_conexion, para la credencial SSH de infraestructura de servidores_organizacion. En public (no private): ver nota de desvío al inicio del archivo.';

revoke execute on function public.obtener_credencial_servidor(uuid) from public;
grant execute on function public.obtener_credencial_servidor(uuid) to authenticated;
grant execute on function public.obtener_credencial_servidor(uuid) to kestra_orquestacion;

-- Agregada en Fase 3 (T015, no en data-model.md original): el flow de
-- despacho necesita el host/puerto/usuario del servidor de la organización
-- para su tarea SSH, y el conexion_id para pedir la credencial de negocio
-- después — pero kestra_orquestacion no tiene (ni debe tener, mismo
-- criterio que kestra_backups en spec 011: acceso solo por función, nunca
-- select de tabla directo) ningún GRANT sobre servidores_organizacion ni
-- conexiones. Sin secretos acá (host/puerto/usuario no son secretos, R3):
-- security definer solo para poder leer las tablas pese a que
-- kestra_orquestacion no tiene select sobre ellas, no por control de
-- acceso adicional (ese ya lo resuelve el grant execute exclusivo de
-- abajo). Si una organización tiene más de una conexión al mismo
-- sistema_externo (R10, permitido a propósito) esta función toma la más
-- reciente — desambiguar cuál usa el flow genérico por defecto queda
-- fuera de alcance por ahora (research.md R10, "alternatives considered").
create or replace function private.datos_despacho_conexion(
  p_organizacion_id uuid,
  p_sistema_externo text
)
returns table (
  conexion_id uuid,
  host text,
  puerto_ssh integer,
  usuario_ssh text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_resultado record;
begin
  select c.id, s.host, s.puerto_ssh, s.usuario_ssh
  into v_resultado
  from public.conexiones c
  join public.servidores_organizacion s on s.organizacion_id = c.organizacion_id
  where c.organizacion_id = p_organizacion_id
    and c.sistema_externo = p_sistema_externo
  order by c.created_at desc
  limit 1;

  if v_resultado is null then
    raise exception 'No hay conexión a % para la organización %, o no tiene servidor aprovisionado', p_sistema_externo, p_organizacion_id using errcode = 'P0002';
  end if;

  return query select v_resultado.id, v_resultado.host, v_resultado.puerto_ssh, v_resultado.usuario_ssh;
end;
$$;

comment on function private.datos_despacho_conexion(uuid, text) is
  'Contrato: specs/013-orquestacion-multi-organizacion/contracts/orquestacion-kestra.md (paso 3, despacho). Único punto por el que infra/kestra/flows/plantilla-generico.yml/plantilla-dedicado.yml resuelven a qué conexión y servidor despachar, sin darle a kestra_orquestacion select directo sobre las tablas (mismo criterio que kestra_backups, spec 011). No expone ningún *_vault_id — las credenciales siguen saliendo únicamente por obtener_credencial_conexion/obtener_credencial_servidor.';

revoke execute on function private.datos_despacho_conexion(uuid, text) from public, authenticated, anon;
grant execute on function private.datos_despacho_conexion(uuid, text) to kestra_orquestacion;

-- Fase 4 (US2, T018): Kestra necesita el universo de organizaciones activas
-- para un conector, pero no SELECT sobre las tablas de dominio. La funcion
-- devuelve solo UUIDs y aplica la exclusion de flows dedicados (FR-005), sin
-- exponer credenciales ni columnas *_vault_id.
create or replace function private.organizaciones_activas_para_conector(
  p_sistema_externo text
)
returns table (organizacion_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct c.organizacion_id
  from public.conexiones c
  where c.sistema_externo = p_sistema_externo
    and c.estado = 'activa'
    and not exists (
      select 1
      from public.excepciones_flow_generico e
      where e.organizacion_id = c.organizacion_id
        and e.conector_id = p_sistema_externo
    )
  order by c.organizacion_id;
$$;

comment on function private.organizaciones_activas_para_conector(text) is
  'Contrato: specs/013-orquestacion-multi-organizacion/contracts/orquestacion-kestra.md (US2, FR-005). Devuelve los UUID de organizaciones con una conexion activa para el conector, excluyendo las que tienen flow dedicado. Kestra no recibe SELECT directo sobre conexiones ni excepciones_flow_generico.';

revoke execute on function private.organizaciones_activas_para_conector(text) from public, authenticated, anon;
grant execute on function private.organizaciones_activas_para_conector(text) to kestra_orquestacion;

create or replace function private.marcar_conexion_activa(p_conexion_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.conexiones
  set estado = 'activa', updated_at = clock_timestamp()
  where id = p_conexion_id and estado <> 'activa';
$$;

comment on function private.marcar_conexion_activa(uuid) is
  'Contrato: specs/013-orquestacion-multi-organizacion/contracts/orquestacion-kestra.md (R9). Llamada por el propio flow al completar sin error de credencial contra esta conexión — limpia error/credencial_invalida sin ninguna acción del administrador (FR-013). No-op si ya estaba activa (Principio III).';

revoke execute on function private.marcar_conexion_activa(uuid) from public, authenticated, anon;
grant execute on function private.marcar_conexion_activa(uuid) to kestra_orquestacion;

create or replace function private.marcar_conexion_credencial_invalida(p_conexion_id uuid, p_motivo text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.conexiones
  set estado = 'credencial_invalida', updated_at = clock_timestamp()
  where id = p_conexion_id;
$$;

comment on function private.marcar_conexion_credencial_invalida(uuid, text) is
  'Contrato: specs/013-orquestacion-multi-organizacion/contracts/orquestacion-kestra.md (R9). Solo cambia el estado — no registra la alerta: eso lo hace el flow por separado invocando el subflow de alertas (private.registrar_alerta), que es el único punto de inserción en "alertas" (contracts/alertas.md, "este subflow no vuelve a tocar conexiones"). p_motivo se acepta por simetría con esa llamada pero no se persiste acá (no hay columna para eso en conexiones): el motivo real queda en alertas.motivo.';

revoke execute on function private.marcar_conexion_credencial_invalida(uuid, text) from public, authenticated, anon;
grant execute on function private.marcar_conexion_credencial_invalida(uuid, text) to kestra_orquestacion;

create or replace function private.registrar_alerta(
  p_tipo text,
  p_organizacion_id uuid,
  p_conexion_id uuid,
  p_motivo text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_tipo not in ('tecnica', 'credencial') then
    raise exception 'Tipo de alerta inválido: %', p_tipo using errcode = '22023';
  end if;

  insert into public.alertas (tipo, organizacion_id, conexion_id, motivo)
  values (p_tipo, p_organizacion_id, p_conexion_id, p_motivo);
end;
$$;

comment on function private.registrar_alerta(text, uuid, uuid, text) is
  'Contrato: specs/013-orquestacion-multi-organizacion/contracts/alertas.md (R8, FR-011). Llamada desde el subflow centralizado de alertas — único punto de inserción en "alertas", sin lógica de notificación repetida por flow.';

revoke execute on function private.registrar_alerta(text, uuid, uuid, text) from public, authenticated, anon;
grant execute on function private.registrar_alerta(text, uuid, uuid, text) to kestra_orquestacion;

-- kestra_orquestacion necesita USAGE en private para poder ejecutar las
-- funciones concedidas arriba (mismo motivo que "grant usage on schema
-- private to authenticated" de la spec 003 — sin esto, el GRANT EXECUTE
-- puntual no alcanza).
grant usage on schema private to kestra_orquestacion;

-- ============================================================================
-- RLS
-- ============================================================================

alter table servidores_organizacion enable row level security;
alter table conexiones enable row level security;
alter table excepciones_flow_generico enable row level security;
alter table alertas enable row level security;

-- servidores_organizacion: superadmin ve todas, administrador de esa
-- organización ve la suya. Sin policy de insert/update: el único camino es
-- public.aprovisionar_servidor_organizacion (security definer, bypassa
-- RLS como dueño de la tabla) — no hay "alta directa" para authenticated.
create policy servidores_organizacion_select on servidores_organizacion
  for select to authenticated
  using ((select private.es_administrador_de(organizacion_id)));

-- conexiones: mismo criterio de acceso para las 4 operaciones (FR-009), pero
-- solo select/delete tienen GRANT de tabla para authenticated más abajo —
-- insert/update quedan sin GRANT a propósito (contracts/gestion-conexiones-y-servidores.md
-- #3/#4: "nunca un insert/update directo del cliente", solo vía
-- public.crear_conexion/actualizar_credencial_conexion). Las policies de
-- insert/update quedan igual definidas como cinturón de seguridad si algún
-- día se otorga el GRANT.
create policy conexiones_select on conexiones
  for select to authenticated
  using ((select private.es_administrador_de(organizacion_id)));

create policy conexiones_insert on conexiones
  for insert to authenticated
  with check ((select private.es_administrador_de(organizacion_id)));

create policy conexiones_update on conexiones
  for update to authenticated
  using ((select private.es_administrador_de(organizacion_id)))
  with check ((select private.es_administrador_de(organizacion_id)));

create policy conexiones_delete on conexiones
  for delete to authenticated
  using ((select private.es_administrador_de(organizacion_id)));

-- excepciones_flow_generico: decisión de operación de plataforma, no de la
-- organización (FR-005) — solo superadmin, para las 3 operaciones.
create policy excepciones_flow_generico_select on excepciones_flow_generico
  for select to authenticated
  using ((select private.is_superadmin()));

create policy excepciones_flow_generico_insert on excepciones_flow_generico
  for insert to authenticated
  with check ((select private.is_superadmin()));

create policy excepciones_flow_generico_delete on excepciones_flow_generico
  for delete to authenticated
  using ((select private.is_superadmin()));

-- alertas: superadmin ve todas; un administrador de organización solo ve
-- sus propias alertas de tipo credencial — una falla técnica genérica es
-- audiencia exclusiva de quien opera la plataforma (FR-012).
create policy alertas_select on alertas
  for select to authenticated
  using (
    (select private.is_superadmin())
    or (
      tipo = 'credencial'
      and organizacion_id is not null
      and (select private.es_administrador_de(alertas.organizacion_id))
    )
  );

-- ============================================================================
-- Grants (auto_expose_new_tables = false: hacen falta explícitos). Columnas
-- *_vault_id excluidas de los grants de columna: nunca legibles directo por
-- authenticated, solo a través de las funciones de arriba (R4).
-- ============================================================================

revoke all on table servidores_organizacion from anon, authenticated;
grant select (id, organizacion_id, host, puerto_ssh, usuario_ssh, rol_db, created_at, updated_at)
  on table servidores_organizacion to authenticated;

revoke all on table conexiones from anon, authenticated;
grant select (id, organizacion_id, sistema_externo, estado, created_by, created_at, updated_at)
  on table conexiones to authenticated;
grant delete on table conexiones to authenticated;

revoke all on table excepciones_flow_generico from anon, authenticated;
grant select, insert, delete on table excepciones_flow_generico to authenticated;

revoke all on table alertas from anon, authenticated;
grant select on table alertas to authenticated;
