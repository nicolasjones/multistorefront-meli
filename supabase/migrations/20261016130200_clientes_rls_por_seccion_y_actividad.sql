-- F-CLI-01 (MSF-262, épica MSF-180): permisos de Clientes por sección y
-- registro de actividad. Esquema: `public.clientes` (excepción documentada en
-- la spec, Principio VII); sin tablas nuevas.
--
-- Reemplaza las políticas de `private.puede_escribir()` (solo administrador)
-- por el contrato `private.nivel_seccion('clientes')` (docs/permisos-por-rol.md)
-- y cierra el «riesgo aceptado» de lectura con sección en `ninguno`.
--
-- Reversión (migración posterior; no destruye datos):
--   drop trigger clientes_registrar_actividad on public.clientes;
--   drop function private.registrar_actividad_cliente();
--   drop policy clientes_select on public.clientes;
--   drop policy clientes_insert on public.clientes;
--   drop policy clientes_update on public.clientes;
--   create policy clientes_select on public.clientes for select to authenticated
--     using (organizacion_id = private.organizacion_id());
--   create policy clientes_insert on public.clientes for insert to authenticated
--     with check (organizacion_id = private.organizacion_id() and private.puede_escribir());
--   create policy clientes_update on public.clientes for update to authenticated
--     using (organizacion_id = private.organizacion_id() and private.puede_escribir())
--     with check (organizacion_id = private.organizacion_id() and private.puede_escribir());
--   revoke insert, update on public.clientes from authenticated;
--   grant select, insert, update on public.clientes to authenticated;

-- ============================================================================
-- RLS por organización y sección (FR-004). Sin política DELETE (FR-003).
-- ============================================================================

drop policy if exists clientes_select on public.clientes;
drop policy if exists clientes_insert on public.clientes;
drop policy if exists clientes_update on public.clientes;

create policy clientes_select on public.clientes
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('clientes')) in ('lectura', 'edicion')
  );

create policy clientes_insert on public.clientes
  for insert to authenticated
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('clientes')) = 'edicion'
  );

create policy clientes_update on public.clientes
  for update to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('clientes')) = 'edicion'
  )
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('clientes')) = 'edicion'
  );

-- ============================================================================
-- Grants por columna: `numero` lo asigna la base y `organizacion_id` no se
-- reasigna. `anon` sin acceso. Sin DELETE para nadie.
-- ============================================================================

revoke all on public.clientes from anon, public;
revoke insert, update on public.clientes from authenticated;

grant select on public.clientes to authenticated;
grant insert (
  id, organizacion_id, nombre, documento, correo, telefono, celular, direccion,
  codigo_postal, localidad, provincia
) on public.clientes to authenticated;
grant update (
  nombre, documento, correo, telefono, celular, direccion,
  codigo_postal, localidad, provincia, archivado_en
) on public.clientes to authenticated;

-- ============================================================================
-- Actividad (FR-005): misma transacción, sin datos de contacto en el detalle,
-- solo con sesión (las cargas sin actor —importación, API— no generan evento) y
-- solo ante cambios reales (archivar un cliente ya archivado no duplica).
-- ============================================================================

create or replace function private.registrar_actividad_cliente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_tipo text;
  v_detalle text;
begin
  if v_actor is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_tipo := 'cliente.creado';
    v_detalle := format('Creó el cliente Nº %s · %s', new.numero, new.nombre);
  elsif old.archivado_en is null and new.archivado_en is not null then
    v_tipo := 'cliente.archivado';
    v_detalle := format('Archivó el cliente Nº %s · %s', new.numero, new.nombre);
  elsif old.archivado_en is not null and new.archivado_en is null then
    v_tipo := 'cliente.restaurado';
    v_detalle := format('Restauró el cliente Nº %s · %s', new.numero, new.nombre);
  elsif (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    v_tipo := 'cliente.editado';
    v_detalle := format('Editó el cliente Nº %s · %s', new.numero, new.nombre);
  else
    return new;
  end if;

  perform private.insertar_actividad(new.organizacion_id, v_actor, v_tipo, v_detalle, null);
  return new;
end;
$$;

revoke execute on function private.registrar_actividad_cliente() from public, anon, authenticated;

create trigger clientes_registrar_actividad
  after insert or update on public.clientes
  for each row execute function private.registrar_actividad_cliente();
