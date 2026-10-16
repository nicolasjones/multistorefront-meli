-- F-ROL-06 · Selector de empresa activa (épica MSF-121, spec 20261016-140000-permisos-por-empresa,
-- FR-009, FR-010, FR-013, FR-014).
--
-- Esquemas (Principio VII): no crea ni altera tablas. Escribe en
-- public.usuario_empresa_activa (public, F-ROL-04) y registra en public.registro_actividad
-- (public); dominio.empresas solo se lee. Funciones RPC en `public`, sin tablas nuevas.
--
-- Migración aditiva. Camino de reversión (no se ejecuta en el mismo PR):
--   drop function public.empresas_para_selector();
--   drop function public.cambiar_empresa_activa(uuid);
-- Los datos de usuario_empresa_activa quedan; F-ROL-04 sigue funcionando sin la RPC.

-- ============================================================================
-- cambiar_empresa_activa (FR-009, FR-013, FR-014)
-- Usuario y organización salen de la sesión; el acceso a la empresa lo decide
-- private.empresas_accesibles() (Administrador: todas las de su organización;
-- el resto: las asignadas; membresía vigente). Upsert por la PK (user_id) y evento
-- en la misma transacción. Si la empresa ya es la activa no escribe ni registra.
-- Errores: 42501 sin sesión/membresía o empresa sin acceso; 22023 empresa nula.
-- ============================================================================

create or replace function public.cambiar_empresa_activa(p_empresa_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_nombre text;
  v_anterior uuid;
begin
  if v_user is null or (select private.organizacion_id()) is null then
    raise exception 'Se necesita una sesión con organización para cambiar de empresa' using errcode = '42501';
  end if;
  if p_empresa_id is null then
    raise exception 'La empresa es obligatoria' using errcode = '22023';
  end if;
  if p_empresa_id not in (select private.empresas_accesibles()) then
    raise exception 'No tenés acceso a esa empresa' using errcode = '42501';
  end if;

  select a.empresa_id into v_anterior
  from public.usuario_empresa_activa a
  where a.user_id = v_user
  for update;

  if v_anterior is not distinct from p_empresa_id then
    return p_empresa_id;
  end if;

  insert into public.usuario_empresa_activa (user_id, empresa_id, updated_at)
  values (v_user, p_empresa_id, now())
  on conflict (user_id) do update
    set empresa_id = excluded.empresa_id, updated_at = excluded.updated_at;

  select e.nombre into v_nombre from dominio.empresas e where e.id = p_empresa_id;
  perform private.registrar_actividad(
    'usuario.empresa_activa_cambiada',
    'Cambió su empresa activa a ' || v_nombre,
    p_empresa_id
  );

  return p_empresa_id;
end;
$$;

comment on function public.cambiar_empresa_activa(uuid) is
  'F-ROL-06: el usuario elige con qué empresa accesible trabaja; persiste en usuario_empresa_activa y registra usuario.empresa_activa_cambiada en la misma transacción. Único camino de escritura de esa tabla.';

revoke execute on function public.cambiar_empresa_activa(uuid) from public, anon;
grant execute on function public.cambiar_empresa_activa(uuid) to authenticated;

-- ============================================================================
-- empresas_para_selector (FR-010)
-- Las empresas que el usuario puede elegir (no todas las de la organización, que es
-- lo que ve por RLS en dominio.empresas) y cuál es la activa válida.
-- ============================================================================

create or replace function public.empresas_para_selector()
returns table (id uuid, nombre text, es_activa boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.nombre, e.id is not distinct from (select private.empresa_activa_valida())
  from dominio.empresas e
  where e.id in (select private.empresas_accesibles())
  order by e.nombre;
$$;

comment on function public.empresas_para_selector() is
  'F-ROL-06: empresas accesibles del usuario actual con la activa marcada; alimenta el selector de la barra superior.';

revoke execute on function public.empresas_para_selector() from public, anon;
grant execute on function public.empresas_para_selector() to authenticated;
