-- F-VTA-15 (MSF-152, épica MSF-135, spec 20261024-130000-ventas-despacho-y-faltantes, FR-008):
-- acción `despachar` de la sección `ventas` en la matriz de permisos.
--
-- Esquema (Principio VII): sin tablas nuevas. `public.permisos_rol_accion` (plataforma) recibe la acción
-- como DATO: se amplía su `check`, la matriz inicial la siembra SOLO para `ventas` (Administrador y Depósito
-- en true; el resto en false) y `private.puede_accion` la reconoce. La escritura sigue siendo por RPC
-- (`security definer`), nunca directa.
--
-- `despachar` habilita armar, controlar y entregar con Ventas en `lectura`: por eso exige al menos lectura
-- (a diferencia de `eliminar`, `editar_precio`, `anular` y `emitir_nota_credito`, que exigen `edicion`).
-- Es la respuesta a la Decisión abierta 7 de la spec: Depósito tiene Ventas en lectura y despacha igual.
--
-- Las definiciones parten de las VIGENTES (20261212120000, épica MSF-177: `eliminar`, `exportar`,
-- `ver_costos`, `editar_precio`, `anular`, `emitir_nota_credito`) y agregan `despachar`; no se pierde ninguna.
--
-- La pantalla de Roles sigue mostrando eliminar / exportar / ver costos: editar `despachar` desde la
-- matriz queda fuera de esta historia (mismo criterio que `editar_precio` en MSF-159).
--
-- Migración aditiva. Reversión (en una migración posterior):
--   delete from public.permisos_rol_accion where accion = 'despachar';
--   alter table public.permisos_rol_accion drop constraint if exists permisos_rol_accion_accion_check;
--   alter table public.permisos_rol_accion add constraint permisos_rol_accion_accion_check
--     check (accion in ('eliminar', 'exportar', 'ver_costos', 'editar_precio', 'anular', 'emitir_nota_credito'));
--   restaurar private.matriz_acciones_iniciales() y private.puede_accion(text, text) de
--     20261212120000_anulacion_nota_credito_base.sql.

alter table public.permisos_rol_accion drop constraint if exists permisos_rol_accion_accion_check;
alter table public.permisos_rol_accion
  add constraint permisos_rol_accion_accion_check
  check (accion in ('eliminar', 'exportar', 'ver_costos', 'editar_precio', 'anular', 'emitir_nota_credito', 'despachar'));

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
      when 'anular' then m.rol_id in ('administrador', 'administracion')
      when 'emitir_nota_credito' then m.rol_id in ('administrador', 'administracion')
      when 'despachar' then m.rol_id in ('administrador', 'deposito')
      else m.rol_id in ('administrador', 'administracion')
    end
  from private.matriz_inicial() m
  cross join (values ('eliminar'), ('exportar'), ('ver_costos'), ('editar_precio'), ('anular'),
    ('emitir_nota_credito'), ('despachar')) as a(accion)
  -- editar_precio, anular, emitir_nota_credito y despachar existen solo en Ventas; las otras tres, en toda sección.
  where a.accion not in ('editar_precio', 'anular', 'emitir_nota_credito', 'despachar') or m.seccion = 'ventas';
$$;

comment on function private.matriz_acciones_iniciales() is
  'Valores iniciales PROPUESTOS de permisos por acción (FR-006); pendientes de confirmar con el cliente. editar_precio (F-VTA-06), anular y emitir_nota_credito (F-VTA-11) solo en ventas: Administrador y Operador / Administración. despachar (F-VTA-15, FR-008) solo en ventas: Administrador y Depósito.';

create or replace function private.puede_accion(p_seccion text, p_accion text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_accion not in ('eliminar', 'exportar', 'ver_costos', 'editar_precio', 'anular', 'emitir_nota_credito', 'despachar') then false
    when (select private.is_superadmin())
      and exists (select 1 from public.superadmin_organizacion_activa a where a.user_id = (select auth.uid()))
      then true
    -- eliminar, editar_precio, anular y emitir_nota_credito exigen edición; despachar, exportar y ver costos
    -- exigen al menos lectura (Depósito despacha con Ventas en lectura).
    when p_accion in ('eliminar', 'editar_precio', 'anular', 'emitir_nota_credito')
      and (select private.nivel_seccion(p_seccion)) <> 'edicion' then false
    when (select private.nivel_seccion(p_seccion)) = 'ninguno' then false
    else coalesce(
      (
        select bool_or(private.accion_de_rol(x.organizacion_id, x.rol_id, p_seccion, p_accion))
        from private.roles_de_referencia(p_seccion) x
        where case
          when p_accion in ('eliminar', 'editar_precio', 'anular', 'emitir_nota_credito')
            then private.nivel_de_rol(x.organizacion_id, x.rol_id, p_seccion) = 'edicion'
          else private.nivel_de_rol(x.organizacion_id, x.rol_id, p_seccion) <> 'ninguno'
        end
      ),
      false
    )
  end;
$$;

comment on function private.puede_accion(text, text) is
  'true si el usuario actual puede eliminar | exportar | ver_costos | editar_precio | anular | emitir_nota_credito | despachar en la sección, con la misma resolución por empresa que nivel_seccion. Cualquier otra acción → false.';

revoke execute on function private.puede_accion(text, text) from public, anon;
grant execute on function private.puede_accion(text, text) to authenticated;

-- Organizaciones existentes: la siembra es idempotente (`on conflict do nothing`) y no pisa filas editadas.
-- Agrega las filas de `despachar` de cada organización (Administrador y Depósito en true).
select private.sembrar_permisos(id) from public.organizaciones;
