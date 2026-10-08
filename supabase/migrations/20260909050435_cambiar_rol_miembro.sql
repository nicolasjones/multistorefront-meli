create function public.cambiar_rol_miembro(p_target_user_id uuid, p_nuevo_rol text)
returns public.usuarios_organizacion
language plpgsql security definer set search_path = ''
as $$
declare
  v_organizacion_id uuid;
  v_rol_anterior text;
  v_administradores integer;
  v_result public.usuarios_organizacion;
begin
  if p_nuevo_rol not in ('administrador', 'miembro') then
    raise exception 'Rol inválido' using errcode = '22023';
  end if;

  if p_target_user_id = (select auth.uid()) then
    raise exception 'No puede cambiar su propio rol' using errcode = '22023';
  end if;

  select u.organizacion_id, u.rol_id
    into v_organizacion_id, v_rol_anterior
    from public.usuarios_organizacion u
    where u.user_id = p_target_user_id;

  if not found then
    raise exception 'Miembro inexistente' using errcode = 'P0002';
  end if;

  perform 1
    from public.organizaciones o
    where o.id = v_organizacion_id
    for update;

  if not (select private.puede_gestionar_membresias(v_organizacion_id)) then
    raise exception 'No puede gestionar miembros de esta organización' using errcode = '42501';
  end if;

  if v_rol_anterior = p_nuevo_rol then
    raise exception 'El miembro ya tiene ese rol' using errcode = '22023';
  end if;

  if v_rol_anterior = 'administrador' and p_nuevo_rol = 'miembro' then
    select count(*)
      into v_administradores
      from public.usuarios_organizacion u
      where u.organizacion_id = v_organizacion_id
        and u.rol_id = 'administrador';

    if v_administradores <= 1 then
      raise exception 'La organización debe conservar al menos un administrador' using errcode = '23514';
    end if;
  end if;

  update public.usuarios_organizacion
    set rol_id = p_nuevo_rol
    where user_id = p_target_user_id
    returning * into v_result;

  insert into public.eventos_membresia (
    organizacion_id,
    actor_user_id,
    target_user_id,
    accion,
    rol_anterior,
    rol_nuevo
  ) values (
    v_organizacion_id,
    (select auth.uid()),
    p_target_user_id,
    'rol_cambiado',
    v_rol_anterior,
    p_nuevo_rol
  );

  return v_result;
end;
$$;

revoke execute on function public.cambiar_rol_miembro(uuid, text) from public;
grant execute on function public.cambiar_rol_miembro(uuid, text) to authenticated;
