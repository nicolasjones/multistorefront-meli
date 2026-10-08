create function public.remover_miembro(p_target_user_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_organizacion_id uuid;
  v_rol_anterior text;
  v_administradores integer;
begin
  if p_target_user_id = (select auth.uid()) then
    raise exception 'No puede removerse a sí mismo' using errcode = '22023';
  end if;

  select u.organizacion_id, u.rol_id
    into v_organizacion_id, v_rol_anterior
    from public.usuarios_organizacion u
    where u.user_id = p_target_user_id;

  if not found then
    raise exception 'Miembro inexistente' using errcode = 'P0002';
  end if;

  perform 1 from public.organizaciones o where o.id = v_organizacion_id for update;

  if not (select private.puede_gestionar_membresias(v_organizacion_id)) then
    raise exception 'No puede gestionar miembros de esta organización' using errcode = '42501';
  end if;

  if v_rol_anterior = 'administrador' then
    select count(*) into v_administradores
      from public.usuarios_organizacion u
      where u.organizacion_id = v_organizacion_id and u.rol_id = 'administrador';
    if v_administradores <= 1 then
      raise exception 'La organización debe conservar al menos un administrador' using errcode = '23514';
    end if;
  end if;

  delete from public.usuarios_organizacion where user_id = p_target_user_id;

  insert into public.eventos_membresia (
    organizacion_id, actor_user_id, target_user_id, accion, rol_anterior
  ) values (
    v_organizacion_id, (select auth.uid()), p_target_user_id, 'miembro_removido', v_rol_anterior
  );

  return true;
end;
$$;

revoke execute on function public.remover_miembro(uuid) from public;
grant execute on function public.remover_miembro(uuid) to authenticated;
