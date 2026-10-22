-- F-VTA-37 (MSF-275, FR-002): bucket privado `historial-importaciones` para las planillas
-- (.csv / .xlsx) que sube el administrador antes de importarlas.
--
-- Esquema: no es una tabla (Storage). Las rutas son `<organizacion_id>/<tipo>/<archivo>`.
-- Sube y ve las planillas de su organización quien tiene `private.puede_escribir()` (el mismo
-- permiso que la solicitud de importación). No hay políticas de update ni delete para la app: el
-- archivo es evidencia de lo que se importó. El worker lee con su credencial de servicio del lado
-- del servidor, nunca desde el navegador.
--
-- Migración aditiva. Reversión (en una migración posterior, vaciando antes el bucket):
--   drop policy historial_importaciones_insert on storage.objects;
--   drop policy historial_importaciones_select on storage.objects;
--   delete from storage.objects where bucket_id = 'historial-importaciones';
--   delete from storage.buckets where id = 'historial-importaciones';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'historial-importaciones',
  'historial-importaciones',
  false,
  52428800, -- 50 MB; se ajusta con el volumen real (spec, Decisiones abiertas 1)
  array[
    'text/csv',
    'application/csv',
    'text/plain',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do nothing;

-- Subida: solo a la carpeta de la propia organización y solo .csv/.xlsx (FR-002).
create policy historial_importaciones_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'historial-importaciones'
    and array_length(storage.foldername(name), 1) >= 1
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and lower(name) ~ '\.(csv|xlsx)$'
    and (select private.puede_escribir())
  );

-- Lectura: la solicitud de importación comprueba que el archivo exista (security invoker).
create policy historial_importaciones_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'historial-importaciones'
    and array_length(storage.foldername(name), 1) >= 1
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.puede_escribir())
  );
