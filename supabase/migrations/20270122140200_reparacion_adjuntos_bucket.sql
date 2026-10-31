-- F-SVC-20 (MSF-134, épica MSF-124): bucket privado `reparacion-adjuntos` y sus políticas.
-- Esquema: sin tablas nuevas; el bucket y las políticas sobre `storage.objects` son infraestructura de
-- plataforma (patrón de `productos-imagenes` e `historial-importaciones`; Principio VII).
--
-- Bucket privado: JPG/PNG/WebP (sin SVG), 5 MB. Ruta `<organizacion_id>/<reparacion_id>/<uuid>.<ext>`:
--   * select: `lectura`/`edicion` en `service_tecnico` y tienda de la reparación accesible.
--   * insert/delete: `edicion`, y la reparación debe ser de la propia organización y de una tienda accesible.
--   * sin política `update`: un archivo no se reemplaza. Sin acceso `anon`.
--
-- Migración aditiva. Reversión (migración posterior; vaciar antes el bucket):
--   drop policy reparacion_adjuntos_select on storage.objects;
--   drop policy reparacion_adjuntos_insert on storage.objects;
--   drop policy reparacion_adjuntos_delete on storage.objects;
--   delete from storage.buckets where id = 'reparacion-adjuntos';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reparacion-adjuntos', 'reparacion-adjuntos', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy reparacion_adjuntos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'reparacion-adjuntos'
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.nivel_seccion('service_tecnico')) in ('lectura', 'edicion')
    and exists (
      select 1 from dominio.reparaciones r
      where r.id::text = (storage.foldername(name))[2]
        and r.organizacion_id = (select private.organizacion_id())
        and r.empresa_id in (select private.empresas_accesibles())
    )
  );

create policy reparacion_adjuntos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'reparacion-adjuntos'
    and array_length(storage.foldername(name), 1) = 2
    and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.nivel_seccion('service_tecnico')) = 'edicion'
    and exists (
      select 1 from dominio.reparaciones r
      where r.id::text = (storage.foldername(name))[2]
        and r.organizacion_id = (select private.organizacion_id())
        and r.empresa_id in (select private.empresas_accesibles())
    )
  );

create policy reparacion_adjuntos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'reparacion-adjuntos'
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.nivel_seccion('service_tecnico')) = 'edicion'
    and exists (
      select 1 from dominio.reparaciones r
      where r.id::text = (storage.foldername(name))[2]
        and r.organizacion_id = (select private.organizacion_id())
        and r.empresa_id in (select private.empresas_accesibles())
    )
  );
