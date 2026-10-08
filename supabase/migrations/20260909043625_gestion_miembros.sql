create table eventos_membresia (
  id bigint generated always as identity primary key,
  organizacion_id uuid not null references organizaciones (id) on delete cascade,
  actor_user_id uuid not null references auth.users (id) on delete cascade,
  target_user_id uuid not null references auth.users (id) on delete cascade,
  accion text not null check (accion in ('invitacion_enviada', 'miembro_agregado', 'rol_cambiado', 'miembro_removido')),
  rol_anterior text references roles_organizacion (id),
  rol_nuevo text references roles_organizacion (id),
  created_at timestamptz not null default clock_timestamp()
);

create index eventos_membresia_organizacion_id_id_idx on eventos_membresia (organizacion_id, id desc);
alter table eventos_membresia enable row level security;

create or replace function private.puede_gestionar_membresias(p_organizacion_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.usuarios_organizacion u
    where u.user_id = (select auth.uid())
      and u.organizacion_id = p_organizacion_id and u.rol_id = 'administrador'
  ) or (
    (select private.is_superadmin()) and exists (
      select 1 from public.superadmin_organizacion_activa a
      where a.user_id = (select auth.uid()) and a.organizacion_id = p_organizacion_id
    )
  );
$$;
revoke execute on function private.puede_gestionar_membresias(uuid) from public;
grant execute on function private.puede_gestionar_membresias(uuid) to authenticated;

drop policy usuarios_organizacion_select on usuarios_organizacion;
create policy usuarios_organizacion_select on usuarios_organizacion for select to authenticated
using (user_id = (select auth.uid()) or (select private.puede_gestionar_membresias(organizacion_id)));

create or replace function public.agregar_miembro(p_target_user_id uuid, p_rol_id text, p_accion text)
returns usuarios_organizacion
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid; v_result public.usuarios_organizacion;
begin
  if p_rol_id not in ('administrador', 'miembro') or p_accion not in ('invitacion_enviada', 'miembro_agregado') then
    raise exception 'Rol o acción inválidos' using errcode = '22023';
  end if;
  select private.organizacion_id() into v_org;
  if v_org is null or not private.puede_gestionar_membresias(v_org) then
    raise exception 'No puede gestionar miembros de esta organización' using errcode = '42501';
  end if;
  if exists (select 1 from public.usuarios_organizacion where user_id = p_target_user_id) then
    raise exception 'La persona ya pertenece a una organización' using errcode = '23505';
  end if;
  insert into public.usuarios_organizacion (user_id, organizacion_id, rol_id)
  values (p_target_user_id, v_org, p_rol_id) returning * into v_result;
  insert into public.eventos_membresia (organizacion_id, actor_user_id, target_user_id, accion, rol_nuevo)
  values (v_org, (select auth.uid()), p_target_user_id, p_accion, p_rol_id);
  return v_result;
end;
$$;
revoke execute on function public.agregar_miembro(uuid, text, text) from public;
grant execute on function public.agregar_miembro(uuid, text, text) to authenticated;

grant select on eventos_membresia to authenticated;
