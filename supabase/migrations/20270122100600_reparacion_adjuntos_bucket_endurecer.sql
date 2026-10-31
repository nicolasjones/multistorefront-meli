-- F-SVC-20 (MSF-134, épica MSF-124): endurece las políticas de `storage.objects` del bucket
-- `reparacion-adjuntos` (devolución del Revisor, PR #549).
-- Esquema: sin tablas nuevas; solo políticas de infraestructura de plataforma (Principio VII).
--
--   * insert: la reparación no puede estar anulada (FR-008) y la carpeta admite como máximo 20 objetos
--     (el tope de negocio de `registrar_adjunto_reparacion`), así nadie acumula huérfanos sin límite.
--   * delete: solo objetos SIN fila en `dominio.reparacion_adjuntos` (huérfanos) y de una reparación no
--     anulada. Quitar un adjunto registrado pasa por `quitar_adjunto_reparacion`, que borra la fila (y deja
--     la actividad) antes de que el cliente borre el objeto; un `storage.remove()` directo ya no sirve.
--
-- Migración aditiva (reemplaza políticas de la 20270122100200). Reversión (migración posterior):
-- volver a crear las dos políticas con la definición de 20270122100200.

drop policy if exists reparacion_adjuntos_insert on storage.objects;
drop policy if exists reparacion_adjuntos_delete on storage.objects;

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
        and r.anulada_en is null
    )
    and (
      select count(*) from storage.objects o
      where o.bucket_id = 'reparacion-adjuntos'
        and (storage.foldername(o.name))[1] = (storage.foldername(name))[1]
        and (storage.foldername(o.name))[2] = (storage.foldername(name))[2]
    ) < 20
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
        and r.anulada_en is null
    )
    and not exists (
      select 1 from dominio.reparacion_adjuntos a
      where a.ruta = name
    )
  );
