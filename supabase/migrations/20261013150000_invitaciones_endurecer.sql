-- F-USR-01 (MSF-211): endurecimiento tras la revisión del PR #34.
--
-- Esquema: `public` (plataforma, Principio VII); no crea tablas nuevas.
-- Aditiva: una columna nullable, un índice único parcial, un valor más en el
-- check de eventos y funciones reemplazadas (create or replace). Ninguna fila
-- existente cambia.
--
-- Qué corrige:
--  * vincular_invitacion confiaba en `p_user_id` (lo manda el cliente):
--    ahora la cuenta debe tener el mismo correo que la invitación, y para
--    agregar directo (`miembro_agregado`) debe ser una cuenta que ya ingresó.
--  * aceptar_invitacion / mi_invitacion validan el correo de la cuenta.
--  * Una cuenta de Auth no puede estar en dos invitaciones pendientes a la vez
--    (índice único parcial) y cancelar nunca devuelve una cuenta compartida.
--  * eventos_membresia conserva la auditoría cuando se borra la cuenta de Auth
--    (FK a `set null` + `target_email`) y registra la cancelación.
--  * Los mensajes de error no revelan en qué organización está una persona.
--
-- Reversión (documentada, no ejecutada en este PR), en una migración posterior:
--   drop index public.invitaciones_organizacion_auth_user_pendiente_uidx;
--   volver las funciones a su definición de 20261013140001_invitaciones_usuarios (renombrada: la versión 140000 colisionaba con editar_matriz_permisos de main).sql;
--   alter table public.eventos_membresia drop column target_email;
--   y, solo si ninguna fila tiene target_user_id nulo ni accion 'invitacion_cancelada',
--   volver target_user_id a `not null ... on delete cascade` y el check a cinco valores.

-- ---------------------------------------------------------------------------
-- eventos_membresia: la auditoría sobrevive al borrado de la cuenta de Auth.
-- ---------------------------------------------------------------------------

alter table public.eventos_membresia drop constraint eventos_membresia_target_user_id_fkey;
alter table public.eventos_membresia alter column target_user_id drop not null;
alter table public.eventos_membresia
  add constraint eventos_membresia_target_user_id_fkey
  foreign key (target_user_id) references auth.users (id) on delete set null;
alter table public.eventos_membresia add column target_email text;
comment on column public.eventos_membresia.target_email is
  'Correo de la persona destino en eventos de invitación; permite auditar aunque se borre su cuenta de Auth.';

alter table public.eventos_membresia drop constraint eventos_membresia_accion_check;
alter table public.eventos_membresia add constraint eventos_membresia_accion_check
  check (accion in ('invitacion_enviada', 'invitacion_reenviada', 'invitacion_cancelada', 'miembro_agregado', 'rol_cambiado', 'miembro_removido'));

-- Una cuenta de Auth pertenece a una sola invitación pendiente.
create unique index invitaciones_organizacion_auth_user_pendiente_uidx
  on public.invitaciones_organizacion (auth_user_id)
  where estado = 'pendiente' and auth_user_id is not null;

-- ---------------------------------------------------------------------------
-- registrar_invitacion: mismo comportamiento, mensaje que no revela la organización.
-- ---------------------------------------------------------------------------

create or replace function public.registrar_invitacion(p_email text, p_rol_id text)
returns public.invitaciones_organizacion
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_inv public.invitaciones_organizacion;
begin
  if p_rol_id is null or p_rol_id not in ('administrador', 'operador', 'consulta', 'mostrador', 'deposito', 'administracion') then
    raise exception 'Rol inválido' using errcode = '22023';
  end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'Correo inválido' using errcode = '22023';
  end if;
  select private.organizacion_id() into v_org;
  if v_org is null or not private.puede_gestionar_membresias(v_org) then
    raise exception 'No puede gestionar usuarios de esta organización' using errcode = '42501';
  end if;
  -- Una persona pertenece a una sola organización (FR-009, escenario 7). El
  -- mensaje es genérico: no se revela si el correo existe ni en qué organización está.
  if exists (
    select 1 from auth.users u
    join public.usuarios_organizacion m on m.user_id = u.id
    where lower(u.email) = v_email
  ) then
    raise exception 'No se puede invitar a ese correo' using errcode = '23505';
  end if;

  insert into public.invitaciones_organizacion (organizacion_id, email, rol_id, creada_por)
  values (v_org, v_email, p_rol_id, (select auth.uid()))
  on conflict (organizacion_id, email) where estado = 'pendiente'
  do update set rol_id = excluded.rol_id, vence_en = now() + interval '7 days',
    creada_por = excluded.creada_por, updated_at = now()
  returning * into v_inv;
  return v_inv;
end;
$$;

-- ---------------------------------------------------------------------------
-- vincular_invitacion: valida que la cuenta sea la del correo invitado.
-- ---------------------------------------------------------------------------

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
  -- `p_user_id` lo informa el cliente: solo vale si es la cuenta de ese correo.
  select * into v_cuenta from auth.users where id = p_user_id and lower(email) = v_inv.email;
  if not found then
    raise exception 'La cuenta no corresponde al correo invitado' using errcode = '22023';
  end if;
  if exists (select 1 from public.usuarios_organizacion where user_id = p_user_id) then
    raise exception 'No se puede invitar a ese correo' using errcode = '23505';
  end if;
  -- Agregar directo se salta el enlace: solo para una cuenta que ya ingresó alguna vez.
  if p_accion = 'miembro_agregado' and v_cuenta.last_sign_in_at is null then
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

-- ---------------------------------------------------------------------------
-- cancelar_invitacion: registra el evento y nunca devuelve una cuenta compartida.
-- ---------------------------------------------------------------------------

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
  where u.id = v_inv.auth_user_id and u.last_sign_in_at is null
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

-- ---------------------------------------------------------------------------
-- mi_invitacion / aceptar_invitacion: la cuenta debe ser la del correo invitado.
-- ---------------------------------------------------------------------------

create or replace function public.mi_invitacion()
returns table (rol_id text, rol_descripcion text, vence_en timestamptz, vencida boolean)
language sql stable security definer set search_path = ''
as $$
  select i.rol_id, r.descripcion, i.vence_en, i.vence_en <= now()
  from public.invitaciones_organizacion i
  join public.roles_organizacion r on r.id = i.rol_id
  join auth.users u on u.id = i.auth_user_id and lower(u.email) = i.email
  where i.estado = 'pendiente' and i.auth_user_id = (select auth.uid())
  order by i.created_at desc
  limit 1;
$$;

create or replace function public.aceptar_invitacion()
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_inv public.invitaciones_organizacion;
begin
  if v_uid is null then
    raise exception 'Sin sesión' using errcode = '42501';
  end if;
  select i.* into v_inv from public.invitaciones_organizacion i
  join auth.users u on u.id = i.auth_user_id and lower(u.email) = i.email
  where i.auth_user_id = v_uid and i.estado = 'pendiente' for update of i;
  if not found then
    return null;
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
