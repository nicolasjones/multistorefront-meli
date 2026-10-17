-- F-ROL-07 (MSF-222, devolución PR #101): cambiar_rol_miembro toma el advisory lock por usuario que
-- ya usa asignar_empresas_usuario, para que una promoción concurrente a Administrador no deje filas
-- en usuarios_empresas.
--
-- Esquema (Principio VII): función de plataforma en `public`; no crea ni altera tablas.
-- Migración aditiva (create or replace, misma firma y grants). Camino de reversión: reaplicar la
-- definición de public.cambiar_rol_miembro de 20261014120000_usuarios_suspension_y_roles.sql.

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

  -- Un objetivo inexistente responde igual que uno ajeno: no se puede sondear qué UUID existe.
  if not found then
    raise exception 'No puede gestionar miembros de esta organización' using errcode = '42501';
  end if;

  if not (select private.puede_gestionar_membresias(v_organizacion_id)) then
    raise exception 'No puede gestionar miembros de esta organización' using errcode = '42501';
  end if;

  -- El bloqueo va después de autorizar: quien no gestiona esta organización no llega a tomarlo.
  perform 1 from public.organizaciones o where o.id = v_organizacion_id for update;

  -- Mismo lock que asignar_empresas_usuario (F-ROL-07): serializa una promoción a Administrador
  -- con una asignación de empresas concurrente sobre el mismo usuario.
  perform pg_advisory_xact_lock(hashtext(p_target_user_id::text));

  -- Se relee el objetivo con la organización bloqueada: otro Administrador pudo cambiarlo entre la lectura y el bloqueo.
  select u.rol_id, u.estado into v_rol_anterior, v_estado
    from public.usuarios_organizacion u
    where u.user_id = p_target_user_id;

  if not found then
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

revoke execute on function public.cambiar_rol_miembro(uuid, text) from public, anon;
grant execute on function public.cambiar_rol_miembro(uuid, text) to authenticated;
