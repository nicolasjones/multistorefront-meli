-- MSF-274 · F-CON-06 (FR-013, FR-014, FR-017): superficie de lectura y escritura de las
-- respuestas rápidas.
--
-- Esquema (Principio VII): ninguna tabla nueva. Vista y RPC viven en `public` (superficie de
-- lectura/ejecución, no almacenan datos); los datos son los de `dominio.respuestas_rapidas`.
--
-- Seguridad:
--   * `public.respuestas_rapidas_lista` es `security_invoker`: aplica la RLS de la tabla.
--   * `guardar_respuesta_rapida` y `eliminar_respuesta_rapida` exigen `consultas` = edición y
--     empresa accesible; lo inexistente, ajeno o de una empresa sin acceso responde igual (42501).
--   * `revoke … from public, anon` + `grant … to authenticated`.
--   * La actividad registra solo el título (sin el texto) y el nombre de la empresa.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop view public.respuestas_rapidas_lista;
--   drop function public.guardar_respuesta_rapida(uuid, uuid, text, text);
--   drop function public.eliminar_respuesta_rapida(uuid);

create or replace view public.respuestas_rapidas_lista
with (security_invoker = true) as
  select r.id, r.empresa_id, r.titulo, r.texto, r.created_at, r.updated_at
  from dominio.respuestas_rapidas r;

revoke all on public.respuestas_rapidas_lista from public, anon, authenticated;
grant select on public.respuestas_rapidas_lista to authenticated;

comment on view public.respuestas_rapidas_lista is
  'MSF-274: respuestas rápidas que la RLS deja ver (organización, empresa accesible, sección consultas >= lectura).';

-- Alta (p_id null, exige empresa) o edición (p_id existente; la empresa no se mueve). Devuelve el id.
create or replace function public.guardar_respuesta_rapida(
  p_id uuid,
  p_empresa_id uuid,
  p_titulo text,
  p_texto text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_titulo text := btrim(coalesce(p_titulo, ''));
  v_texto text := btrim(coalesce(p_texto, ''));
  v_empresa uuid;
  v_nombre_empresa text;
  v_id uuid;
begin
  if v_actor is null or v_org is null
     or (select private.nivel_seccion('consultas')) <> 'edicion' then
    raise exception 'No tenés permiso para editar respuestas rápidas' using errcode = '42501';
  end if;

  if p_id is null then
    v_empresa := p_empresa_id;
  else
    select r.empresa_id into v_empresa
    from dominio.respuestas_rapidas r
    where r.id = p_id and r.organizacion_id = v_org
    for update;
  end if;

  if v_empresa is null or not exists (
    select 1 from private.empresas_accesibles() ea where ea = v_empresa
  ) then
    raise exception 'No tenés permiso para editar respuestas rápidas' using errcode = '42501';
  end if;

  if v_titulo = '' or length(v_titulo) > 80 then
    raise exception 'El título es obligatorio y admite hasta 80 caracteres' using errcode = '22023', detail = 'titulo';
  end if;
  if v_texto = '' or length(v_texto) > 1000 then
    raise exception 'El texto es obligatorio y admite hasta 1000 caracteres' using errcode = '22023', detail = 'texto';
  end if;

  select e.nombre into v_nombre_empresa from dominio.empresas e where e.id = v_empresa;

  if p_id is null then
    insert into dominio.respuestas_rapidas (organizacion_id, empresa_id, titulo, texto)
    values (v_org, v_empresa, v_titulo, v_texto)
    returning id into v_id;
    perform private.insertar_actividad(
      v_org, v_actor, 'respuesta_rapida.creada',
      format('Creó la respuesta rápida «%s» de «%s»', v_titulo, v_nombre_empresa), v_empresa);
  else
    update dominio.respuestas_rapidas set titulo = v_titulo, texto = v_texto where id = p_id;
    v_id := p_id;
    perform private.insertar_actividad(
      v_org, v_actor, 'respuesta_rapida.editada',
      format('Editó la respuesta rápida «%s» de «%s»', v_titulo, v_nombre_empresa), v_empresa);
  end if;

  return v_id;
end;
$$;

revoke execute on function public.guardar_respuesta_rapida(uuid, uuid, text, text) from public, anon;
grant execute on function public.guardar_respuesta_rapida(uuid, uuid, text, text) to authenticated;

comment on function public.guardar_respuesta_rapida(uuid, uuid, text, text) is
  'MSF-274: crea (p_id null) o edita una respuesta rápida de una empresa accesible (sección consultas = edición). 42501 sin permiso o sin acceso; 22023 título o texto inválidos. Registra respuesta_rapida.creada / .editada con el título, sin el texto.';

create or replace function public.eliminar_respuesta_rapida(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_r dominio.respuestas_rapidas%rowtype;
  v_nombre_empresa text;
begin
  if v_actor is null or v_org is null
     or (select private.nivel_seccion('consultas')) <> 'edicion' then
    raise exception 'No tenés permiso para editar respuestas rápidas' using errcode = '42501';
  end if;

  select * into v_r from dominio.respuestas_rapidas r
  where r.id = p_id and r.organizacion_id = v_org
  for update;

  if not found or not exists (
    select 1 from private.empresas_accesibles() ea where ea = v_r.empresa_id
  ) then
    raise exception 'No tenés permiso para editar respuestas rápidas' using errcode = '42501';
  end if;

  delete from dominio.respuestas_rapidas where id = p_id;

  select e.nombre into v_nombre_empresa from dominio.empresas e where e.id = v_r.empresa_id;
  perform private.insertar_actividad(
    v_org, v_actor, 'respuesta_rapida.eliminada',
    format('Eliminó la respuesta rápida «%s» de «%s»', v_r.titulo, v_nombre_empresa), v_r.empresa_id);
end;
$$;

revoke execute on function public.eliminar_respuesta_rapida(uuid) from public, anon;
grant execute on function public.eliminar_respuesta_rapida(uuid) to authenticated;

comment on function public.eliminar_respuesta_rapida(uuid) is
  'MSF-274: elimina una respuesta rápida de una empresa accesible (sección consultas = edición). 42501 sin permiso, inexistente o ajena. Registra respuesta_rapida.eliminada con el título.';
