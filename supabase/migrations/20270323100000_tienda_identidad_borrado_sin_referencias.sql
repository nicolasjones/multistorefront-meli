-- MSF-796 (épica contenedora MSF-515, Lote 1): el bucket `tienda-identidad` ya no deja borrar un archivo que la tienda
-- publicada, el borrador o alguna versión restaurable todavía referencian. Hasta ahora esa guarda era solo un consejo
-- del cliente (`public.rutas_tienda_sin_referencia`, FR-062): un editor podía llamar a la Storage API y borrar el logo o
-- el banner de una versión a la que después se restaura, dejando la tienda con una imagen rota.
--
-- Esquemas (Principio VII, re-verificado):
--   * `storage.objects` (política `tienda_identidad_objetos_delete`) -> `storage`: infraestructura de plataforma, no es
--     una tabla de negocio; se reemplaza una política existente.
--   * `private.ruta_identidad_referenciada(text)` -> `private`: lógica interna, solo la evalúa la política.
--   * Sin tablas nuevas ni alteradas.
--
-- Decisión: la regla vive en la BASE, en la propia política de borrado (no en una RPC de limpieza). Así vale para
-- cualquier cliente de la Storage API, el panel sigue usando `storage.remove` sin cambios y un borrado denegado por la
-- política simplemente no borra la fila (la API devuelve el objeto como no borrado, sin error). La función es
-- `security definer` porque la persona editora no puede leer las versiones ni el borrador por tabla.
--
-- Aditiva, idempotente. Reversión (migración posterior):
--   drop policy if exists tienda_identidad_objetos_delete on storage.objects;
--   create policy tienda_identidad_objetos_delete on storage.objects for delete to authenticated using (
--     bucket_id = 'tienda-identidad'
--     and (storage.foldername(name))[1] = (select private.organizacion_id())::text
--     and (select private.nivel_seccion('empresas')) = 'edicion');
--   drop function if exists private.ruta_identidad_referenciada(text);

-- ¿Alguna referencia viva usa esta ruta del bucket? Referencias: la identidad publicada (`dominio.tienda_identidad`),
-- el borrador (`dominio.tienda_borrador.identidad`) y la instantánea de cada versión
-- (`dominio.tienda_versiones.instantanea -> identidad`), en sus tres columnas de ruta: logo, banner y banner móvil.
-- La ruta es `<organizacion_id>/<empresa_id>/<archivo>`; el segmento de empresa acota la búsqueda por clave primaria.
-- Una ruta mal formada (sin empresa válida) no puede estar referenciada y devuelve falso.
create or replace function private.ruta_identidad_referenciada(p_ruta text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
begin
  if p_ruta is null then
    return false;
  end if;
  begin
    v_empresa := split_part(p_ruta, '/', 2)::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  return exists (
           select 1 from dominio.tienda_identidad i
            where i.empresa_id = v_empresa
              and p_ruta in (i.logo_ruta, i.banner_ruta, i.banner_movil_ruta))
      or exists (
           select 1 from dominio.tienda_borrador b
            where b.empresa_id = v_empresa
              and p_ruta in (b.identidad ->> 'logo_ruta', b.identidad ->> 'banner_ruta', b.identidad ->> 'banner_movil_ruta'))
      or exists (
           select 1 from dominio.tienda_versiones v
            where v.empresa_id = v_empresa
              and p_ruta in (v.instantanea -> 'identidad' ->> 'logo_ruta',
                             v.instantanea -> 'identidad' ->> 'banner_ruta',
                             v.instantanea -> 'identidad' ->> 'banner_movil_ruta'));
end;
$$;

comment on function private.ruta_identidad_referenciada(text) is
  'MSF-796: true si la ruta del bucket tienda-identidad la usa la identidad publicada, el borrador o alguna versión (logo, banner o banner móvil). La usa la política de borrado de storage.objects; sin acceso para anon.';

-- La política se evalúa con los privilegios de la persona: necesita `execute`; anon y public no.
revoke execute on function private.ruta_identidad_referenciada(text) from public, anon;
grant execute on function private.ruta_identidad_referenciada(text) to authenticated;

-- Misma política de antes (organización propia + edición en Empresas) más la guarda de referencias.
drop policy if exists tienda_identidad_objetos_delete on storage.objects;

create policy tienda_identidad_objetos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'tienda-identidad'
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.nivel_seccion('empresas')) = 'edicion'
    and not private.ruta_identidad_referenciada(name)
  );
