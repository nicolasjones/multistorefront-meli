-- MSF-266 · F-TDA-02 (épica MSF-147, spec 20261022-084830-tienda-dominio-e-identidad,
-- FR-020, FR-024, FR-028, FR-029, FR-030): identidad visual de la tienda online.
--
-- Esquemas (Principio VII, re-verificado):
--   * `dominio.tienda_identidad` -> `dominio`: dato de negocio de la tienda de una empresa.
--   * bucket `tienda-identidad` y sus políticas sobre `storage.objects`: infraestructura de plataforma
--     (patrón de `productos-imagenes`).
--   * `publico.identidad_por_dominio` -> `publico`: solo función de lectura anónima (sin tablas).
--
-- Sin fila en `tienda_identidad` la tienda usa el tema base (los valores por defecto de las columnas).
-- La escritura va SOLO por `public.guardar_tienda_identidad` (SECURITY DEFINER con permiso explícito):
-- la tabla no concede INSERT/UPDATE/DELETE a nadie, así el evento de auditoría nunca se omite.
-- Tipografías: lista cerrada (DS-04, supuesto: las del tema base y las de los dos temas de ejemplo
-- de `apps/web/src/tema/temaTienda.ts` y del prototipo); ajustable en esta sola constante.
-- Límites de archivo (D5): logo <= 1 MB (PNG/SVG), banners <= 3 MB (PNG/JPG/WebP). El bucket tope en 3 MB
-- y restringe los tipos; el límite de 1 MB del logo lo avisa la app antes de subir.
--
-- Migración aditiva. Reversión (migración posterior, exportar antes los datos y vaciar el bucket):
--   drop function publico.identidad_por_dominio(text);
--   drop function public.guardar_tienda_identidad(uuid, text, text, text, text, text, text, text, text, text);
--   drop policy tienda_identidad_objetos_select on storage.objects;
--   drop policy tienda_identidad_objetos_insert on storage.objects;
--   drop policy tienda_identidad_objetos_delete on storage.objects;
--   delete from storage.buckets where id = 'tienda-identidad';  (tras vaciar el bucket)
--   drop table dominio.tienda_identidad;
--   drop schema publico;   (solo si F-TDA-01/03/04 tampoco están aplicadas)

create schema if not exists publico;

-- ============================================================================
-- dominio.tienda_identidad (FR-020, FR-024)
-- ============================================================================

create table dominio.tienda_identidad (
  empresa_id uuid primary key,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  color_primario text not null default '#222222',
  color_primario_oscuro text not null default '#000000',
  color_acento text not null default '#222222',
  color_fondo text not null default '#FFFFFF',
  tipografia_titulos text not null default 'system-ui',
  tipografia_texto text not null default 'system-ui',
  -- Rutas dentro del bucket `tienda-identidad`: <organizacion_id>/<empresa_id>/<archivo>.
  logo_ruta text,
  banner_ruta text,
  banner_movil_ruta text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tienda_identidad_empresa_fk foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade,
  constraint tienda_identidad_color_primario_formato check (color_primario ~ '^#[0-9A-F]{6}$'),
  constraint tienda_identidad_color_primario_oscuro_formato check (color_primario_oscuro ~ '^#[0-9A-F]{6}$'),
  constraint tienda_identidad_color_acento_formato check (color_acento ~ '^#[0-9A-F]{6}$'),
  constraint tienda_identidad_color_fondo_formato check (color_fondo ~ '^#[0-9A-F]{6}$'),
  constraint tienda_identidad_tipografia_titulos_lista check (tipografia_titulos in (
    'system-ui', 'Barlow', 'Barlow Condensed', 'Playfair Display', 'Lato', 'Sora', 'Instrument Sans'
  )),
  constraint tienda_identidad_tipografia_texto_lista check (tipografia_texto in (
    'system-ui', 'Barlow', 'Barlow Condensed', 'Playfair Display', 'Lato', 'Sora', 'Instrument Sans'
  )),
  -- La ruta nunca sale de la carpeta de la propia empresa (sin `..`, sin otra empresa).
  constraint tienda_identidad_logo_ruta check (
    logo_ruta is null or (length(logo_ruta) <= 200 and logo_ruta ~ ('^' || organizacion_id::text || '/' || empresa_id::text || '/[A-Za-z0-9_-][A-Za-z0-9._-]*$'))
  ),
  constraint tienda_identidad_banner_ruta check (
    banner_ruta is null or (length(banner_ruta) <= 200 and banner_ruta ~ ('^' || organizacion_id::text || '/' || empresa_id::text || '/[A-Za-z0-9_-][A-Za-z0-9._-]*$'))
  ),
  constraint tienda_identidad_banner_movil_ruta check (
    banner_movil_ruta is null or (length(banner_movil_ruta) <= 200 and banner_movil_ruta ~ ('^' || organizacion_id::text || '/' || empresa_id::text || '/[A-Za-z0-9_-][A-Za-z0-9._-]*$'))
  )
);

comment on table dominio.tienda_identidad is
  'MSF-266 (F-TDA-02): colores, tipografías, logo y banners de la tienda de una empresa. Sin fila = tema base. Se escribe solo por public.guardar_tienda_identidad.';

create index IF NOT EXISTS tienda_identidad_organizacion_id_idx on dominio.tienda_identidad (organizacion_id);

alter table dominio.tienda_identidad enable row level security;

create policy tienda_identidad_select on dominio.tienda_identidad
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('empresas')) in ('lectura', 'edicion')
  );

revoke all on dominio.tienda_identidad from public, anon, authenticated;
grant select on dominio.tienda_identidad to authenticated;

-- ============================================================================
-- Bucket `tienda-identidad` (FR-029)
-- ============================================================================

-- Lectura pública (la tienda anónima muestra logo y banners); escritura solo `authenticated`.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tienda-identidad',
  'tienda-identidad',
  true,
  3145728,
  array['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists tienda_identidad_objetos_select on storage.objects;
drop policy if exists tienda_identidad_objetos_insert on storage.objects;
drop policy if exists tienda_identidad_objetos_delete on storage.objects;

create policy tienda_identidad_objetos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'tienda-identidad'
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.nivel_seccion('empresas')) in ('lectura', 'edicion')
  );

create policy tienda_identidad_objetos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'tienda-identidad'
    and array_length(storage.foldername(name), 1) = 2
    and lower(storage.extension(name)) in ('png', 'svg', 'jpg', 'jpeg', 'webp')
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.nivel_seccion('empresas')) = 'edicion'
    and exists (
      select 1 from dominio.empresas e
      where e.id::text = (storage.foldername(name))[2]
        and e.organizacion_id = (select private.organizacion_id())
    )
  );

create policy tienda_identidad_objetos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'tienda-identidad'
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.nivel_seccion('empresas')) = 'edicion'
  );

-- ============================================================================
-- public.guardar_tienda_identidad (FR-028, FR-029: evento tienda.identidad_actualizada)
-- ============================================================================

-- «Guardar» envía el estado completo (reemplazo). Idempotente: si nada cambia no escribe ni registra
-- evento. 42501 sin permiso, P0002 empresa inexistente, 22023 datos inválidos.
create or replace function public.guardar_tienda_identidad(
  p_empresa_id uuid,
  p_color_primario text,
  p_color_primario_oscuro text,
  p_color_acento text,
  p_color_fondo text,
  p_tipografia_titulos text,
  p_tipografia_texto text,
  p_logo_ruta text default null,
  p_banner_ruta text default null,
  p_banner_movil_ruta text default null
)
returns dominio.tienda_identidad
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_empresa text;
  v_prefijo text;
  v_primario text := upper(btrim(coalesce(p_color_primario, '')));
  v_oscuro text := upper(btrim(coalesce(p_color_primario_oscuro, '')));
  v_acento text := upper(btrim(coalesce(p_color_acento, '')));
  v_fondo text := upper(btrim(coalesce(p_color_fondo, '')));
  v_actual dominio.tienda_identidad;
  v_fila dominio.tienda_identidad;
  v_ruta text;
begin
  if v_org is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'Tu rol no puede editar la identidad de la tienda' using errcode = '42501';
  end if;

  select e.nombre into v_empresa
  from dominio.empresas e
  where e.id = p_empresa_id and e.organizacion_id = v_org;
  if not found then
    raise exception 'La empresa no existe' using errcode = 'P0002';
  end if;

  if v_primario !~ '^#[0-9A-F]{6}$' then
    raise exception 'El color primario debe tener el formato #RRGGBB' using errcode = '22023';
  end if;
  if v_oscuro !~ '^#[0-9A-F]{6}$' then
    raise exception 'El color primario oscuro debe tener el formato #RRGGBB' using errcode = '22023';
  end if;
  if v_acento !~ '^#[0-9A-F]{6}$' then
    raise exception 'El color de acento debe tener el formato #RRGGBB' using errcode = '22023';
  end if;
  if v_fondo !~ '^#[0-9A-F]{6}$' then
    raise exception 'El color de fondo debe tener el formato #RRGGBB' using errcode = '22023';
  end if;
  if p_tipografia_titulos is null or p_tipografia_titulos not in (
       'system-ui', 'Barlow', 'Barlow Condensed', 'Playfair Display', 'Lato', 'Sora', 'Instrument Sans') then
    raise exception 'La tipografía de los títulos no está en la lista' using errcode = '22023';
  end if;
  if p_tipografia_texto is null or p_tipografia_texto not in (
       'system-ui', 'Barlow', 'Barlow Condensed', 'Playfair Display', 'Lato', 'Sora', 'Instrument Sans') then
    raise exception 'La tipografía del texto no está en la lista' using errcode = '22023';
  end if;

  v_prefijo := v_org::text || '/' || p_empresa_id::text || '/';
  foreach v_ruta in array array[p_logo_ruta, p_banner_ruta, p_banner_movil_ruta] loop
    if v_ruta is not null and (left(v_ruta, length(v_prefijo)) <> v_prefijo or substr(v_ruta, length(v_prefijo) + 1) !~ '^[A-Za-z0-9_-][A-Za-z0-9._-]*$' or length(v_ruta) > 200) then
      raise exception 'La imagen debe estar en la carpeta de la empresa' using errcode = '22023';
    end if;
  end loop;

  -- Serializa guardados concurrentes de la misma empresa.
  perform 1 from dominio.empresas where id = p_empresa_id for update;
  select * into v_actual from dominio.tienda_identidad where empresa_id = p_empresa_id;

  if found
     and v_actual.color_primario = v_primario
     and v_actual.color_primario_oscuro = v_oscuro
     and v_actual.color_acento = v_acento
     and v_actual.color_fondo = v_fondo
     and v_actual.tipografia_titulos = p_tipografia_titulos
     and v_actual.tipografia_texto = p_tipografia_texto
     and v_actual.logo_ruta is not distinct from p_logo_ruta
     and v_actual.banner_ruta is not distinct from p_banner_ruta
     and v_actual.banner_movil_ruta is not distinct from p_banner_movil_ruta then
    return v_actual;
  end if;

  insert into dominio.tienda_identidad as ti (
    empresa_id, organizacion_id, color_primario, color_primario_oscuro, color_acento, color_fondo,
    tipografia_titulos, tipografia_texto, logo_ruta, banner_ruta, banner_movil_ruta
  ) values (
    p_empresa_id, v_org, v_primario, v_oscuro, v_acento, v_fondo,
    p_tipografia_titulos, p_tipografia_texto, p_logo_ruta, p_banner_ruta, p_banner_movil_ruta
  )
  on conflict (empresa_id) do update set
    color_primario = excluded.color_primario,
    color_primario_oscuro = excluded.color_primario_oscuro,
    color_acento = excluded.color_acento,
    color_fondo = excluded.color_fondo,
    tipografia_titulos = excluded.tipografia_titulos,
    tipografia_texto = excluded.tipografia_texto,
    logo_ruta = excluded.logo_ruta,
    banner_ruta = excluded.banner_ruta,
    banner_movil_ruta = excluded.banner_movil_ruta,
    updated_at = now()
  returning ti.* into v_fila;

  perform private.insertar_actividad(
    v_org,
    (select auth.uid()),
    'tienda.identidad_actualizada',
    format('Actualizó la identidad visual de la tienda de «%s»', v_empresa),
    p_empresa_id
  );
  return v_fila;
end;
$$;

comment on function public.guardar_tienda_identidad(uuid, text, text, text, text, text, text, text, text, text) is
  'F-TDA-02: guarda la identidad visual de la tienda de una empresa (estado completo). Exige edición en Empresas; idempotente; emite tienda.identidad_actualizada. 42501 sin permiso, P0002 empresa inexistente, 22023 datos inválidos.';

revoke execute on function public.guardar_tienda_identidad(uuid, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.guardar_tienda_identidad(uuid, text, text, text, text, text, text, text, text, text) to authenticated;

-- ============================================================================
-- publico.identidad_por_dominio (FR-030)
-- ============================================================================

-- Lista blanca de columnas: sin ids de organización, sin fechas. Devuelve las RUTAS del bucket público
-- `tienda-identidad` (el front arma la URL pública). Sin fila de identidad devuelve el tema base. Dominio
-- desconocido, host inválido y empresa desactivada: cero filas (igual que tienda_por_dominio).
create or replace function publico.identidad_por_dominio(host text)
returns table (
  color_primario text,
  color_primario_oscuro text,
  color_acento text,
  color_fondo text,
  tipografia_titulos text,
  tipografia_texto text,
  logo_ruta text,
  banner_ruta text,
  banner_movil_ruta text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(i.color_primario, '#222222'),
    coalesce(i.color_primario_oscuro, '#000000'),
    coalesce(i.color_acento, '#222222'),
    coalesce(i.color_fondo, '#FFFFFF'),
    coalesce(i.tipografia_titulos, 'system-ui'),
    coalesce(i.tipografia_texto, 'system-ui'),
    i.logo_ruta,
    i.banner_ruta,
    i.banner_movil_ruta
  from dominio.tiendas t
  join dominio.empresas e on e.id = t.empresa_id and e.organizacion_id = t.organizacion_id
  left join dominio.tienda_identidad i on i.empresa_id = t.empresa_id
  where t.dominio = private.normalizar_host(host)
    and e.activa;
$$;

revoke execute on function publico.identidad_por_dominio(text) from public;
grant execute on function publico.identidad_por_dominio(text) to anon, authenticated;

comment on function publico.identidad_por_dominio(text) is
  'F-TDA-02: identidad pública de la tienda por host (lista blanca de columnas; rutas del bucket público). Vacío si el dominio no existe o la empresa está desactivada.';
