-- F-USR-01 (MSF-211, épica MSF-125): invitar usuarios con los seis roles de negocio.
--
-- Esquema: `public` (plataforma: ciclo de vida de acceso/membresía, Principio VII).
-- Aditiva: una tabla nueva, funciones nuevas y un check de eventos_membresia
-- ampliado (se agrega un valor; ninguna fila existente cambia).
--
-- Diseño: la membresía (usuarios_organizacion) se crea al ACEPTAR la invitación,
-- no al enviarla. Así una invitación vencida o cancelada no deja acceso aunque
-- la persona recupere su contraseña después. Mientras tanto la invitación
-- pendiente vive solo en `invitaciones_organizacion`. El token real es el de
-- Supabase Auth (`inviteUserByEmail`); la tabla no lo guarda.
--
-- Reversión (documentada, no ejecutada en este PR), en una migración posterior:
--   drop function public.aceptar_invitacion(), public.mi_invitacion(),
--     public.cancelar_invitacion(uuid), public.vincular_invitacion(uuid, uuid, text),
--     public.registrar_invitacion(text, text);
--   drop table public.invitaciones_organizacion;
--   y volver el check de eventos_membresia a sus cuatro valores originales
--   (solo si ninguna fila usa 'invitacion_reenviada').

create table public.invitaciones_organizacion (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  email text not null check (email = lower(email)),
  rol_id text not null references public.roles_organizacion (id),
  -- 'vencida' no se guarda: es 'pendiente' con vence_en en el pasado.
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aceptada', 'cancelada')),
  vence_en timestamptz not null default (now() + interval '7 days'),
  creada_por uuid references auth.users (id) on delete set null,
  -- Cuenta de Auth creada para la invitación. Sin FK: cancelar la borra.
  auth_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.invitaciones_organizacion is
  'Invitaciones a la organización (F-USR-01). Se escribe solo por RPC security definer; RLS de lectura por organización para quien gestiona membresías.';

create unique index invitaciones_organizacion_pendiente_uidx
  on public.invitaciones_organizacion (organizacion_id, email) where estado = 'pendiente';
create index invitaciones_organizacion_auth_user_idx
  on public.invitaciones_organizacion (auth_user_id) where auth_user_id is not null;

alter table public.invitaciones_organizacion enable row level security;

revoke all on table public.invitaciones_organizacion from anon, authenticated;
grant select on table public.invitaciones_organizacion to authenticated;

create policy invitaciones_organizacion_select on public.invitaciones_organizacion
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.puede_gestionar_membresias(organizacion_id))
  );

-- Eventos: `usuario.invitado` (FR-012) = accion 'invitacion_enviada' hasta F-AUD-01.
alter table public.eventos_membresia drop constraint eventos_membresia_accion_check;
alter table public.eventos_membresia add constraint eventos_membresia_accion_check
  check (accion in ('invitacion_enviada', 'invitacion_reenviada', 'miembro_agregado', 'rol_cambiado', 'miembro_removido'));

-- ============================================================================
-- registrar_invitacion: crea o renueva la invitación pendiente (7 días).
-- ============================================================================

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
  -- Una persona pertenece a una sola organización (FR-009, escenario 7).
  if exists (
    select 1 from auth.users u
    join public.usuarios_organizacion m on m.user_id = u.id
    where lower(u.email) = v_email
  ) then
    raise exception 'La persona ya pertenece a una organización' using errcode = '23505';
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
revoke execute on function public.registrar_invitacion(text, text) from public, anon;
grant execute on function public.registrar_invitacion(text, text) to authenticated;

-- ============================================================================
-- vincular_invitacion: la Edge Function informa la cuenta de Auth resultante y
-- emite el evento. Si la cuenta ya existía sin organización, se agrega directo.
-- ============================================================================

create or replace function public.vincular_invitacion(p_invitacion_id uuid, p_user_id uuid, p_accion text)
returns public.invitaciones_organizacion
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_inv public.invitaciones_organizacion;
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
  if exists (select 1 from public.usuarios_organizacion where user_id = p_user_id) then
    raise exception 'La persona ya pertenece a una organización' using errcode = '23505';
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
  insert into public.eventos_membresia (organizacion_id, actor_user_id, target_user_id, accion, rol_nuevo)
  values (v_org, (select auth.uid()), p_user_id, p_accion, v_inv.rol_id);
  return v_inv;
end;
$$;
revoke execute on function public.vincular_invitacion(uuid, uuid, text) from public, anon;
grant execute on function public.vincular_invitacion(uuid, uuid, text) to authenticated;

-- ============================================================================
-- cancelar_invitacion: devuelve la cuenta de Auth a borrar (solo si nunca
-- ingresó), para que la Edge Function invalide el enlace.
-- ============================================================================

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
    and not exists (select 1 from public.usuarios_organizacion m where m.user_id = u.id);
  return v_borrar;
end;
$$;
revoke execute on function public.cancelar_invitacion(uuid) from public, anon;
grant execute on function public.cancelar_invitacion(uuid) to authenticated;

-- ============================================================================
-- mi_invitacion / aceptar_invitacion: lado de la persona invitada.
-- ============================================================================

create or replace function public.mi_invitacion()
returns table (rol_id text, rol_descripcion text, vence_en timestamptz, vencida boolean)
language sql stable security definer set search_path = ''
as $$
  select i.rol_id, r.descripcion, i.vence_en, i.vence_en <= now()
  from public.invitaciones_organizacion i
  join public.roles_organizacion r on r.id = i.rol_id
  where i.estado = 'pendiente' and i.auth_user_id = (select auth.uid())
  limit 1;
$$;
revoke execute on function public.mi_invitacion() from public, anon;
grant execute on function public.mi_invitacion() to authenticated;

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
  select * into v_inv from public.invitaciones_organizacion
  where auth_user_id = v_uid and estado = 'pendiente' for update;
  if not found then
    return null;
  end if;
  if v_inv.vence_en <= now() then
    raise exception 'La invitación venció' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.usuarios_organizacion where user_id = v_uid) then
    raise exception 'La persona ya pertenece a una organización' using errcode = '23505';
  end if;
  insert into public.usuarios_organizacion (user_id, organizacion_id, rol_id)
  values (v_uid, v_inv.organizacion_id, v_inv.rol_id);
  update public.invitaciones_organizacion set estado = 'aceptada', updated_at = now() where id = v_inv.id;
  insert into public.eventos_membresia (organizacion_id, actor_user_id, target_user_id, accion, rol_nuevo)
  values (v_inv.organizacion_id, v_uid, v_uid, 'miembro_agregado', v_inv.rol_id);
  return v_inv.rol_id;
end;
$$;
revoke execute on function public.aceptar_invitacion() from public, anon;
grant execute on function public.aceptar_invitacion() to authenticated;
