-- Datos y configuración de la organización (spec 20261014-140000-administracion-de-usuarios-y-organizacion,
-- F-ORG-03, MSF-253, FR-001/FR-002/FR-004/FR-009).
-- Esquema: `public` (Principio VII): organización es entidad de plataforma.
-- Migración aditiva: dos columnas con default/nullable, una función y un bucket.
-- Reversión (en una migración posterior, no en el mismo PR que la crea):
--   drop function public.actualizar_organizacion(text, text, text);
--   drop policy logos_organizacion_select on storage.objects;
--   drop policy logos_organizacion_insert on storage.objects;
--   drop policy logos_organizacion_update on storage.objects;
--   drop policy logos_organizacion_delete on storage.objects;
--   delete from storage.buckets where id = 'logos-organizacion';  (tras vaciar el bucket)
--   alter table public.organizaciones drop column logo_path, drop column zona_horaria;

alter table public.organizaciones
  add column zona_horaria text not null default 'America/Argentina/Buenos_Aires',
  add column logo_path text;

comment on column public.organizaciones.zona_horaria is
  'Zona horaria IANA de la organización (existe en pg_timezone_names). Se escribe solo por public.actualizar_organizacion.';
comment on column public.organizaciones.logo_path is
  'Ruta del logo en el bucket logos-organizacion: <organizacion_id>/<archivo>. Nulo = sin logo.';

-- ============================================================================
-- RPC: único camino de escritura para el administrador (sin política UPDATE).
-- La organización la resuelve el servidor (private.organizacion_id()), nunca
-- el llamador; private.puede_escribir() exige administrador ACTIVO (excluye
-- suspendidos) o superadmin con organización activa.
-- Es reemplazo de estado: p_logo_path nulo quita el logo.
-- ============================================================================

create or replace function public.actualizar_organizacion(
  p_nombre text,
  p_zona_horaria text,
  p_logo_path text default null
)
returns public.organizaciones
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion_id uuid := (select private.organizacion_id());
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_zona text := btrim(coalesce(p_zona_horaria, ''));
  v_logo text := nullif(btrim(coalesce(p_logo_path, '')), '');
  v_fila public.organizaciones;
begin
  if v_organizacion_id is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede editar la organización' using errcode = '42501';
  end if;

  if v_nombre = '' then
    raise exception 'El nombre de la organización es obligatorio' using errcode = '22023';
  end if;
  if char_length(v_nombre) > 120 then
    raise exception 'El nombre no puede superar los 120 caracteres' using errcode = '22023';
  end if;

  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = v_zona) then
    raise exception 'La zona horaria no es válida' using errcode = '22023';
  end if;

  -- El logo debe vivir bajo el prefijo de ESTA organización y ser una imagen
  -- admitida (el bucket aplica además tipo MIME y tamaño).
  if v_logo is not null and v_logo !~* ('^' || v_organizacion_id::text || '/[A-Za-z0-9._-]{1,100}\.(png|jpe?g|webp)$') then
    raise exception 'El logo no es válido: debe ser PNG, JPG o WebP de tu organización' using errcode = '22023';
  end if;

  update public.organizaciones
  set nombre = v_nombre, zona_horaria = v_zona, logo_path = v_logo
  where id = v_organizacion_id
  returning * into v_fila;

  return v_fila;
end;
$$;

comment on function public.actualizar_organizacion(text, text, text) is
  'F-ORG-03: el administrador activo edita nombre, zona horaria y logo de SU organización (reemplazo de estado). Valida y rechaza al resto; sin política UPDATE directa.';

revoke execute on function public.actualizar_organizacion(text, text, text) from public, anon;
grant execute on function public.actualizar_organizacion(text, text, text) to authenticated;

-- ============================================================================
-- Bucket de logos: privado, solo imágenes (sin SVG), tope de 1 MB.
-- Prefijo <organizacion_id>/: lectura para la organización, escritura solo del
-- administrador activo de esa organización. Refine muestra el logo con URL firmada.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos-organizacion', 'logos-organizacion', false, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy logos_organizacion_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'logos-organizacion'
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
  );

create policy logos_organizacion_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'logos-organizacion'
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.puede_escribir())
  );

create policy logos_organizacion_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'logos-organizacion'
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.puede_escribir())
  )
  with check (
    bucket_id = 'logos-organizacion'
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.puede_escribir())
  );

create policy logos_organizacion_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'logos-organizacion'
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.puede_escribir())
  );
