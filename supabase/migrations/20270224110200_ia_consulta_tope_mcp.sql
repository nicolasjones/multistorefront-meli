-- F-IA-01 (MSF-411, épica MSF-233) · FR-023 / D-8: tope de 50 filas por consulta para las fuentes `ia_consulta_*`.
-- Redefine `private.mcp_leer_fila` (misma firma y privilegios) a partir de `20261003233000_mcp_lectura_centralizada.sql`:
-- solo agrega la rama de las vistas `ia_consulta_%` (50 filas, las más recientes primero). Las demás vistas se leen igual.
-- Migración aditiva. Reversión (migración posterior): volver a la definición de `20261003233000`.

create or replace function private.mcp_leer_fila(p_organizacion_id uuid, p_feature_id text, p_filtros jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_vista text;
  v_where text := '';
  v_clave text;
  v_valor text;
  v_resultado jsonb;
begin
  if not private.puede_mcp_leer_funcionalidad(p_feature_id, p_organizacion_id) then
    raise exception 'Funcionalidad no legible para esta organización' using errcode = '42501';
  end if;

  select vista into v_vista from public.fuentes_mcp where feature_id = p_feature_id limit 1;
  if v_vista is null then
    raise exception 'Sin vista registrada para %', p_feature_id using errcode = '42704';
  end if;

  -- Filtros adicionales del llamador: nombre de columna vía format(%I)
  -- (identificador seguro, nunca concatenación directa) y valor vía
  -- format(%L) (literal escapado). Si el llamador intenta meter su propio
  -- "organizacion_id" en p_filtros, el resultado es una condición
  -- contradictoria (and organizacion_id = <el real> and organizacion_id =
  -- <el que mandó>) que a lo sumo devuelve menos filas, nunca de otra
  -- organización — el primer `organizacion_id = %L` ya fijo abajo es el que
  -- manda siempre.
  for v_clave, v_valor in select key, value from jsonb_each_text(coalesce(p_filtros, '{}'::jsonb))
  loop
    v_where := v_where || format(' and %I = %L', v_clave, v_valor);
  end loop;

  -- search_path='' en esta función: sin calificar explícitamente el
  -- esquema, %I por sí solo no resuelve a nada (ninguna ruta de búsqueda
  -- implícita). fuentes_mcp.vista siempre refiere a una vista/tabla de
  -- public — mismo supuesto que ya tenía el código viejo vía supabase-js.
  if v_vista like 'ia_consulta\_%' then
    -- F-IA-01 (FR-023, D-8): las fuentes del asistente devuelven como máximo 50 filas por consulta, las más
    -- recientes primero (`actualizado_en`, o `confirmado_en` en ventas). El resto de las vistas no cambia.
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(s)), ''[]''::jsonb) from ('
      || 'select t.* from public.%I t where organizacion_id = %L%s '
      || 'order by coalesce(to_jsonb(t) ->> ''actualizado_en'', to_jsonb(t) ->> ''confirmado_en'') desc nulls last, to_jsonb(t)::text '
      || 'limit 50) s',
      v_vista, p_organizacion_id, v_where
    ) into v_resultado;
    return v_resultado;
  end if;

  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t where organizacion_id = %L%s',
    v_vista, p_organizacion_id, v_where
  ) into v_resultado;

  return v_resultado;
end;
$$;
