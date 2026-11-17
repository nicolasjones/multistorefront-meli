-- MSF-652: `public.activar_version_documento` (y su cuerpo `private.activar_version_documento`) no validaba
-- la organización, el rol ni la funcionalidad. Quien conocía el UUID de una versión `procesando` de OTRA
-- organización podía activarla (y reemplazar la versión vigente de un documento ajeno); dentro de la propia
-- organización, cualquier miembro podía activar versiones de otros.
--
-- Desde acá, con la misma forma que `private.eliminar_documento`:
--   * organización: la del documento dueño de la versión debe ser la del llamador (`private.organizacion_id()`).
--     Versión inexistente, ya procesada o de otra organización dan el MISMO error genérico 22023 (no se
--     puede sondear qué ids existen en otras organizaciones).
--   * funcionalidad: `busqueda-documental` habilitada en la organización del llamador (42501 si no),
--     igual que la política de INSERT de `versiones_documento`.
--   * rol: la persona que subió la versión (`subida_por`, es quien dispara `indexar-documento` con su sesión)
--     o un administrador activo de la organización (42501 si no).
-- Se toma bloqueo de fila sobre la versión para que dos activaciones simultáneas no se pisen.
--
-- El llamador existente (`supabase/functions/indexar-documento`) invoca la RPC con la sesión de quien subió el
-- archivo: sigue funcionando. Mismas firmas y mismos privilegios (`revoke ... from public, anon` y
-- `grant execute ... to authenticated` explícitos para el wrapper de `public`).
--
-- Esquemas (Principio VII): no se crean ni alteran tablas. Migración aditiva (solo redefine funciones).
-- Reversión (migración posterior): volver a la definición de `20261005000001_rag_busqueda_documental.sql`.

create or replace function private.activar_version_documento(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_documento_id uuid;
  v_organizacion_id uuid;
  v_subida_por uuid;
  v_mi_organizacion uuid := (select private.organizacion_id());
begin
  select v.documento_id, d.organizacion_id, v.subida_por
    into v_documento_id, v_organizacion_id, v_subida_por
    from public.versiones_documento v
    join public.documentos d on d.id = v.documento_id
   where v.id = p_version_id and v.estado = 'procesando'
     and d.organizacion_id = v_mi_organizacion
     for update of v;

  if v_documento_id is null then
    raise exception 'Versión no encontrada o ya procesada' using errcode = '22023';
  end if;

  if not (select private.tiene_feature('busqueda-documental')) then
    raise exception 'La búsqueda documental no está habilitada para esta organización' using errcode = '42501';
  end if;

  if v_subida_por is distinct from (select auth.uid())
     and not (select private.es_administrador_propio_de(v_organizacion_id)) then
    raise exception 'Solo quien subió la versión o un administrador puede activarla' using errcode = '42501';
  end if;

  -- Atómico: reemplazar la activa anterior y activar la nueva en una sola
  -- transacción (la función ya corre en una) — nunca hay ventana sin
  -- ninguna versión usable (R4, T011).
  update public.versiones_documento set estado = 'reemplazada'
  where documento_id = v_documento_id and estado = 'activa';

  update public.versiones_documento set estado = 'activa'
  where id = p_version_id;
end;
$$;

comment on function private.activar_version_documento(uuid) is
  'Contrato: specs/20261003-213800-rag-busqueda-documental/contracts/indexacion-documento.md paso 5. Llamar solo tras indexar todos los fragmentos con éxito. Valida organización (22023 genérico), funcionalidad y rol (quien subió la versión o administrador; 42501).';

revoke execute on function public.activar_version_documento(uuid) from public, anon;
grant execute on function public.activar_version_documento(uuid) to authenticated;
