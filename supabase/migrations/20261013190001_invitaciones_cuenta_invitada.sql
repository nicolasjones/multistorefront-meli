-- F-USR-01 (MSF-211): cuarta devolución del PR #34.
--
-- Esquema: `public` (plataforma, Principio VII); no crea tablas ni columnas.
-- Aditiva: solo `create or replace` de `cancelar_invitacion` y `vincular_invitacion`.
--
-- Qué corrige: la cuenta que `cancelar_invitacion` devuelve para borrar se identificaba por
-- `u.created_at >= invitación.created_at`, que no cambia al renovar la invitación y deja que una
-- persona registrada por su cuenta después de crearla quede vinculada y borrable. Ahora se exige
-- `auth.users.invited_at`, que Auth fija solo en cuentas creadas por `inviteUserByEmail`, tanto al
-- vincular una invitación como al decidir qué cuenta se borra.
--
-- Reversión (documentada, no ejecutada en este PR), en una migración posterior: volver ambas
-- funciones a sus definiciones de 20261013180000 y 20261013160000.

create or replace function public.cancelar_invitacion(p_invitacion_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_inv public.invitaciones_organizacion;
  v_borrar uuid;
begin
  select private.organizacion_id() into v_org;
  if v_org is null or not private.puede_gestionar_membresias(v_org) then
    raise exception 'No puede gestionar usuarios de esta organización' using errcode = '42501';
  end if;
  update public.invitaciones_organizacion set estado = 'cancelada', updated_at = now()
  where id = p_invitacion_id and organizacion_id = v_org and estado = 'pendiente'
  returning * into v_inv;
  if not found then
    raise exception 'Invitación inexistente o no pendiente' using errcode = 'P0002';
  end if;
  select u.id into v_borrar from auth.users u
  where u.id = v_inv.auth_user_id and u.invited_at is not null
    and not exists (select 1 from public.usuarios_organizacion m where m.user_id = u.id)
    and not exists (
      select 1 from public.invitaciones_organizacion o
      where o.auth_user_id = u.id and o.estado = 'pendiente' and o.id <> v_inv.id
    );
  insert into public.eventos_membresia (organizacion_id, actor_user_id, target_user_id, target_email, accion, rol_nuevo)
  values (v_org, (select auth.uid()), v_inv.auth_user_id, v_inv.email, 'invitacion_cancelada', v_inv.rol_id);
  return v_borrar;
end;
$$;

create or replace function public.vincular_invitacion(p_invitacion_id uuid, p_user_id uuid, p_accion text)
returns public.invitaciones_organizacion
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_inv public.invitaciones_organizacion;
  v_cuenta auth.users;
begin
  if p_accion not in ('invitacion_enviada', 'invitacion_reenviada', 'miembro_agregado') then
    raise exception 'Acción inválida' using errcode = '22023';
  end if;
  select private.organizacion_id() into v_org;
  if v_org is null or not private.puede_gestionar_membresias(v_org) then
    raise exception 'No puede gestionar usuarios de esta organización' using errcode = '42501';
  end if;
  select * into v_inv from public.invitaciones_organizacion
  where id = p_invitacion_id and organizacion_id = v_org and estado = 'pendiente' for update;
  if not found then
    raise exception 'Invitación inexistente o no pendiente' using errcode = 'P0002';
  end if;
  select * into v_cuenta from auth.users where id = p_user_id and lower(email) = v_inv.email;
  if not found then
    raise exception 'La cuenta no corresponde al correo invitado' using errcode = '22023';
  end if;
  if exists (select 1 from public.usuarios_organizacion where user_id = p_user_id) then
    raise exception 'No se puede invitar a ese correo' using errcode = '23505';
  end if;
  -- Agregar directo se salta el enlace: solo para una cuenta que ya ingresó y confirmó su correo.
  if p_accion = 'miembro_agregado' and (v_cuenta.last_sign_in_at is null or v_cuenta.email_confirmed_at is null) then
    raise exception 'La cuenta todavía no ingresó: debe aceptar la invitación' using errcode = '22023';
  end if;
  -- Enviar o reenviar el enlace solo vincula la cuenta que Auth creó para invitar (`invited_at`):
  -- una cuenta registrada por su cuenta no queda atada a la invitación ni es candidata a borrarse.
  if p_accion <> 'miembro_agregado' and v_cuenta.invited_at is null then
    raise exception 'La cuenta no fue creada por una invitación' using errcode = '22023';
  end if;

  update public.invitaciones_organizacion
    set auth_user_id = p_user_id, updated_at = now()
    where id = v_inv.id returning * into v_inv;
  if p_accion = 'miembro_agregado' then
    insert into public.usuarios_organizacion (user_id, organizacion_id, rol_id)
    values (p_user_id, v_org, v_inv.rol_id);
    update public.invitaciones_organizacion set estado = 'aceptada', updated_at = now()
      where id = v_inv.id returning * into v_inv;
  end if;
  insert into public.eventos_membresia (organizacion_id, actor_user_id, target_user_id, target_email, accion, rol_nuevo)
  values (v_org, (select auth.uid()), p_user_id, v_inv.email, p_accion, v_inv.rol_id);
  return v_inv;
end;
$$;
