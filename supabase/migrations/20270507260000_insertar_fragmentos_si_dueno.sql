-- Menor de `indexar-documento` (lote 41, hallazgo de la revisión de #1120): `insertarFragmentos` seguía siendo un `insert` aparte
-- tras el borrado, sin volver a comprobar que la versión continuaba en manos de la invocación que llama (otra invocación podía
-- retomarla o activarla entre el borrado y la inserción y recibir fragmentos duplicados o de una versión ya activa).
--
-- `private.insertar_fragmentos_si_dueno(p_version_id, p_organizacion_id, p_reclamo, p_filas)` inserta los fragmentos solo si la
-- versión existe, es de la organización indicada, sigue `procesando` y con el reclamo PROPIO (`motivo_error = p_reclamo`). Toma
-- `for share` sobre la fila de la versión (como `borrar_fragmentos_si_dueno`), así una activación o un reclamo concurrentes esperan
-- a que termine la inserción. `p_filas` es un arreglo jsonb de `{texto, embedding, orden}`; la versión y la organización de cada
-- fila las pone la función (no se confía en las del llamador). Devuelve `true` si insertó (también con 0 filas) y `false` si no era
-- dueña (no se inserta nada).
--
-- `public.insertar_fragmentos_si_dueno` es el envoltorio invocable por RPC (`private` no está expuesto) y solo lo ejecuta
-- `service_role`. Ambas: `security definer`, `set search_path = ''`.
--
-- Además se quita el `grant execute ... to service_role` de `private.borrar_fragmentos_si_dueno` (migración 20270507200100): era
-- superfluo, el envoltorio `public` es `security definer` y llama a la función privada con los privilegios de su dueño.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function if exists public.insertar_fragmentos_si_dueno(uuid, uuid, text, jsonb);
--   drop function if exists private.insertar_fragmentos_si_dueno(uuid, uuid, text, jsonb);
--   grant execute on function private.borrar_fragmentos_si_dueno(uuid, uuid, text) to service_role;  -- solo si se quiere el grant anterior
--   y en `supabase/functions/indexar-documento` volver al `insert` directo con el cliente de servicio.

create or replace function private.insertar_fragmentos_si_dueno(p_version_id uuid, p_organizacion_id uuid, p_reclamo text, p_filas jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estado text;
  v_motivo text;
begin
  if p_filas is null or jsonb_typeof(p_filas) is distinct from 'array' then
    raise exception 'p_filas debe ser un arreglo' using errcode = '22023';
  end if;
  select v.estado, v.motivo_error into v_estado, v_motivo
    from public.versiones_documento v
    join public.documentos d on d.id = v.documento_id
   where v.id = p_version_id and d.organizacion_id = p_organizacion_id
     for share of v;
  if not found or v_estado is distinct from 'procesando' or v_motivo is distinct from p_reclamo then
    return false;
  end if;
  insert into public.fragmentos_indexados (version_id, organizacion_id, texto, embedding, orden)
  select p_version_id, p_organizacion_id, f.texto, f.embedding::public.vector, f.orden
    from jsonb_to_recordset(p_filas) as f(texto text, embedding text, orden int);
  return true;
end;
$$;

create or replace function public.insertar_fragmentos_si_dueno(p_version_id uuid, p_organizacion_id uuid, p_reclamo text, p_filas jsonb)
returns boolean
language sql
security definer
set search_path = ''
as $$ select private.insertar_fragmentos_si_dueno(p_version_id, p_organizacion_id, p_reclamo, p_filas) $$;

revoke execute on function private.insertar_fragmentos_si_dueno(uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.insertar_fragmentos_si_dueno(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.insertar_fragmentos_si_dueno(uuid, uuid, text, jsonb) to service_role;

revoke execute on function private.borrar_fragmentos_si_dueno(uuid, uuid, text) from service_role;
