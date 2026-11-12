-- F-PRE-10 (MSF-436, épica MSF-363): la vista previa de una actualización masiva exige el mismo permiso que aplicarla.
--
-- Hallazgo de la revisión de MSF-363: con `rentabilidad` en LECTURA, `previsualizar_actualizacion_precios` aceptaba cambiar
-- costos (modo «ambos» o una planilla con costo) y mostraba el resultado, pero `aplicar_actualizacion_precios` respondía 42501
-- («Tu rol no puede cambiar costos»). Ahora la vista previa rechaza lo mismo que aplicar: cambiar costos exige `rentabilidad`
-- en edición. Quien solo lee costos sigue viendo los costos en una vista previa que cambia únicamente el precio de lista.
--
-- Esquema (Principio VII): sin tablas nuevas; se reemplaza una RPC (misma firma y grants). Migración aditiva.
-- Reversión (migración posterior): recrear la función de `20270221100007_precios_masivos_previsualizar.sql`.

create or replace function public.previsualizar_actualizacion_precios(p_modo text, p_parametros jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_con_costo boolean := (select private.nivel_seccion('rentabilidad')) in ('lectura', 'edicion');
  v_rent text := (select private.nivel_seccion('rentabilidad'));
  v_toca_costo boolean;
  v_filas jsonb;
begin
  if (select auth.uid()) is null or v_org is null or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede actualizar precios' using errcode = '42501';
  end if;
  if p_parametros is null or jsonb_typeof(p_parametros) <> 'object' then
    raise exception 'Faltan los parámetros de la actualización' using errcode = '22023';
  end if;
  -- Mismo criterio que `aplicar_actualizacion_precios`: cambiar costos exige `rentabilidad` en EDICIÓN. Antes la vista previa
  -- lo permitía con solo lectura y después aplicar respondía 42501.
  v_toca_costo := case p_modo
    when 'porcentaje' then coalesce(p_parametros->>'cambia', '') in ('costo', 'ambos')
    else exists (
      select 1 from jsonb_array_elements(
        case when jsonb_typeof(p_parametros->'filas') = 'array' then p_parametros->'filas' else '[]'::jsonb end
      ) f where jsonb_typeof(f->'costo') = 'number'
    )
  end;
  if v_toca_costo and v_rent <> 'edicion' then
    raise exception 'Tu rol no puede cambiar costos' using errcode = '42501';
  end if;

  v_filas := private.calcular_actualizacion_precios(v_org, v_con_costo, p_modo, p_parametros);

  return jsonb_build_object(
    'afectados', (select count(*) from jsonb_array_elements(v_filas) f where (f->>'cambia')::boolean),
    'sin_cambio', (select count(*) from jsonb_array_elements(v_filas) f
                    where f->>'error' is null and not (f->>'cambia')::boolean),
    'con_error', (select count(*) from jsonb_array_elements(v_filas) f where f->>'error' is not null),
    'filas', v_filas
  );
end;
$$;
