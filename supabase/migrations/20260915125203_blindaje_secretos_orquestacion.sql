-- Blindaje de secretos de orquestación (spec 014). Migración aditiva: crea
-- un rol de grupo y una función interna; no elimina tablas ni secretos.
--
-- Reversión, en este orden:
--   revoke execute on function private.obtener_credencial_para_worker(uuid)
--     from workers_orquestacion;
--   drop function private.obtener_credencial_para_worker(uuid);
--   revoke workers_orquestacion from cada rol worker_<organizacion_id>;
--   drop role workers_orquestacion; -- solo cuando ya no tenga miembros.
-- La membresía de roles creados previamente se debe retirar explícitamente
-- antes de aplicar la reversión en un ambiente con servidores aprovisionados.

-- Rol de grupo sin login. Centraliza únicamente el permiso de la función
-- privada, sin conceder SELECT sobre conexiones, servidores ni Vault.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'workers_orquestacion'
  ) then
    create role workers_orquestacion nologin noinherit;
  end if;
end
$$;

comment on role workers_orquestacion is
  'Grupo de mínimo privilegio para roles worker_<organizacion_id> (spec 014). Solo hereda EXECUTE sobre private.obtener_credencial_para_worker(uuid); Kestra no pertenece al grupo.';

-- El worker entra con su propio rol de conexión. SECURITY DEFINER permite
-- leer Vault después de comprobar, en una sola condición, que ese rol es
-- miembro del grupo y que la conexión pertenece a su organización. El error
-- no distingue inexistencia de falta de permiso ni contiene el secreto.
create or replace function private.obtener_credencial_para_worker(p_conexion_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_credencial_vault_id uuid;
begin
  if not pg_catalog.pg_has_role(session_user, 'workers_orquestacion', 'member') then
    raise exception 'No puede leer la credencial de esta conexión' using errcode = '42501';
  end if;

  select c.credencial_vault_id
    into v_credencial_vault_id
  from public.conexiones c
  join public.servidores_organizacion s
    on s.organizacion_id = c.organizacion_id
  where c.id = p_conexion_id
    and s.rol_db = session_user;

  if v_credencial_vault_id is null then
    raise exception 'No puede leer la credencial de esta conexión' using errcode = '42501';
  end if;

  return (
    select vs.decrypted_secret
    from vault.decrypted_secrets vs
    where vs.id = v_credencial_vault_id
  );
end;
$$;

comment on function private.obtener_credencial_para_worker(uuid) is
  'Devuelve al proceso worker solo la credencial de una conexión de su propia organización (spec 014). Valida session_user y su membresía en workers_orquestacion antes de leer Vault; no expone SELECT directo a tablas ni a Vault.';

revoke all on function private.obtener_credencial_para_worker(uuid)
  from public, anon, authenticated, kestra_orquestacion;
grant usage on schema private to workers_orquestacion;
grant execute on function private.obtener_credencial_para_worker(uuid)
  to workers_orquestacion;

-- Los workers creados después de esta migración obtienen la membresía al
-- aprovisionar su servidor. Kestra conserva su rol separado y nunca recibe
-- este grant.
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
  execute format('grant workers_orquestacion to %I', v_rol_db);

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

revoke execute on function public.aprovisionar_servidor_organizacion(uuid, text, text, text, integer) from public;
grant execute on function public.aprovisionar_servidor_organizacion(uuid, text, text, text, integer) to authenticated;

-- Handler seguro de fallos (spec 014). Sustituye el contrato previo de tres
-- argumentos: Kestra entrega el tipo y uno de los únicos motivos permitidos,
-- nunca errorLogs(), stdout ni stderr. La reversión consiste en revocar el
-- EXECUTE de esta sobrecarga, volver a conceder el de tres argumentos a
-- kestra_orquestacion si se restaura el flow previo y eliminar esta función.
create or replace function private.procesar_falla_orquestacion(
  p_organizacion_id uuid,
  p_conexion_id uuid,
  p_tipo text,
  p_motivo_sanitizado text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_tipo not in ('tecnica', 'credencial') then
    raise exception 'Tipo de falla inválido' using errcode = '22023';
  end if;

  if p_tipo = 'credencial'
    and p_motivo_sanitizado <> 'CREDENCIAL_INVALIDA:' || p_conexion_id::text then
    raise exception 'Motivo de credencial no permitido' using errcode = '22023';
  end if;

  if p_tipo = 'tecnica' and p_motivo_sanitizado <> 'FALLA_TECNICA_SANITIZADA' then
    raise exception 'Motivo técnico no permitido' using errcode = '22023';
  end if;

  if p_tipo = 'credencial' then
    perform private.marcar_conexion_credencial_invalida(p_conexion_id, p_motivo_sanitizado);
  end if;

  perform private.registrar_alerta(p_tipo, p_organizacion_id, p_conexion_id, p_motivo_sanitizado);
end;
$$;

comment on function private.procesar_falla_orquestacion(uuid, uuid, text, text) is
  'Procesa una falla de Kestra con tipo explícito y motivo de lista permitida (spec 014). Evita que errorLogs(), stdout o stderr alcancen alertas o tablas: credencial exige CREDENCIAL_INVALIDA:<conexion_id>; técnica exige FALLA_TECNICA_SANITIZADA.';

revoke all on function private.procesar_falla_orquestacion(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function private.procesar_falla_orquestacion(uuid, uuid, text, text)
  to kestra_orquestacion;

-- El handler de spec 013 infería el tipo leyendo un motivo arbitrario. Se
-- conserva para una reversión explícita, pero Kestra ya no puede invocarlo.
revoke execute on function private.procesar_falla_orquestacion(uuid, uuid, text)
  from kestra_orquestacion;
