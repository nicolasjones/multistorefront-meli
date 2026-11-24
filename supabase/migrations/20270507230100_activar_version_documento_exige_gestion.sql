-- Menor (lote 41): `private.activar_version_documento` no exigía `private.puede_gestionar_documentos()`; un miembro con rol Consulta
-- que subió una versión (o un administrador-Consulta) pasaba los controles de organización, funcionalidad y autoría. El handler de
-- `indexar-documento` ya lo bloquea, pero la RPC es invocable directamente: la regla vive también en la base.
--
-- Se parte de la definición vigente (20270507150000_activar_version_documento_valida_organizacion.sql) y se agrega, después del
-- control de funcionalidad, la exigencia de `puede_gestionar_documentos()` (42501). Sin cambios de firma ni de privilegios
-- (`security definer`, `search_path = ''`; `public.activar_version_documento`: `revoke ... from public, anon`, `grant ... to authenticated`).
--
-- Migración aditiva (solo redefine la función). Reversión (migración posterior): `create or replace function
-- private.activar_version_documento(p_version_id uuid)` con la definición de
-- `20270507150000_activar_version_documento_valida_organizacion.sql` (la misma sin el bloque de `puede_gestionar_documentos()`);
-- firma y privilegios no cambian.

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

  if not (select private.puede_gestionar_documentos()) then
    raise exception 'Tu rol no puede gestionar documentos' using errcode = '42501';
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
  'Contrato: specs/20261003-213800-rag-busqueda-documental/contracts/indexacion-documento.md paso 5. Llamar solo tras indexar todos los fragmentos con éxito. Valida organización (22023 genérico), funcionalidad, gestión de documentos (no Consulta) y rol (quien subió la versión o administrador; 42501).';
