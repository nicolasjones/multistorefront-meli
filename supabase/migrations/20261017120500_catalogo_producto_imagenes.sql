-- F-CAT-05 (MSF-461, épica MSF-456): imágenes del producto.
-- Esquema (Principio VII): `dominio.producto_imagenes` es parte de la entidad del
-- negocio «producto» → `dominio`. El bucket `productos-imagenes` y sus políticas
-- sobre `storage.objects` son infraestructura de plataforma (patrón de `logos-organizacion`).
--
-- Migración aditiva (tabla, funciones, disparadores, bucket y políticas nuevos).
-- Reversión (en una migración posterior, no en este PR; exportar antes los datos y vaciar el bucket):
--   drop trigger producto_imagenes_registrar_actividad on dominio.producto_imagenes;
--   drop trigger producto_imagenes_tope on dominio.producto_imagenes;
--   drop function private.registrar_actividad_producto_imagen();
--   drop function private.limitar_imagenes_producto();
--   drop policy productos_imagenes_select on storage.objects;
--   drop policy productos_imagenes_insert on storage.objects;
--   drop policy productos_imagenes_delete on storage.objects;
--   delete from storage.buckets where id = 'productos-imagenes';  (tras vaciar el bucket)
--   drop table dominio.producto_imagenes;

-- ============================================================================
-- dominio.producto_imagenes (FR-012, FR-013): hasta 4 por producto; la principal
-- es la de menor posición. Quitar una promueve a la siguiente sin renumerar.
-- ============================================================================

create table dominio.producto_imagenes (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null,
  organizacion_id uuid not null,
  posicion smallint not null check (posicion between 1 and 4),
  -- <organizacion_id>/<producto_id>/<archivo> en el bucket `productos-imagenes`.
  ruta text not null check (
    length(ruta) <= 300
    and ruta ~* '\.(jpe?g|png|webp)$'
  ),
  creado_en timestamptz not null default now(),
  foreign key (producto_id, organizacion_id)
    references dominio.productos (id, organizacion_id) on delete cascade,
  unique (producto_id, posicion),
  unique (ruta),
  -- La ruta debe colgar del prefijo de su propia organización y producto: no se
  -- puede registrar un archivo ajeno.
  check (left(ruta, length(organizacion_id::text) + length(producto_id::text) + 2)
         = organizacion_id::text || '/' || producto_id::text || '/')
);

comment on table dominio.producto_imagenes is
  'Imágenes del producto (F-CAT-05), máx. 4; la de menor posición es la principal. El archivo vive en el bucket privado productos-imagenes.';

create index producto_imagenes_org_idx on dominio.producto_imagenes (organizacion_id, producto_id);

-- Tope de 4 en la base (también ante llamadas directas). El candado por producto
-- serializa dos altas simultáneas: sin él ambas contarían 3 y pasarían.
create or replace function private.limitar_imagenes_producto()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('producto_imagenes:' || new.producto_id::text, 0));
  if (select count(*) from dominio.producto_imagenes where producto_id = new.producto_id) >= 4 then
    raise exception 'Un producto admite hasta 4 imágenes' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function private.limitar_imagenes_producto() from public, anon, authenticated;

create trigger producto_imagenes_tope
  before insert on dominio.producto_imagenes
  for each row execute function private.limitar_imagenes_producto();

alter table dominio.producto_imagenes enable row level security;

create policy producto_imagenes_select on dominio.producto_imagenes
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) in ('lectura', 'edicion')
  );

create policy producto_imagenes_insert on dominio.producto_imagenes
  for insert to authenticated
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) = 'edicion'
  );

create policy producto_imagenes_delete on dominio.producto_imagenes
  for delete to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) = 'edicion'
  );

revoke all on dominio.producto_imagenes from public, anon, authenticated;
grant select, delete on dominio.producto_imagenes to authenticated;
grant insert (id, producto_id, organizacion_id, posicion, ruta) on dominio.producto_imagenes to authenticated;

-- ============================================================================
-- Actividad (FR-014): misma transacción, solo con sesión. Si se borrara el producto
-- entero (no ocurre: se desactiva) las imágenes caerían en cascada sin evento.
-- ============================================================================

create or replace function private.registrar_actividad_producto_imagen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_fila dominio.producto_imagenes := case when tg_op = 'DELETE' then old else new end;
  v_producto dominio.productos;
begin
  if v_actor is null then
    return v_fila;
  end if;
  select * into v_producto from dominio.productos where id = v_fila.producto_id;
  if not found then
    return v_fila;
  end if;
  perform private.insertar_actividad(
    v_fila.organizacion_id, v_actor,
    case tg_op when 'INSERT' then 'producto.imagen_agregada' else 'producto.imagen_eliminada' end,
    format('%s una imagen de %s%s',
      case tg_op when 'INSERT' then 'Agregó' else 'Eliminó' end,
      v_producto.nombre,
      case when v_producto.sku is null then '' else format(' (SKU %s)', v_producto.sku) end),
    null
  );
  return v_fila;
end;
$$;

revoke execute on function private.registrar_actividad_producto_imagen() from public, anon, authenticated;

create trigger producto_imagenes_registrar_actividad
  after insert or delete on dominio.producto_imagenes
  for each row execute function private.registrar_actividad_producto_imagen();

-- ============================================================================
-- Bucket privado `productos-imagenes`: JPG/PNG/WebP (sin SVG), 2 MB.
-- Prefijo <organizacion_id>/<producto_id>/: lectura con acceso a Productos de la
-- organización, escritura solo con edición y solo sobre un producto visible de
-- la propia organización. Sin política UPDATE: un archivo no se reemplaza.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('productos-imagenes', 'productos-imagenes', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy productos_imagenes_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'productos-imagenes'
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.nivel_seccion('productos')) in ('lectura', 'edicion')
  );

create policy productos_imagenes_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'productos-imagenes'
    and array_length(storage.foldername(name), 1) = 2
    and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.nivel_seccion('productos')) = 'edicion'
    and exists (
      select 1 from dominio.productos p
      where p.id::text = (storage.foldername(name))[2]
        and p.organizacion_id = (select private.organizacion_id())
    )
  );

create policy productos_imagenes_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'productos-imagenes'
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.nivel_seccion('productos')) = 'edicion'
  );
