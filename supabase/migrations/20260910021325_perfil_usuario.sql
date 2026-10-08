-- Perfil personal (spec 008). Reversión: primero deshabilitar el hook en
-- config.toml y desplegarlo; luego retirar policies, trigger y grants. Conservar
-- las tablas y el bucket hasta exportar o eliminar explícitamente sus datos.

create table public.perfiles_usuario (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nombre text,
  apellido text,
  foto_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint perfiles_usuario_nombre_apellido_completos check (
    (nombre is null and apellido is null)
    or (btrim(nombre) <> '' and btrim(apellido) <> '')
  ),
  constraint perfiles_usuario_foto_path_valido check (
    foto_path is null or foto_path = user_id::text || '/avatar'
  )
);

create table public.eventos_seguridad_usuario (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  tipo text not null check (tipo in (
    'inicio_sesion',
    'contrasena_modificada',
    'correo_modificado'
  )),
  created_at timestamptz not null default now()
);

create index eventos_seguridad_usuario_user_id_created_at_idx
  on public.eventos_seguridad_usuario (user_id, created_at desc, id desc);

-- on conflict do nothing: el runner self-hosted de CI resetea `public`/
-- `private` entre corridas (scripts/reset-db-ci.sh) pero no `storage` — sin
-- esto, reaplicar esta migración en una base donde el bucket ya existe
-- rompe con "duplicate key value violates unique constraint buckets_pkey".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fotos-perfil',
  'fotos-perfil',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

alter table public.perfiles_usuario enable row level security;
alter table public.eventos_seguridad_usuario enable row level security;

create policy perfiles_usuario_select_titular
  on public.perfiles_usuario for select to authenticated
  using (user_id = (select auth.uid()));

create policy perfiles_usuario_insert_titular
  on public.perfiles_usuario for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and btrim(nombre) <> ''
    and btrim(apellido) <> ''
  );

create policy perfiles_usuario_update_titular
  on public.perfiles_usuario for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and btrim(nombre) <> ''
    and btrim(apellido) <> ''
  );

create policy eventos_seguridad_usuario_select_titular
  on public.eventos_seguridad_usuario for select to authenticated
  using (user_id = (select auth.uid()));

-- Solo Auth inserta eventos de inicio de sesión. Los disparadores internos de
-- auth.users se ejecutan como dueño y no precisan exponer escrituras al cliente.
create policy eventos_seguridad_usuario_insert_auth
  on public.eventos_seguridad_usuario for insert to supabase_auth_admin
  with check (true);

-- drop policy if exists + create (en vez de solo create): igual que el
-- insert del bucket arriba, storage.objects no se resetea entre corridas
-- del job `database` en el runner self-hosted — reaplicar esta migración
-- sin esto rompe con "policy ... already exists".
drop policy if exists fotos_perfil_select on storage.objects;
drop policy if exists fotos_perfil_insert_titular on storage.objects;
drop policy if exists fotos_perfil_update_titular on storage.objects;
drop policy if exists fotos_perfil_delete_titular on storage.objects;

create policy fotos_perfil_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'fotos-perfil'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/avatar$'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (
        select 1
        from public.usuarios_organizacion objetivo
        where objetivo.user_id = (storage.foldername(name))[1]::uuid
          and objetivo.organizacion_id = (select private.organizacion_id())
      )
    )
  );

create policy fotos_perfil_insert_titular
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'fotos-perfil'
    and name = (select auth.uid())::text || '/avatar'
  );

create policy fotos_perfil_update_titular
  on storage.objects for update to authenticated
  using (
    bucket_id = 'fotos-perfil'
    and name = (select auth.uid())::text || '/avatar'
  )
  with check (
    bucket_id = 'fotos-perfil'
    and name = (select auth.uid())::text || '/avatar'
  );

create policy fotos_perfil_delete_titular
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'fotos-perfil'
    and name = (select auth.uid())::text || '/avatar'
  );

create or replace function private.registrar_cambios_seguridad_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    insert into public.eventos_seguridad_usuario (user_id, tipo)
    values (new.id, 'contrasena_modificada');
  end if;

  if new.email is distinct from old.email then
    insert into public.eventos_seguridad_usuario (user_id, tipo)
    values (new.id, 'correo_modificado');
  end if;

  return new;
end;
$$;

create trigger registrar_cambios_seguridad_usuario
  after update of encrypted_password, email on auth.users
  for each row
  when (
    old.encrypted_password is distinct from new.encrypted_password
    or old.email is distinct from new.email
  )
  execute function private.registrar_cambios_seguridad_usuario();

create or replace function public.registrar_inicio_sesion(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if event ->> 'authentication_method' <> 'token_refresh' then
    insert into public.eventos_seguridad_usuario (user_id, tipo)
    values ((event ->> 'user_id')::uuid, 'inicio_sesion');
  end if;

  return jsonb_build_object('claims', event -> 'claims');
end;
$$;

revoke all on function private.registrar_cambios_seguridad_usuario() from public;
revoke all on function public.registrar_inicio_sesion(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.registrar_inicio_sesion(jsonb) to supabase_auth_admin;

grant select, insert, update on public.perfiles_usuario to authenticated;
grant select on public.eventos_seguridad_usuario to authenticated;
grant insert on public.eventos_seguridad_usuario to supabase_auth_admin;
