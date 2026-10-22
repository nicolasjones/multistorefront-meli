-- F-ROL-06 / F-CLI-11 · El superadmin con organización activa ve las empresas de
-- esa organización (specs 20261016-140000-permisos-por-empresa FR-010 y
-- 20261018-070000-clientes-empresas F-CLI-11).
--
-- `private.empresas_accesibles()` solo resolvía por membresía
-- (`public.usuarios_organizacion`), así que un superadmin —que no tiene fila de
-- membresía— no tenía empresas accesibles: `public.empresas_para_selector()`
-- quedaba vacío y el selector de la barra superior no ofrecía ninguna empresa,
-- aunque `private.nivel_seccion` le da edición sobre la organización activa
-- (`superadmin_organizacion_activa`, 20261016140100_roles_por_empresa.sql). Se
-- agrega la rama del superadmin: todas las empresas activas de la organización
-- activa (`private.organizacion_id()`). Para el Administrador de la organización
-- y para los miembros con asignaciones el resultado es idéntico al anterior.
--
-- Aditiva: `create or replace` sobre una función existente, sin tablas nuevas ni
-- datos. Reversión (en una migración posterior, no en este PR): recrear
-- `private.empresas_accesibles()` con la definición de
-- 20261016140100_roles_por_empresa.sql (sin la rama de superadmin).

create or replace function private.empresas_accesibles()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from dominio.empresas e
  where e.activa
    and (
      exists (
        select 1
        from public.usuarios_organizacion u
        where u.user_id = (select auth.uid())
          and u.estado = 'activo'
          and u.organizacion_id = e.organizacion_id
          and (
            u.rol_id = 'administrador'
            or exists (
              select 1 from public.usuarios_empresas ue
              where ue.user_id = u.user_id and ue.empresa_id = e.id
            )
          )
      )
      or (
        (select private.is_superadmin())
        and e.organizacion_id = (select private.organizacion_id())
      )
    );
$$;

comment on function private.empresas_accesibles() is
  'Empresas activas a las que accede el usuario actual: el superadmin ve las de su organización activa; el Administrador, todas las de su organización; el resto, las asignadas. Exige membresía vigente salvo para el superadmin. Alimenta empresas_para_selector y cambiar_empresa_activa.';

revoke execute on function private.empresas_accesibles() from public, anon;
grant execute on function private.empresas_accesibles() to authenticated;
