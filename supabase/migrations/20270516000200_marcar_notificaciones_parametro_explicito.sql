-- MSF-817 / MSF-224 (hallazgo 7, lote 101): `marcar_notificaciones_leidas(p_ids)` con `p_ids` ausente equivalía a «marcar todas»: un
-- cliente que enviaba `undefined` (que la librería omite) marcaba todo sin querer. Ahora «todas» es un parámetro EXPLÍCITO
-- `p_todas := true`; sin ids y sin `p_todas` la función falla con PARAMETRO_REQUERIDO en vez de actuar, y pasar ids junto con
-- `p_todas` es ambiguo y también falla. Un arreglo de ids vacío marca 0.
-- El panel (CampanitaNotificaciones) pasa a enviar `{ p_ids: null, p_todas: true }` en «Marcar todas como leídas».
--
-- Compatibilidad: un cliente viejo que envía solo `{ p_ids: null }` recibe un error (antes marcaba todas): despliegue del panel y
-- de la base juntos; el error es visible en vez de silencioso.
--
-- Reversión (migración posterior): drop function public.marcar_notificaciones_leidas(uuid[], boolean); y volver a crear la versión de
-- 20270217300002_notificaciones_funciones.sql (`marcar_notificaciones_leidas(p_ids uuid[] default null)`, nulo = todas) con
-- `grant execute ... to authenticated` y `revoke ... from public, anon`.

drop function if exists public.marcar_notificaciones_leidas(uuid[]);

create or replace function public.marcar_notificaciones_leidas(p_ids uuid[] default null, p_todas boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marcadas integer;
begin
  if auth.uid() is null then
    return 0;
  end if;
  if p_todas and p_ids is not null then
    raise exception 'PARAMETRO_AMBIGUO: pasar ids o p_todas, no ambos' using errcode = '22023';
  end if;
  if not p_todas and p_ids is null then
    raise exception 'PARAMETRO_REQUERIDO: indicar los ids a marcar o p_todas = true' using errcode = '22023';
  end if;

  -- Idempotente: solo toca avisos propios vigentes (mismo filtro de acceso que el conteo) que siguen sin leer (leido_en conserva el primer momento).
  update public.avisos_pendientes a
     set leido_en = now()
   where a.user_id = auth.uid()
     and a.organizacion_id = private.organizacion_id()
     and a.estado <> 'descartado'
     and a.leido_en is null
     and (p_todas or a.id = any (p_ids))
     and a.tipo_aviso in (
       select t.clave from public.tipos_aviso t
        where private.nivel_seccion_de_usuario(auth.uid(), t.seccion) <> 'ninguno');
  get diagnostics v_marcadas = row_count;
  return v_marcadas;
end;
$$;

revoke all on function public.marcar_notificaciones_leidas(uuid[], boolean) from public, anon;
grant execute on function public.marcar_notificaciones_leidas(uuid[], boolean) to authenticated;
