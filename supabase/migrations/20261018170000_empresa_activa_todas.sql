-- F-ROL-06 · «Todas mis empresas» en el selector de empresa activa
-- (spec 20261018-170000-empresas-accesibles-y-filtro, US3).
--
-- La empresa activa se persiste en public.usuario_empresa_activa (F-ROL-04).
-- Hasta acá esa fila definía, para las secciones por empresa (ventas, consultas,
-- reportes), el rol con el que el usuario trabajaba: sin empresa activa válida,
-- `private.roles_de_referencia` no devolvía filas y la sección quedaba en
-- 'ninguno' (se ocultaba del menú y no se podía operar).
--
-- Se agrega la vista combinada «Todas mis empresas»: el usuario queda sin empresa
-- activa (no hay fila) y las secciones por empresa se resuelven con el *mejor* rol
-- entre sus empresas activas. No se pierden capacidades ni se ocultan secciones del
-- menú; es lo que el prototipo describe como «Vista combinada · rol según cada
-- empresa» (design/pantallas/AdminHeader.dc.html). Las pantallas que filtran por la
-- empresa activa (p. ej. el filtro por tienda de Clientes, F-CLI-11) muestran todas.
--
-- Aditiva: `create or replace` de `private.roles_de_referencia(text)` y una RPC
-- nueva. Sin tablas, columnas ni datos nuevos.
--
-- Reversión (en una migración posterior, no en este PR):
--   drop function public.usar_todas_las_empresas();
--   -- y recrear private.roles_de_referencia(text) con la definición de
--   -- 20261016140100_roles_por_empresa.sql (sin la rama «sin empresa activa»).
-- La elección «Todas» queda guardada como ausencia de fila; volver a elegir una
-- empresa con `cambiar_empresa_activa` la reemplaza.

-- ============================================================================
-- roles_de_referencia: sin empresa activa, el mejor rol entre las empresas del
-- usuario en las secciones por empresa. Con empresa activa válida, igual que antes.
-- ============================================================================

create or replace function private.roles_de_referencia(p_seccion text)
returns table (organizacion_id uuid, rol_id text)
language sql
stable
security definer
set search_path = ''
as $$
  with m as (
    select u.user_id, u.organizacion_id, u.rol_id,
      (
        u.rol_id <> 'administrador'
        and exists (select 1 from public.usuarios_empresas ue where ue.user_id = u.user_id)
      ) as con_empresas
    from public.usuarios_organizacion u
    where u.user_id = (select auth.uid()) and u.estado = 'activo'
  ),
  activa as (select private.empresa_activa_valida() as empresa_id)
  select m.organizacion_id, m.rol_id
  from m
  where not m.con_empresas
    or not (p_seccion = any (private.secciones_compartidas()) or p_seccion = any (private.secciones_por_empresa()))
  union
  select m.organizacion_id, ue.rol_id
  from m
  join public.usuarios_empresas ue on ue.user_id = m.user_id
  join dominio.empresas e on e.id = ue.empresa_id and e.organizacion_id = m.organizacion_id and e.activa
  where m.con_empresas and p_seccion = any (private.secciones_compartidas())
  union
  select m.organizacion_id, ue.rol_id
  from m
  join public.usuarios_empresas ue on ue.user_id = m.user_id
  join dominio.empresas e on e.id = ue.empresa_id and e.organizacion_id = m.organizacion_id and e.activa
  cross join activa a
  where m.con_empresas
    and p_seccion = any (private.secciones_por_empresa())
    and (a.empresa_id is null or ue.empresa_id = a.empresa_id)
$$;

comment on function private.roles_de_referencia(text) is
  'Roles que gobiernan la sección para el usuario actual (FR-006): sin asignaciones, Administrador o sección no listada → el rol de organización; sección compartida → los roles de todas sus empresas activas; sección por empresa → el rol de la empresa activa o, sin activa («Todas mis empresas»), el mejor entre sus empresas.';

revoke execute on function private.roles_de_referencia(text) from public, anon, authenticated;

-- ============================================================================
-- usar_todas_las_empresas (FR-009): pasa a la vista combinada.
-- Borra la fila de usuario_empresa_activa (sin activa) y registra el evento en la
-- misma transacción. Idempotente: si ya no hay fila, no escribe ni registra.
-- Errores: 42501 sin sesión/membresía, suspendido o sin empresas accesibles.
-- ============================================================================

create or replace function public.usar_todas_las_empresas()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_tenia boolean;
begin
  if v_user is null or (select private.organizacion_id()) is null then
    raise exception 'Se necesita una sesión con organización para cambiar de empresa' using errcode = '42501';
  end if;
  if not exists (select 1 from private.empresas_accesibles()) then
    raise exception 'No tenés empresas accesibles' using errcode = '42501';
  end if;

  select exists (select 1 from public.usuario_empresa_activa a where a.user_id = v_user) into v_tenia;
  if not v_tenia then
    return;
  end if;

  delete from public.usuario_empresa_activa a where a.user_id = v_user;
  perform private.registrar_actividad(
    'usuario.empresa_activa_cambiada',
    'Pasó a trabajar con todas sus empresas',
    null
  );
end;
$$;

comment on function public.usar_todas_las_empresas() is
  'F-ROL-06: el usuario pasa a la vista combinada «Todas mis empresas» (sin empresa activa). Borra su fila de usuario_empresa_activa y registra usuario.empresa_activa_cambiada en la misma transacción. Idempotente.';

revoke execute on function public.usar_todas_las_empresas() from public, anon;
grant execute on function public.usar_todas_las_empresas() to authenticated;
