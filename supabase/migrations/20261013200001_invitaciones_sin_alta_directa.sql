-- F-USR-01 (MSF-211): quinta devolución del PR #34.
--
-- Esquema: `public` (plataforma, Principio VII); no crea tablas ni columnas.
-- Aditiva: solo `create or replace` de `vincular_invitacion`; ninguna fila cambia.
--
-- Qué corrige: `vincular_invitacion` aceptaba `miembro_agregado` y daba de alta a una cuenta
-- existente sin que aceptara (FR-009/FR-010 exigen invitación con enlace y aceptación de la
-- persona). Ahora solo admite `invitacion_enviada` e `invitacion_reenviada` y solo vincula la
-- cuenta creada por la invitación (`invited_at`); la membresía solo nace en `aceptar_invitacion`.
-- Por eso tampoco se puede saltar la edge function llamando al RPC con `miembro_agregado`.
--
-- Reversión (documentada, no ejecutada en este PR), en una migración posterior: volver la función
-- a su definición de 20261013190001_invitaciones_cuenta_invitada.sql.

create or replace function public.vincular_invitacion(p_invitacion_id uuid, p_user_id uuid, p_accion text)
returns public.invitaciones_organizacion
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_inv public.invitaciones_organizacion;
  v_cuenta auth.users;
begin
  if p_accion not in ('invitacion_enviada', 'invitacion_reenviada') then
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
  -- Enviar o reenviar el enlace solo vincula la cuenta que Auth creó para invitar (`invited_at`):
  -- una cuenta registrada por su cuenta no queda atada a la invitación ni es candidata a borrarse.
  if v_cuenta.invited_at is null then
    raise exception 'La cuenta no fue creada por una invitación' using errcode = '22023';
  end if;

  update public.invitaciones_organizacion
    set auth_user_id = p_user_id, updated_at = now()
    where id = v_inv.id returning * into v_inv;
  insert into public.eventos_membresia (organizacion_id, actor_user_id, target_user_id, target_email, accion, rol_nuevo)
  values (v_org, (select auth.uid()), p_user_id, v_inv.email, p_accion, v_inv.rol_id);
  return v_inv;
end;
$$;
