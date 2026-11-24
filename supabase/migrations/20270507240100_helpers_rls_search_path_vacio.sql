-- Lote 42 (MSF-647, MSF-899/917/669): los tres helpers de RLS que seguían con `search_path = public`.
-- `private.organizacion_id()`, `private.is_superadmin()` y `private.puede_escribir()` son `security definer` y las usan
-- casi todas las políticas; con `search_path = public` una tabla homónima creada en `public` por quien tenga CREATE
-- podría sombrear a la real. Se redefinen con `set search_path = ''` y nombres calificados (mismo cuerpo vigente, sin
-- cambio de comportamiento). Vigentes: `20261012140100` (organizacion_id, puede_escribir) y `20260908172920` (is_superadmin).
-- Los grants se conservan (`create or replace` no los toca).
--
-- Esquema (Principio VII): sin tablas ni columnas; solo funciones de `private`.
-- Migración aditiva. Reversión (migración posterior): volver a crear las tres con `set search_path = public` y los
-- nombres sin calificar.

create or replace function private.organizacion_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select uo.organizacion_id from public.usuarios_organizacion uo
      where uo.user_id = auth.uid() and uo.estado = 'activo'),
    (select s.organizacion_id from private.superadmin_contexto_vigente s where s.user_id = auth.uid())
  );
$$;

create or replace function private.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.superadmins sa where sa.user_id = auth.uid()
  );
$$;

create or replace function private.puede_escribir()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.usuarios_organizacion uo
      where uo.user_id = auth.uid() and uo.rol_id = 'administrador' and uo.estado = 'activo'
    )
    or (
      private.is_superadmin()
      and exists (
        select 1 from private.superadmin_contexto_vigente s where s.user_id = auth.uid()
      )
    );
$$;
