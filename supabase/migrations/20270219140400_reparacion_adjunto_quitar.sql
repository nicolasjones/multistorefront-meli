-- F-SVC-20 (MSF-134, épica MSF-124): `quitar_adjunto_reparacion`.
-- Esquema: sin tablas nuevas (borra de `dominio.reparacion_adjuntos` solo desde esta RPC; Principio VII).
--
-- SECURITY DEFINER. Mismas reglas de permiso y situación que registrar (`edicion`, tienda accesible,
-- `for update`, `55000` si está anulada). Borra la fila y devuelve la `ruta` para que el cliente borre el
-- objeto de Storage (si ese borrado falla queda un huérfano inaccesible, ver docs/service-adjuntos.md).
-- Un adjunto inexistente o de otra organización es `P0002`. Registra `reparacion.adjunto_quitado`.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.quitar_adjunto_reparacion(uuid);

create or replace function public.quitar_adjunto_reparacion(p_adjunto uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_reparacion uuid;
  v_actual dominio.reparaciones;
  v_fila dominio.reparacion_adjuntos;
begin
  if v_org is null or (select auth.uid()) is null
     or (select private.nivel_seccion('service_tecnico')) is distinct from 'edicion' then
    raise exception 'Tu rol no puede modificar los adjuntos de una reparación' using errcode = '42501';
  end if;
  select a.reparacion_id into v_reparacion
    from dominio.reparacion_adjuntos a
   where a.id = p_adjunto and a.organizacion_id = v_org;
  if not found then
    raise exception 'El adjunto no existe' using errcode = 'P0002';
  end if;

  v_actual := private.bloquear_reparacion_para_adjuntos(v_reparacion);

  -- Otra sesión pudo quitarlo mientras esperábamos el bloqueo.
  delete from dominio.reparacion_adjuntos a
   where a.id = p_adjunto and a.organizacion_id = v_org
  returning * into v_fila;
  if not found then
    raise exception 'El adjunto no existe' using errcode = 'P0002';
  end if;

  perform private.registrar_actividad(
    'reparacion.adjunto_quitado',
    format('Quitó la foto «%s» de la reparación %s', v_fila.nombre_original, private.codigo_reparacion(v_actual.numero)),
    v_actual.empresa_id
  );

  return jsonb_build_object('ruta', v_fila.ruta);
end;
$$;

comment on function public.quitar_adjunto_reparacion(uuid) is
  'F-SVC-20: borra la fila del adjunto y devuelve su ruta para que el cliente borre el objeto; edicion, no anulada, actividad.';

revoke execute on function public.quitar_adjunto_reparacion(uuid) from public, anon;
grant execute on function public.quitar_adjunto_reparacion(uuid) to authenticated;
