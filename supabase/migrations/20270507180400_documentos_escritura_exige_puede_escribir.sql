-- MSF-651 (lote 32, MSF-647): las políticas de escritura de `public.fragmentos_indexados` y del bucket `documentos-rag`
-- exigen `private.puede_escribir()`: el rol Consulta (y cualquiera sin escritura) ya no inserta, modifica ni borra.
--
-- Hallazgo: `fragmentos_indexados_propia_organizacion` (`for all`) y las políticas `insert`/`delete` de
-- `storage.objects` para `documentos-rag` solo comprobaban la organización: cualquier miembro autenticado, también de
-- solo lectura, podía subir o borrar archivos y escribir fragmentos por la API directa.
--
-- Qué cambia (parte de las definiciones de 20261005000001_rag_busqueda_documental.sql, que son las vigentes):
--   · `fragmentos_indexados`: la política `for all` se divide en `select` (organización, como hasta ahora) y
--     `insert`/`update`/`delete` (organización + `private.puede_escribir()`).
--   · `storage.objects` (`documentos-rag`): `insert` y `delete` agregan `private.puede_escribir()`; `select` queda igual.
-- La indexación de documentos corre con el rol de servicio (no pasa por estas políticas). Las tablas `documentos` y
-- `versiones_documento` quedan como están (fuera del alcance de este ítem; ver docs/busqueda-documental.md).
--
-- Migración aditiva en datos (solo políticas). Reversión: `drop policy` de las cuatro nuevas y de las dos de storage, y
-- recrear `fragmentos_indexados_propia_organizacion` (for all) y las políticas `documentos_rag_propia_organizacion_*`
-- de 20261005000001.

drop policy if exists fragmentos_indexados_propia_organizacion on public.fragmentos_indexados;

create policy fragmentos_indexados_select on public.fragmentos_indexados
  for select to authenticated
  using (organizacion_id = (select private.organizacion_id()));

create policy fragmentos_indexados_insert on public.fragmentos_indexados
  for insert to authenticated
  with check (organizacion_id = (select private.organizacion_id()) and (select private.puede_escribir()));

create policy fragmentos_indexados_update on public.fragmentos_indexados
  for update to authenticated
  using (organizacion_id = (select private.organizacion_id()) and (select private.puede_escribir()))
  with check (organizacion_id = (select private.organizacion_id()) and (select private.puede_escribir()));

create policy fragmentos_indexados_delete on public.fragmentos_indexados
  for delete to authenticated
  using (organizacion_id = (select private.organizacion_id()) and (select private.puede_escribir()));

drop policy if exists documentos_rag_propia_organizacion_insert on storage.objects;
create policy documentos_rag_propia_organizacion_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documentos-rag'
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.puede_escribir())
  );

drop policy if exists documentos_rag_propia_organizacion_delete on storage.objects;
create policy documentos_rag_propia_organizacion_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documentos-rag'
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.puede_escribir())
  );
