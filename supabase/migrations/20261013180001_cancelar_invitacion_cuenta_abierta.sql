-- F-USR-01 (MSF-211): tercera devolución del PR #34.
--
-- Esquema: `public` (plataforma, Principio VII); no crea tablas ni columnas.
-- Aditiva: solo `create or replace` de `cancelar_invitacion`; ninguna fila cambia.
--
-- Qué corrige: una cuenta que abrió el enlace pero no definió contraseña (tiene `last_sign_in_at`)
-- ya no quedaba cubierta por «cancelar» (exigía `last_sign_in_at is null`). Ahora se devuelve para
-- borrarla cuando la creó esta invitación (`created_at` posterior a la fila de la invitación, es
-- decir, no es una cuenta preexistente), no tiene membresía y no la usa otra invitación pendiente.
--
-- Reversión (documentada, no ejecutada en este PR), en una migración posterior: volver la función a
-- su definición de 20261013150000_invitaciones_endurecer.sql (condición `u.last_sign_in_at is null`).

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
  where u.id = v_inv.auth_user_id and u.created_at >= v_inv.created_at
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
