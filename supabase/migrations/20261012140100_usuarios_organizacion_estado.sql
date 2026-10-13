-- MSF-150 · F-ACC-01 (FR-004, FR-013): estado de la membresía.
-- Migración aditiva: agrega la columna y ajusta las funciones de RLS para que
-- un usuario suspendido no obtenga organización ni pueda escribir.
--
-- Reversión (en un PR posterior, nunca en el mismo que la crea): restaurar
-- private.organizacion_id() y private.puede_escribir() con las definiciones de
-- 20260908172920_fundacion_multitenant.sql y luego eliminar la columna
-- public.usuarios_organizacion.estado.

alter table public.usuarios_organizacion
  add column estado text not null default 'activo'
  check (estado in ('activo', 'suspendido'));

comment on column public.usuarios_organizacion.estado is
  'activo | suspendido. Un suspendido no ingresa ni lee/escribe datos de la organización (F-ACC-01, FR-004).';

create or replace function private.organizacion_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select organizacion_id from usuarios_organizacion
      where user_id = auth.uid() and estado = 'activo'),
    (select organizacion_id from superadmin_organizacion_activa where user_id = auth.uid())
  );
$$;

create or replace function private.puede_escribir()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from usuarios_organizacion
      where user_id = auth.uid() and rol_id = 'administrador' and estado = 'activo'
    )
    or (
      private.is_superadmin()
      and exists (
        select 1 from superadmin_organizacion_activa where user_id = auth.uid()
      )
    );
$$;
