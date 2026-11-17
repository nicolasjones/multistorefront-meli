-- Deuda m1 de `indexar-documento` (docs/funciones-edge-endurecimiento.md, lote 35, hallazgo menor de #1120):
-- el handler releía la versión y luego borraba sus fragmentos en dos pasos sin transacción; en el medio otra
-- invocación podía retomar o activar la versión. Esta función hace la comprobación y el borrado en UNA transacción.
--
-- `private.borrar_fragmentos_si_dueno(p_version_id, p_reclamo)` borra los fragmentos de la versión solo si ésta
-- sigue en manos de la invocación que llama: existe, NO está `activa` y NO fue retomada por otra invocación
-- (`procesando` con un `motivo_error` distinto del reclamo propio). Cubre los tres usos del handler: reintento
-- previo a insertar (`procesando` con el reclamo propio), limpieza tras un error transitorio y limpieza tras
-- marcarla `fallida`. Toma `for share` sobre la fila de la versión, de modo que una activación o un nuevo reclamo
-- concurrentes esperan a que termine el borrado. Devuelve `true` si era dueña (aunque no hubiera fragmentos) y
-- `false` si no (nada se borró).
--
-- `public.borrar_fragmentos_si_dueno` es el envoltorio invocable por RPC (el patrón de `resolver_politica_ia`:
-- `private` no está expuesto en la API) y solo lo ejecuta `service_role` (la función Edge, con su cliente admin).
-- Ambas: `security definer`, `set search_path = ''`.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function if exists public.borrar_fragmentos_si_dueno(uuid, text);
--   drop function if exists private.borrar_fragmentos_si_dueno(uuid, text);
--   y en `supabase/functions/indexar-documento` volver al borrado con la sesión del usuario.

create or replace function private.borrar_fragmentos_si_dueno(p_version_id uuid, p_reclamo text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estado text;
  v_motivo text;
begin
  select v.estado, v.motivo_error into v_estado, v_motivo
    from public.versiones_documento v
   where v.id = p_version_id
     for share;
  if not found or v_estado = 'activa'
     or (v_estado = 'procesando' and v_motivo is distinct from p_reclamo) then
    return false;
  end if;
  delete from public.fragmentos_indexados where version_id = p_version_id;
  return true;
end;
$$;

create or replace function public.borrar_fragmentos_si_dueno(p_version_id uuid, p_reclamo text)
returns boolean
language sql
security definer
set search_path = ''
as $$ select private.borrar_fragmentos_si_dueno(p_version_id, p_reclamo) $$;

revoke execute on function private.borrar_fragmentos_si_dueno(uuid, text) from public, anon, authenticated;
revoke execute on function public.borrar_fragmentos_si_dueno(uuid, text) from public, anon, authenticated;
grant execute on function private.borrar_fragmentos_si_dueno(uuid, text) to service_role;
grant execute on function public.borrar_fragmentos_si_dueno(uuid, text) to service_role;
