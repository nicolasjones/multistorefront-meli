-- MSF-150 · F-ACC-01 (FR-004): un suspendido no conserva privilegios de
-- administración. La migración 20261012140100 excluyó a los suspendidos solo en
-- private.organizacion_id() y private.puede_escribir(); estas cuatro funciones
-- de autorización seguían leyendo usuarios_organizacion sin filtrar estado.
--
-- Migración aditiva (create or replace; conserva los grants existentes).
-- Reversión: restaurar cada función con su definición original, sin el filtro
-- de estado: puede_gestionar_membresias en 20260909043625_gestion_miembros.sql,
-- rol_id y puede_gestionar_reportes en 20260909140000_analitica_embebida.sql y
-- es_administrador_de en 20260914150000_orquestacion_multi_organizacion.sql.

create or replace function private.puede_gestionar_membresias(p_organizacion_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.usuarios_organizacion u
    where u.user_id = (select auth.uid())
      and u.organizacion_id = p_organizacion_id and u.rol_id = 'administrador'
      and u.estado = 'activo'
  ) or (
    (select private.is_superadmin()) and exists (
      select 1 from public.superadmin_organizacion_activa a
      where a.user_id = (select auth.uid()) and a.organizacion_id = p_organizacion_id
    )
  );
$$;

create or replace function private.es_administrador_de(p_organizacion_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select private.is_superadmin())
    or exists (
      select 1 from public.usuarios_organizacion u
      where u.user_id = (select auth.uid())
        and u.organizacion_id = p_organizacion_id
        and u.rol_id = 'administrador'
        and u.estado = 'activo'
    );
$$;

create or replace function private.rol_id()
returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select rol_id from public.usuarios_organizacion
      where user_id = (select auth.uid()) and estado = 'activo'),
    case
      when (select private.is_superadmin())
        and exists (
          select 1 from public.superadmin_organizacion_activa
          where user_id = (select auth.uid())
        )
      then 'administrador'
    end
  );
$$;

create or replace function private.puede_gestionar_reportes(p_organizacion_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.usuarios_organizacion u
    where u.user_id = (select auth.uid())
      and u.organizacion_id = p_organizacion_id
      and u.rol_id = 'administrador'
      and u.estado = 'activo'
  ) or (
    (select private.is_superadmin()) and exists (
      select 1 from public.superadmin_organizacion_activa a
      where a.user_id = (select auth.uid()) and a.organizacion_id = p_organizacion_id
    )
  );
$$;
