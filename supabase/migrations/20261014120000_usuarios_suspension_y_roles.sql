-- MSF-228 · F-USR-02 (FR-011, FR-012, FR-018): listado, edición de rol, suspensión
-- y reactivación de usuarios de la organización.
--
-- Esquema de las tablas tocadas (Principio VII): `usuarios_organizacion` y
-- `eventos_membresia` viven en `public` (plataforma: membresía y su auditoría).
-- No se crea ninguna tabla; las funciones nuevas son RPC en `public`, con la
-- autorización en el cuerpo (security definer, search_path fijo).
--
-- Depende de 20261012140100_usuarios_organizacion_estado.sql y
-- 20261012140300_suspendidos_sin_privilegios.sql (MSF-150, F-ACC-01), copiadas
-- tal cual desde epic/MSF-138 porque esta épica no las tenía. Son idénticas, así
-- que el merge posterior de esa épica no entra en conflicto.
--
-- Migración aditiva. Reversión (en un PR posterior):
--   drop function public.listar_usuarios_organizacion();
--   drop function public.suspender_miembro(uuid);
--   drop function public.reactivar_miembro(uuid);
--   restaurar public.cambiar_rol_miembro(uuid, text) de 20260909050435;
--   restaurar private.nivel_seccion(text) y private.puede_accion(text, text) de
--     20261013130000_roles_basicos_permisos.sql;
--   restaurar el check de eventos_membresia.accion sin 'suspendido'/'reactivado'
--     (solo si no hay filas con esas acciones).

-- ============================================================================
-- Eventos (FR-012): usuario.suspendido y usuario.reactivado reutilizan
-- eventos_membresia hasta que exista F-AUD-01; usuario.rol_cambiado ya es
-- 'rol_cambiado'.
-- ============================================================================

alter table public.eventos_membresia drop constraint eventos_membresia_accion_check;
alter table public.eventos_membresia add constraint eventos_membresia_accion_check
  check (accion in ('invitacion_enviada', 'miembro_agregado', 'rol_cambiado', 'miembro_removido', 'suspendido', 'reactivado'));

-- ============================================================================
-- Un suspendido no tiene nivel en ninguna sección (nota MSF-119 de 20261013130000)
-- ============================================================================

create or replace function private.nivel_seccion(p_seccion text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select private.is_superadmin())
      and exists (select 1 from public.superadmin_organizacion_activa a where a.user_id = (select auth.uid()))
      then 'edicion'
    else coalesce(
      (
        select coalesce(
          (select p.nivel from public.permisos_rol p
            where p.organizacion_id = u.organizacion_id and p.rol_id = u.rol_id and p.seccion = p_seccion),
          (select m.nivel from private.matriz_inicial() m
            where m.rol_id = u.rol_id and m.seccion = p_seccion)
        )
        from public.usuarios_organizacion u
        where u.user_id = (select auth.uid()) and u.estado = 'activo'
      ),
      'ninguno'
    )
  end;
$$;

create or replace function private.puede_accion(p_seccion text, p_accion text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_accion not in ('eliminar', 'exportar', 'ver_costos') then false
    when (select private.is_superadmin())
      and exists (select 1 from public.superadmin_organizacion_activa a where a.user_id = (select auth.uid()))
      then true
    when p_accion = 'eliminar' and (select private.nivel_seccion(p_seccion)) <> 'edicion' then false
    when (select private.nivel_seccion(p_seccion)) = 'ninguno' then false
    else coalesce(
      (
        select coalesce(
          (select pa.permitido from public.permisos_rol_accion pa
            where pa.organizacion_id = u.organizacion_id and pa.rol_id = u.rol_id
              and pa.seccion = p_seccion and pa.accion = p_accion),
          (select ai.permitido from private.matriz_acciones_iniciales() ai
            where ai.rol_id = u.rol_id and ai.seccion = p_seccion and ai.accion = p_accion)
        )
        from public.usuarios_organizacion u
        where u.user_id = (select auth.uid()) and u.estado = 'activo'
      ),
      false
    )
  end;
$$;

-- ============================================================================
-- Listado (FR-011): usuario, rol, último acceso y estado
-- ============================================================================

create or replace function public.listar_usuarios_organizacion()
returns table (
  user_id uuid,
  rol_id text,
  estado text,
  created_at timestamptz,
  nombre text,
  apellido text,
  ultimo_acceso timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with v as (select private.organizacion_id() as organizacion_id)
  select u.user_id, u.rol_id, u.estado, u.created_at, p.nombre, p.apellido, a.last_sign_in_at
  from v
  join public.usuarios_organizacion u on u.organizacion_id = v.organizacion_id
  left join public.perfiles_usuario p on p.user_id = u.user_id
  left join auth.users a on a.id = u.user_id
  where v.organizacion_id is not null
    and private.puede_gestionar_membresias(v.organizacion_id);
$$;

comment on function public.listar_usuarios_organizacion() is
  'Como listar_miembros_organizacion() más estado y último acceso. Solo para quien gestiona membresías de la organización activa (el chequeo vive dentro de la función).';

revoke execute on function public.listar_usuarios_organizacion() from public, anon;
grant execute on function public.listar_usuarios_organizacion() to authenticated;

-- ============================================================================
-- Cambio de rol (FR-011, FR-018): ahora admite los seis roles de negocio y
-- «miembro»; la regla «al menos un Administrador» cuenta solo activos.
-- ============================================================================

create or replace function public.cambiar_rol_miembro(p_target_user_id uuid, p_nuevo_rol text)
returns public.usuarios_organizacion
language plpgsql security definer set search_path = ''
as $$
declare
  v_organizacion_id uuid;
  v_rol_anterior text;
  v_estado text;
  v_otros_administradores integer;
  v_result public.usuarios_organizacion;
begin
  if not exists (select 1 from public.roles_organizacion r where r.id = p_nuevo_rol) then
    raise exception 'Rol inválido' using errcode = '22023';
  end if;

  if p_target_user_id = (select auth.uid()) then
    raise exception 'No puede cambiar su propio rol' using errcode = '22023';
  end if;

  select u.organizacion_id, u.rol_id, u.estado
    into v_organizacion_id, v_rol_anterior, v_estado
    from public.usuarios_organizacion u
    where u.user_id = p_target_user_id;

  if not found then
    raise exception 'Miembro inexistente' using errcode = 'P0002';
  end if;

  perform 1 from public.organizaciones o where o.id = v_organizacion_id for update;

  if not (select private.puede_gestionar_membresias(v_organizacion_id)) then
    raise exception 'No puede gestionar miembros de esta organización' using errcode = '42501';
  end if;

  if v_rol_anterior = p_nuevo_rol then
    raise exception 'El miembro ya tiene ese rol' using errcode = '22023';
  end if;

  if v_rol_anterior = 'administrador' and p_nuevo_rol <> 'administrador' and v_estado = 'activo' then
    select count(*) into v_otros_administradores
      from public.usuarios_organizacion u
      where u.organizacion_id = v_organizacion_id
        and u.rol_id = 'administrador' and u.estado = 'activo'
        and u.user_id <> p_target_user_id;

    if v_otros_administradores < 1 then
      raise exception 'La organización debe conservar al menos un administrador' using errcode = '23514';
    end if;
  end if;

  update public.usuarios_organizacion
    set rol_id = p_nuevo_rol
    where user_id = p_target_user_id
    returning * into v_result;

  insert into public.eventos_membresia (
    organizacion_id, actor_user_id, target_user_id, accion, rol_anterior, rol_nuevo
  ) values (
    v_organizacion_id, (select auth.uid()), p_target_user_id, 'rol_cambiado', v_rol_anterior, p_nuevo_rol
  );

  return v_result;
end;
$$;

-- ============================================================================
-- Suspender y reactivar (FR-011, FR-018)
-- ============================================================================

create or replace function public.suspender_miembro(p_target_user_id uuid)
returns public.usuarios_organizacion
language plpgsql security definer set search_path = ''
as $$
declare
  v_organizacion_id uuid;
  v_rol text;
  v_estado text;
  v_otros_administradores integer;
  v_result public.usuarios_organizacion;
begin
  if p_target_user_id = (select auth.uid()) then
    raise exception 'No puede suspenderse a sí mismo' using errcode = '22023';
  end if;

  select u.organizacion_id, u.rol_id, u.estado
    into v_organizacion_id, v_rol, v_estado
    from public.usuarios_organizacion u
    where u.user_id = p_target_user_id;

  if not found then
    raise exception 'Miembro inexistente' using errcode = 'P0002';
  end if;

  perform 1 from public.organizaciones o where o.id = v_organizacion_id for update;

  if not (select private.puede_gestionar_membresias(v_organizacion_id)) then
    raise exception 'No puede gestionar miembros de esta organización' using errcode = '42501';
  end if;

  if v_estado = 'suspendido' then
    raise exception 'El miembro ya está suspendido' using errcode = '22023';
  end if;

  if v_rol = 'administrador' then
    select count(*) into v_otros_administradores
      from public.usuarios_organizacion u
      where u.organizacion_id = v_organizacion_id
        and u.rol_id = 'administrador' and u.estado = 'activo'
        and u.user_id <> p_target_user_id;

    if v_otros_administradores < 1 then
      raise exception 'La organización debe conservar al menos un administrador' using errcode = '23514';
    end if;
  end if;

  update public.usuarios_organizacion
    set estado = 'suspendido'
    where user_id = p_target_user_id
    returning * into v_result;

  insert into public.eventos_membresia (organizacion_id, actor_user_id, target_user_id, accion, rol_anterior, rol_nuevo)
  values (v_organizacion_id, (select auth.uid()), p_target_user_id, 'suspendido', v_rol, v_rol);

  return v_result;
end;
$$;

create or replace function public.reactivar_miembro(p_target_user_id uuid)
returns public.usuarios_organizacion
language plpgsql security definer set search_path = ''
as $$
declare
  v_organizacion_id uuid;
  v_rol text;
  v_estado text;
  v_result public.usuarios_organizacion;
begin
  select u.organizacion_id, u.rol_id, u.estado
    into v_organizacion_id, v_rol, v_estado
    from public.usuarios_organizacion u
    where u.user_id = p_target_user_id;

  if not found then
    raise exception 'Miembro inexistente' using errcode = 'P0002';
  end if;

  perform 1 from public.organizaciones o where o.id = v_organizacion_id for update;

  if not (select private.puede_gestionar_membresias(v_organizacion_id)) then
    raise exception 'No puede gestionar miembros de esta organización' using errcode = '42501';
  end if;

  if v_estado = 'activo' then
    raise exception 'El miembro ya está activo' using errcode = '22023';
  end if;

  update public.usuarios_organizacion
    set estado = 'activo'
    where user_id = p_target_user_id
    returning * into v_result;

  insert into public.eventos_membresia (organizacion_id, actor_user_id, target_user_id, accion, rol_anterior, rol_nuevo)
  values (v_organizacion_id, (select auth.uid()), p_target_user_id, 'reactivado', v_rol, v_rol);

  return v_result;
end;
$$;

revoke execute on function public.suspender_miembro(uuid), public.reactivar_miembro(uuid) from public, anon;
grant execute on function public.suspender_miembro(uuid), public.reactivar_miembro(uuid) to authenticated;
