-- F-VTA-06 (MSF-295, épica MSF-159, spec 20261023-100000-ventas-comprobantes, FR-016, Decisiones abiertas 4):
-- acción `editar_precio` de la sección `ventas` en la matriz de permisos.
--
-- Esquema (Principio VII): sin tablas nuevas. `public.permisos_rol_accion` (plataforma) recibe una acción
-- más como DATO: se amplía su check, la matriz inicial la siembra solo para `ventas` (Administrador y
-- Operador en true; el resto en false) y `private.puede_accion` la reconoce. Como `eliminar`, exige nivel
-- `edicion` en la sección: quien solo lee nunca edita un precio.
--
-- La pantalla de Roles sigue mostrando eliminar / exportar / ver costos: editar `editar_precio` desde la
-- matriz queda fuera de esta historia (los valores sembrados se aplican igual).
--
-- Migración aditiva. Reversión (migración posterior):
--   delete from public.permisos_rol_accion where accion = 'editar_precio';
--   alter table public.permisos_rol_accion drop constraint permisos_rol_accion_accion_check;
--   alter table public.permisos_rol_accion add constraint permisos_rol_accion_accion_check
--     check (accion in ('eliminar', 'exportar', 'ver_costos'));
--   restaurar private.matriz_acciones_iniciales() de 20261013130002_roles_basicos_permisos.sql y
--     private.puede_accion(text, text) de 20261016140100_roles_por_empresa.sql.

alter table public.permisos_rol_accion drop constraint if exists permisos_rol_accion_accion_check;
alter table public.permisos_rol_accion
  add constraint permisos_rol_accion_accion_check
  check (accion in ('eliminar', 'exportar', 'ver_costos', 'editar_precio'));

create or replace function private.matriz_acciones_iniciales()
returns table (rol_id text, seccion text, accion text, permitido boolean)
language sql
immutable
set search_path = ''
as $$
  select m.rol_id, m.seccion, a.accion,
    case a.accion
      when 'eliminar' then m.rol_id = 'administrador'
      when 'exportar' then m.rol_id in ('administrador', 'operador', 'administracion')
      when 'editar_precio' then m.rol_id in ('administrador', 'operador')
      else m.rol_id in ('administrador', 'administracion')
    end
  from private.matriz_inicial() m
  cross join (values ('eliminar'), ('exportar'), ('ver_costos'), ('editar_precio')) as a(accion)
  -- editar_precio existe solo en Ventas; las otras tres acciones, en toda sección.
  where a.accion <> 'editar_precio' or m.seccion = 'ventas';
$$;

comment on function private.matriz_acciones_iniciales() is
  'Valores iniciales PROPUESTOS de permisos por acción (FR-006); pendientes de confirmar con el cliente. editar_precio (F-VTA-06) solo en ventas: Administrador y Operador.';

create or replace function private.puede_accion(p_seccion text, p_accion text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_accion not in ('eliminar', 'exportar', 'ver_costos', 'editar_precio') then false
    when (select private.is_superadmin())
      and exists (select 1 from public.superadmin_organizacion_activa a where a.user_id = (select auth.uid()))
      then true
    -- eliminar y editar_precio exigen edición; exportar y ver costos exigen al menos lectura.
    when p_accion in ('eliminar', 'editar_precio') and (select private.nivel_seccion(p_seccion)) <> 'edicion' then false
    when (select private.nivel_seccion(p_seccion)) = 'ninguno' then false
    else coalesce(
      (
        select bool_or(private.accion_de_rol(x.organizacion_id, x.rol_id, p_seccion, p_accion))
        from private.roles_de_referencia(p_seccion) x
        where case
          when p_accion in ('eliminar', 'editar_precio') then private.nivel_de_rol(x.organizacion_id, x.rol_id, p_seccion) = 'edicion'
          else private.nivel_de_rol(x.organizacion_id, x.rol_id, p_seccion) <> 'ninguno'
        end
      ),
      false
    )
  end;
$$;

comment on function private.puede_accion(text, text) is
  'true si el usuario actual puede eliminar | exportar | ver_costos | editar_precio en la sección, con la misma resolución por empresa que nivel_seccion. Cualquier otra acción → false.';

revoke execute on function private.puede_accion(text, text) from public, anon;
grant execute on function private.puede_accion(text, text) to authenticated;

-- Organizaciones existentes: la siembra es idempotente (`on conflict do nothing`) y no pisa filas editadas.
select private.sembrar_permisos(id) from public.organizaciones;
