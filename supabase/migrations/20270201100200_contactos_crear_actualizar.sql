-- MSF-260 · F-CON-05 (FR-002, FR-003, FR-004): alta y edición de contactos.
--
-- Esquema (Principio VII): ninguna tabla nueva. Las funciones viven en `public` (superficie de ejecución,
-- sin datos propios) y escriben en `dominio.contactos` por ser SECURITY DEFINER.
--
-- Seguridad: exigen sección `consultas` = edición y empresa accesible (`42501`, la misma respuesta si el
-- contacto no existe, es de otra organización o de una empresa sin acceso). `revoke … from public, anon` +
-- `grant … to authenticated`. La actividad registra solo «qué pasó» y la empresa: nunca nombre, correo ni
-- teléfono (FR-002, FR-020).
--
-- Errores: 42501 sin permiso · 22023 datos inválidos · 23505 duplicado (el id del contacto existente va en
-- `DETAIL`) · 40001 conflicto de `updated_at`.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.actualizar_contacto(uuid, text, text, text, timestamptz);
--   drop function public.crear_contacto(uuid, text, text, text, boolean, text, uuid);
--   drop function private.validar_contacto(uuid, uuid, text, text, text);

-- Valida los datos y rechaza duplicados activos de la empresa. Interna: sin grants.
create or replace function private.validar_contacto(
  p_empresa_id uuid,
  p_excluir_id uuid,
  p_nombre text,
  p_correo text,
  p_telefono text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_correo text := nullif(btrim(coalesce(p_correo, '')), '');
  v_tel text := nullif(btrim(coalesce(p_telefono, '')), '');
  v_digitos text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_existente uuid;
begin
  if v_nombre = '' or length(v_nombre) > 120 then
    raise exception 'El nombre es obligatorio (hasta 120 caracteres)' using errcode = '22023', detail = 'nombre';
  end if;
  if v_correo is null and v_tel is null then
    raise exception 'Indicá al menos un correo o un teléfono' using errcode = '22023', detail = 'contacto';
  end if;
  if v_correo is not null and (length(v_correo) > 200 or v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'El correo no es válido' using errcode = '22023', detail = 'correo';
  end if;
  if v_tel is not null and (length(v_tel) > 40 or length(v_digitos) not between 7 and 15) then
    raise exception 'El teléfono no es válido (de 7 a 15 dígitos)' using errcode = '22023', detail = 'telefono';
  end if;

  select c.id into v_existente
  from dominio.contactos c
  where c.empresa_id = p_empresa_id
    and c.anonimizado_en is null
    and c.id is distinct from p_excluir_id
    and ((v_correo is not null and c.correo_normalizado = lower(v_correo))
      or (v_tel is not null and c.telefono_normalizado = v_digitos))
  order by c.created_at, c.id
  limit 1;

  if v_existente is not null then
    raise exception 'Ya existe un contacto con ese correo o teléfono en esta empresa'
      using errcode = '23505', detail = v_existente::text;
  end if;
end;
$$;

revoke execute on function private.validar_contacto(uuid, uuid, text, text, text) from public, anon, authenticated;

create or replace function public.crear_contacto(
  p_empresa_id uuid,
  p_nombre text,
  p_correo text,
  p_telefono text,
  p_consentimiento boolean,
  p_consentimiento_texto text,
  p_consulta_id uuid default null
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
  v_texto text := btrim(coalesce(p_consentimiento_texto, ''));
  v_consulta dominio.consultas%rowtype;
  v_id uuid;
  v_empresa text;
begin
  if v_actor is null or v_org is null
     or (select private.nivel_seccion('consultas')) <> 'edicion'
     or p_empresa_id is null
     or not exists (select 1 from private.empresas_accesibles() ea where ea = p_empresa_id) then
    raise exception 'No tenés permiso para crear contactos' using errcode = '42501';
  end if;

  if p_consentimiento is distinct from true then
    raise exception 'Confirmá el consentimiento para guardar el contacto' using errcode = '22023', detail = 'consentimiento';
  end if;
  if v_texto = '' or length(v_texto) > 2000 then
    raise exception 'Falta el texto de consentimiento' using errcode = '22023', detail = 'consentimiento_texto';
  end if;

  if p_consulta_id is not null then
    select * into v_consulta from dominio.consultas c
    where c.id = p_consulta_id and c.organizacion_id = v_org
    for update;
    if not found or v_consulta.empresa_id <> p_empresa_id then
      raise exception 'La consulta no es de esta empresa' using errcode = '22023', detail = 'consulta_id';
    end if;
    if v_consulta.contacto_id is not null then
      raise exception 'La consulta ya tiene un contacto vinculado' using errcode = '22023', detail = 'consulta_id';
    end if;
  end if;

  perform private.validar_contacto(p_empresa_id, null, p_nombre, p_correo, p_telefono);

  begin
    insert into dominio.contactos (
      organizacion_id, empresa_id, nombre, correo, telefono,
      consentimiento_en, consentimiento_texto, consentimiento_por
    )
    values (v_org, p_empresa_id, p_nombre, p_correo, p_telefono, now(), v_texto, v_actor)
    returning id into v_id;
  exception when unique_violation then
    -- Carrera con otra alta: se informa el contacto que ganó.
    perform private.validar_contacto(p_empresa_id, null, p_nombre, p_correo, p_telefono);
    -- Sin el existente identificable: se evita re-lanzar el error nativo, cuyo DETAIL trae el correo/teléfono.
    raise exception 'Ya existe un contacto con ese correo o teléfono en esta empresa' using errcode = '23505';
  end;

  if p_consulta_id is not null then
    update dominio.consultas set contacto_id = v_id where id = p_consulta_id;
  end if;

  select e.nombre into v_empresa from dominio.empresas e where e.id = p_empresa_id;
  perform private.insertar_actividad(
    v_org, v_actor, 'contacto.creado',
    format('Creó un contacto en «%s»', v_empresa), p_empresa_id);

  return v_id;
end;
$$;

revoke execute on function public.crear_contacto(uuid, text, text, text, boolean, text, uuid) from public, anon;
grant execute on function public.crear_contacto(uuid, text, text, text, boolean, text, uuid) to authenticated;

comment on function public.crear_contacto(uuid, text, text, text, boolean, text, uuid) is
  'MSF-260: crea un contacto de la empresa (consultas = edición) con el consentimiento y su texto copiados; si viene p_consulta_id la vincula. 23505 con el id del existente en DETAIL; 22023 datos inválidos; 42501 sin permiso.';

create or replace function public.actualizar_contacto(
  p_id uuid,
  p_nombre text,
  p_correo text,
  p_telefono text,
  p_updated_at timestamptz
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_c dominio.contactos%rowtype;
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_correo text := nullif(btrim(coalesce(p_correo, '')), '');
  v_tel text := nullif(btrim(coalesce(p_telefono, '')), '');
  v_nuevo timestamptz;
  v_empresa text;
begin
  if v_actor is null or v_org is null
     or (select private.nivel_seccion('consultas')) <> 'edicion' then
    raise exception 'No tenés permiso para editar contactos' using errcode = '42501';
  end if;

  select * into v_c from dominio.contactos c
  where c.id = p_id and c.organizacion_id = v_org
  for update;

  if not found or not exists (select 1 from private.empresas_accesibles() ea where ea = v_c.empresa_id) then
    raise exception 'No tenés permiso para editar contactos' using errcode = '42501';
  end if;
  if v_c.anonimizado_en is not null then
    raise exception 'El contacto está anonimizado y no se puede editar' using errcode = '22023', detail = 'anonimizado';
  end if;

  perform private.validar_contacto(v_c.empresa_id, p_id, v_nombre, v_correo, v_tel);

  -- Idempotente: sin cambios no hay conflicto posible ni escritura.
  if (v_c.nombre, v_c.correo, v_c.telefono) is not distinct from (v_nombre, v_correo, v_tel) then
    return v_c.updated_at;
  end if;

  if p_updated_at is distinct from v_c.updated_at then
    raise exception 'El contacto fue modificado por otra persona' using errcode = '40001';
  end if;

  update dominio.contactos set nombre = v_nombre, correo = v_correo, telefono = v_tel
  where id = p_id
  returning updated_at into v_nuevo;

  select e.nombre into v_empresa from dominio.empresas e where e.id = v_c.empresa_id;
  perform private.insertar_actividad(
    v_org, v_actor, 'contacto.actualizado',
    format('Editó un contacto de «%s»', v_empresa), v_c.empresa_id);

  return v_nuevo;
end;
$$;

revoke execute on function public.actualizar_contacto(uuid, text, text, text, timestamptz) from public, anon;
grant execute on function public.actualizar_contacto(uuid, text, text, text, timestamptz) to authenticated;

comment on function public.actualizar_contacto(uuid, text, text, text, timestamptz) is
  'MSF-260: edita nombre, correo y teléfono de un contacto activo (consultas = edición) con la regla de duplicados. 40001 si updated_at no coincide; 23505 duplicado; 22023 inválido o anonimizado; 42501 sin permiso.';
