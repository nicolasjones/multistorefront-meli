-- F-VTA-09 (MSF-346, FR-010, devolución del Revisor PR #374): descarga del CSV de la exportación diferida por quien la pidió.
-- «Ejecuciones» es una vista de administrador y solo firma el bucket `evidencias-ejecuciones`; el CSV vive en
-- `exportaciones-ventas`. Esta RPC le devuelve a la persona que pidió la exportación (con la acción `exportar`) el estado
-- de su ejecución y, solo si terminó bien, la ruta del archivo; la app firma una URL corta con la política de Storage
-- `exportaciones_ventas_select` (organización + dueño + `exportar`). No expone ejecuciones ajenas.
--
-- Esquemas (Principio VII): sin tablas nuevas; lee `public.ejecuciones_worker` y `public.capacidades_ejecucion` (plataforma).
-- Aditiva. Reversión:
--   drop function public.archivo_exportacion_comprobantes(uuid);

create or replace function public.archivo_exportacion_comprobantes(p_ejecucion_id uuid)
returns table (estado text, archivo text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid := (select private.organizacion_id());
  v_e record;
begin
  if v_uid is null or v_org is null then
    raise exception 'NO_AUTORIZADO: sin sesión de organización' using errcode = '42501';
  end if;
  if not (select private.puede_accion('ventas', 'exportar')) then
    raise exception 'NO_AUTORIZADO: no tenés permiso para exportar' using errcode = '42501';
  end if;

  select e.estado as estado, e.detalle as detalle into v_e
    from public.ejecuciones_worker e
    join public.capacidades_ejecucion cap on cap.id = e.capacidad_id
   where e.id = p_ejecucion_id
     and e.organizacion_id = v_org
     and cap.clave like 'exportar-comprobantes-%'
     and e.detalle->>'actor' = v_uid::text;
  if not found then
    raise exception 'NO_ENCONTRADA: no hay una exportación tuya con ese identificador' using errcode = 'P0002';
  end if;

  estado := v_e.estado;
  archivo := case when v_e.estado = 'exitosa'
    then (v_e.detalle->>'archivo_prefijo') || p_ejecucion_id::text || '.csv' end;
  return next;
end;
$$;

revoke execute on function public.archivo_exportacion_comprobantes(uuid) from public, anon;
grant execute on function public.archivo_exportacion_comprobantes(uuid) to authenticated;

comment on function public.archivo_exportacion_comprobantes(uuid) is
  'F-VTA-09 (FR-010): estado de la exportación diferida propia y, si terminó, la ruta del CSV en exportaciones-ventas. Solo el solicitante con ventas/exportar.';
