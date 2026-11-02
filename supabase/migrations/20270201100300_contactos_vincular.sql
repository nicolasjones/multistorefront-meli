-- MSF-260 · F-CON-05 (FR-007): vincular una consulta o un comprobante de venta a un contacto.
--
-- Esquema (Principio VII): sin tablas nuevas; funciones en `public` (ejecución) que escriben
-- `contacto_id` en `dominio.consultas` / `dominio.comprobantes_venta` por ser SECURITY DEFINER.
--
-- Seguridad: sección `consultas` = edición (la épica define los permisos de la libreta por esa sección),
-- empresa accesible, contacto y consulta/comprobante de la MISMA empresa y de la organización de la sesión,
-- contacto activo (un anonimizado no se usa para vincular). Solo el comprobante se desvincula (`null`);
-- la consulta exige un contacto (22023 si es `null`).
-- Inexistente, ajeno o sin acceso: misma respuesta `42501`. La actividad no copia datos personales.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.vincular_comprobante_contacto(uuid, uuid);
--   drop function public.vincular_consulta_contacto(uuid, uuid);

create or replace function public.vincular_consulta_contacto(p_consulta_id uuid, p_contacto_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_consulta dominio.consultas%rowtype;
  v_contacto dominio.contactos%rowtype;
  v_empresa text;
begin
  if v_actor is null or v_org is null
     or (select private.nivel_seccion('consultas')) <> 'edicion' then
    raise exception 'No tenés permiso para vincular contactos' using errcode = '42501';
  end if;

  select * into v_consulta from dominio.consultas c
  where c.id = p_consulta_id and c.organizacion_id = v_org
  for update;
  if not found or not exists (select 1 from private.empresas_accesibles() ea where ea = v_consulta.empresa_id) then
    raise exception 'No tenés permiso para vincular contactos' using errcode = '42501';
  end if;

  if p_contacto_id is null then
    raise exception 'Indicá el contacto' using errcode = '22023', detail = 'contacto_id';
  end if;
  select * into v_contacto from dominio.contactos c
  where c.id = p_contacto_id and c.organizacion_id = v_org;
  if not found or v_contacto.empresa_id <> v_consulta.empresa_id then
    raise exception 'El contacto no es de la empresa de la consulta' using errcode = '22023', detail = 'contacto_id';
  end if;
  if v_contacto.anonimizado_en is not null then
    raise exception 'El contacto está anonimizado y no se puede usar' using errcode = '22023', detail = 'anonimizado';
  end if;

  if v_consulta.contacto_id is not distinct from p_contacto_id then
    return;
  end if;
  update dominio.consultas set contacto_id = p_contacto_id where id = p_consulta_id;

  select e.nombre into v_empresa from dominio.empresas e where e.id = v_consulta.empresa_id;
  perform private.insertar_actividad(
    v_org, v_actor, 'contacto.consulta_vinculada',
    format('Vinculó una consulta de «%s» a un contacto', v_empresa), v_consulta.empresa_id);
end;
$$;

revoke execute on function public.vincular_consulta_contacto(uuid, uuid) from public, anon;
grant execute on function public.vincular_consulta_contacto(uuid, uuid) to authenticated;

comment on function public.vincular_consulta_contacto(uuid, uuid) is
  'MSF-260: vincula una consulta a un contacto activo de su misma empresa (consultas = edición). 42501 sin permiso o sin acceso; 22023 contacto de otra empresa o anonimizado.';

create or replace function public.vincular_comprobante_contacto(p_comprobante_id uuid, p_contacto_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_comp dominio.comprobantes_venta%rowtype;
  v_contacto dominio.contactos%rowtype;
  v_empresa text;
begin
  if v_actor is null or v_org is null
     or (select private.nivel_seccion('consultas')) <> 'edicion' then
    raise exception 'No tenés permiso para vincular contactos' using errcode = '42501';
  end if;

  select * into v_comp from dominio.comprobantes_venta c
  where c.id = p_comprobante_id and c.organizacion_id = v_org
  for update;
  if not found or v_comp.empresa_id is null
     or not exists (select 1 from private.empresas_accesibles() ea where ea = v_comp.empresa_id) then
    raise exception 'No tenés permiso para vincular contactos' using errcode = '42501';
  end if;

  if p_contacto_id is not null then
    select * into v_contacto from dominio.contactos c
    where c.id = p_contacto_id and c.organizacion_id = v_org;
    if not found or v_contacto.empresa_id <> v_comp.empresa_id then
      raise exception 'El contacto no es de la empresa del comprobante' using errcode = '22023', detail = 'contacto_id';
    end if;
    if v_contacto.anonimizado_en is not null then
      raise exception 'El contacto está anonimizado y no se puede usar' using errcode = '22023', detail = 'anonimizado';
    end if;
  end if;

  if v_comp.contacto_id is not distinct from p_contacto_id then
    return;
  end if;
  update dominio.comprobantes_venta set contacto_id = p_contacto_id where id = p_comprobante_id;

  select e.nombre into v_empresa from dominio.empresas e where e.id = v_comp.empresa_id;
  perform private.insertar_actividad(
    v_org, v_actor,
    case when p_contacto_id is null then 'contacto.comprobante_desvinculado' else 'contacto.comprobante_vinculado' end,
    case when p_contacto_id is null
      then format('Desvinculó un comprobante de «%s» de su contacto', v_empresa)
      else format('Vinculó un comprobante de «%s» a un contacto', v_empresa) end,
    v_comp.empresa_id);
end;
$$;

revoke execute on function public.vincular_comprobante_contacto(uuid, uuid) from public, anon;
grant execute on function public.vincular_comprobante_contacto(uuid, uuid) to authenticated;

comment on function public.vincular_comprobante_contacto(uuid, uuid) is
  'MSF-260: vincula (o desvincula con null) un comprobante de venta a un contacto activo de su misma empresa (consultas = edición). No toca importes ni estados.';
