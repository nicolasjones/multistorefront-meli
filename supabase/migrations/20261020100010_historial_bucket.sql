-- MSF-293 (F-VTA-37): bucket privado `historial-importaciones` con la planilla subida para importar.
-- Esquema: Storage (no es tabla). Prefijo `<organizacion_id>/`; sube y borra solo quien puede
-- importar (administrador, `private.puede_escribir()`); solo `.csv` y `.xlsx`. El worker lee con
-- la clave de servicio del servidor (nunca en el navegador). Sin policy de update: el archivo de
-- una ejecución creada no se reemplaza. El borrado existe solo para que la pantalla limpie la
-- planilla cuando la RPC rechazó la solicitud y ninguna ejecución la referencia; el archivo de
-- una importación aceptada se conserva como original auditado.
--
-- Migración aditiva. Reversión (migración posterior): quitar las policies
-- `historial_importaciones_*` de storage.objects y el bucket (tras vaciarlo desde la API de Storage).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'historial-importaciones', 'historial-importaciones', false, 52428800,
  array[
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  ]
)
on conflict (id) do nothing;

create policy historial_importaciones_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'historial-importaciones'
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.puede_escribir())
  );

create policy historial_importaciones_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'historial-importaciones'
    and array_length(storage.foldername(name), 1) = 1
    and lower(storage.extension(name)) in ('csv', 'xlsx')
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.puede_escribir())
  );

create policy historial_importaciones_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'historial-importaciones'
    and array_length(storage.foldername(name), 1) = 1
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.puede_escribir())
    -- El original de una ejecución creada no se borra: solo la planilla que quedó
    -- huérfana porque la RPC rechazó la solicitud (ninguna ejecución la referencia).
    and not exists (
      select 1 from public.ejecuciones_worker e
      where e.organizacion_id = (select private.organizacion_id())
        and e.detalle->>'archivo' = name
    )
  );
