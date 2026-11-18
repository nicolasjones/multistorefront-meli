-- MSF-638 (lote 32, MSF-647): `public.obtener_reparacion` responde 404 (no 500) cuando la reparación no existe o no es
-- visible para quien pregunta.
--
-- Hallazgo: fuera del alcance la función levantaba `P0002` (no_data_found), que PostgREST no traduce a un estado de
-- cliente claro y la pantalla veía como un error del servidor. Ahora usa el código `PT404` (PostgREST → HTTP 404).
-- Sin oráculo de existencia: «no existe», «es de otra organización» y «es de una tienda a la que no accedés» dan
-- EXACTAMENTE la misma respuesta (mismo código y mismo mensaje). Un rol sin la sección `service_tecnico` sigue
-- recibiendo `42501` (HTTP 403), igual para cualquier id.
--
-- Parte de la definición VIGENTE (20261020140000_reparaciones_lectura_por_tienda.sql); solo cambia el código y el
-- mensaje de los dos rechazos. `security definer`, `search_path = ''`, grants sin cambios (revoke public/anon y grant a
-- authenticated se reafirman).
--
-- Migración aditiva (create or replace). Reversión: volver a la definición de 20261020140000 (`errcode = 'P0002'`).

create or replace function public.obtener_reparacion(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_json jsonb;
begin
  if (select private.organizacion_id()) is null
     or (select private.nivel_seccion('service_tecnico')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver reparaciones' using errcode = '42501';
  end if;
  -- Una reparación de otra organización o de una tienda inaccesible se trata como inexistente: misma respuesta.
  if not exists (
    select 1 from dominio.reparaciones r
    where r.id = p_id
      and r.organizacion_id = (select private.organizacion_id())
      and r.empresa_id in (select private.empresas_accesibles())
  ) then
    raise exception 'La reparación no existe' using errcode = 'PT404';
  end if;
  v_json := private.reparacion_json(p_id);
  if v_json is null then
    raise exception 'La reparación no existe' using errcode = 'PT404';
  end if;
  return v_json;
end;
$$;

comment on function public.obtener_reparacion(uuid) is
  'F-SVC-02 / MSF-638: una reparación con cliente, modelo y estado; los costos internos llegan nulos sin ver_costos. Inexistente, de otra organización o de una tienda inaccesible: PT404 (HTTP 404) con el mismo mensaje; sin la sección service_tecnico: 42501.';

revoke execute on function public.obtener_reparacion(uuid) from public, anon;
grant execute on function public.obtener_reparacion(uuid) to authenticated;
