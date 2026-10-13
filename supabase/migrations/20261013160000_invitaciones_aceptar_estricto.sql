-- F-USR-01 (MSF-211): segunda devolución del PR #34.
--
-- Esquema: `public` (plataforma, Principio VII); no crea tablas ni columnas.
-- Aditiva: solo `create or replace` de dos funciones; ninguna fila cambia.
--
-- Qué corrige:
--  * aceptar_invitacion devolvía null sin error cuando no había invitación pendiente (cancelada,
--    o cancelada con el borrado de la cuenta fallido) y la página lo tomaba como éxito. Ahora
--    lanza P0002. Si la invitación ya fue aceptada por esta misma cuenta (reintento tras fallar
--    el guardado de la contraseña) devuelve el rol de su membresía: es idempotente.
--  * vincular_invitacion exige además correo confirmado para agregar directo.
--
-- Reversión (documentada, no ejecutada en este PR), en una migración posterior: volver ambas
-- funciones a su definición de 20261013150000_invitaciones_endurecer.sql.

create or replace function public.aceptar_invitacion()
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_inv public.invitaciones_organizacion;
  v_rol text;
begin
  if v_uid is null then
    raise exception 'Sin sesión' using errcode = '42501';
  end if;
  select i.* into v_inv from public.invitaciones_organizacion i
  join auth.users u on u.id = i.auth_user_id and lower(u.email) = i.email
  where i.auth_user_id = v_uid and i.estado = 'pendiente' for update of i;
  if not found then
    -- Reintento: la cuenta ya aceptó esta invitación (la membresía existe) → mismo resultado.
    select m.rol_id into v_rol from public.usuarios_organizacion m
    join public.invitaciones_organizacion i
      on i.auth_user_id = m.user_id and i.organizacion_id = m.organizacion_id and i.estado = 'aceptada'
    where m.user_id = v_uid limit 1;
    if v_rol is not null then
      return v_rol;
    end if;
    raise exception 'Invitación cancelada o inexistente' using errcode = 'P0002';
  end if;
  if v_inv.vence_en <= now() then
    raise exception 'La invitación venció' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.usuarios_organizacion where user_id = v_uid) then
    raise exception 'No se puede aceptar la invitación' using errcode = '23505';
  end if;
  insert into public.usuarios_organizacion (user_id, organizacion_id, rol_id)
  values (v_uid, v_inv.organizacion_id, v_inv.rol_id);
  update public.invitaciones_organizacion set estado = 'aceptada', updated_at = now() where id = v_inv.id;
  insert into public.eventos_membresia (organizacion_id, actor_user_id, target_user_id, target_email, accion, rol_nuevo)
  values (v_inv.organizacion_id, v_uid, v_uid, v_inv.email, 'miembro_agregado', v_inv.rol_id);
  return v_inv.rol_id;
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
