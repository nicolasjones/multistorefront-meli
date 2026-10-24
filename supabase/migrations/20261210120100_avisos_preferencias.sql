-- MSF-319 · F-NOT-01 (FR-002, FR-011): preferencias de aviso por usuario.
-- Esquema `public` (Principio VII): dato de la persona, genérico de plataforma.
--
-- Reversión (migración posterior): drop function public.guardar_preferencia_aviso(text, boolean);
-- drop table public.preferencias_aviso;

create table if not exists public.preferencias_aviso (
  user_id uuid not null references auth.users (id) on delete cascade,
  tipo_aviso text not null references public.tipos_aviso (clave) on delete cascade,
  activo boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, tipo_aviso)
);

comment on table public.preferencias_aviso is
  'Preferencia de cada usuario por tipo de aviso (plataforma, esquema public). Sin fila = encendido. Cada usuario lee y escribe solo las suyas; sin delete.';

create index if not exists preferencias_aviso_tipo_idx on public.preferencias_aviso (tipo_aviso);

alter table public.preferencias_aviso enable row level security;

create policy preferencias_aviso_select on public.preferencias_aviso
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy preferencias_aviso_insert on public.preferencias_aviso
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy preferencias_aviso_update on public.preferencias_aviso
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.preferencias_aviso from public, anon;
grant select, insert, update on public.preferencias_aviso to authenticated;

create or replace function public.guardar_preferencia_aviso(p_tipo text, p_activo boolean)
returns table (tipo text, activo boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_seccion text;
begin
  select t.seccion into v_seccion from public.tipos_aviso t where t.clave = p_tipo;
  if not found then
    raise exception 'Tipo de aviso desconocido' using errcode = '22023';
  end if;
  if p_activo is null then
    raise exception 'Falta indicar si el aviso queda encendido o apagado' using errcode = '22023';
  end if;
  -- Solo tipos de secciones a las que el usuario tiene acceso.
  if (select private.nivel_seccion(v_seccion)) = 'ninguno' then
    raise exception 'No tenés acceso a este tipo de aviso' using errcode = '42501';
  end if;

  return query
  insert into public.preferencias_aviso as pa (user_id, tipo_aviso, activo, updated_at)
  values ((select auth.uid()), p_tipo, p_activo, now())
  on conflict (user_id, tipo_aviso)
  do update set activo = excluded.activo, updated_at = now()
  returning pa.tipo_aviso, pa.activo;
end;
$$;

comment on function public.guardar_preferencia_aviso(text, boolean) is
  'Enciende o apaga un tipo de aviso para el usuario actual. 22023 tipo desconocido, 42501 tipo de una sección sin acceso.';

revoke execute on function public.guardar_preferencia_aviso(text, boolean) from public, anon;
grant execute on function public.guardar_preferencia_aviso(text, boolean) to authenticated;
