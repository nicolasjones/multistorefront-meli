-- F-PRE-10 (MSF-436, épica MSF-363): aplicar la actualización masiva de costos y precios.
-- Esquemas (Principio VII): sin tablas nuevas; escribe `dominio.productos`, `dominio.producto_costos`
-- y `dominio.actualizaciones_precio` (migración 20270221100006). La RPC vive en `public` (no almacena datos).
--
-- SECURITY DEFINER (justificado: `authenticated` no puede escribir `actualizaciones_precio`).
-- Exige `productos` = edicion y, si el pedido toca costos, `rentabilidad` = edicion (42501).
-- Revalida todo con el mismo núcleo que la vista previa; no confía en valores calculados por el cliente.
-- Una sola transacción (todo o nada): cualquier error deshace el lote entero.
-- Idempotente por `p_clave` (por organización): repetirla devuelve el lote ya aplicado.
-- Conflicto: `p_parametros.versiones` = { producto_id: updated_at } de la vista previa; si algún producto
-- cambió (o entró al alcance) desde entonces → 40001 y no se aplica nada.
-- Errores: 42501 sin permiso · 40001 conflicto · 22023 datos inválidos (filas con error en DETAIL) ·
-- 54000 más de 5.000 productos. Solo escribe `precio_lista` y `costo`: moneda, escalas y precios por
-- empresa quedan intactos; los precios por empresa se calculan al leer.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.aplicar_actualizacion_precios(text, jsonb, uuid);

create or replace function public.aplicar_actualizacion_precios(p_modo text, p_parametros jsonb, p_clave uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_rent text := (select private.nivel_seccion('rentabilidad'));
  v_existente dominio.actualizaciones_precio;
  v_filas jsonb;
  v_fila jsonb;
  v_versiones jsonb;
  v_errores jsonb;
  v_toca_costo boolean;
  v_esperado timestamptz;
  v_actual timestamptz;
  v_costo_cambia boolean;
  v_cantidad integer := 0;
  v_lote uuid;
  v_nombre text;
  v_resumen jsonb;
  v_detalle text;
begin
  if v_actor is null or v_org is null or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede actualizar precios' using errcode = '42501';
  end if;
  if p_clave is null then
    raise exception 'Falta la clave de la operación' using errcode = '22023';
  end if;
  if p_parametros is null or jsonb_typeof(p_parametros) <> 'object' then
    raise exception 'Faltan los parámetros de la actualización' using errcode = '22023';
  end if;

  -- Serializa reintentos simultáneos del mismo lote.
  perform pg_advisory_xact_lock(hashtextextended('precios_masivos:' || v_org::text || ':' || p_clave::text, 0));

  select * into v_existente
    from dominio.actualizaciones_precio
   where organizacion_id = v_org and clave = p_clave;
  if found then
    return jsonb_build_object('lote_id', v_existente.id, 'aplicados', v_existente.cantidad, 'repetido', true);
  end if;

  if p_modo not in ('porcentaje', 'planilla') then
    raise exception 'El modo debe ser porcentaje o planilla' using errcode = '22023';
  end if;
  v_versiones := p_parametros->'versiones';
  if jsonb_typeof(v_versiones) is distinct from 'object' then
    raise exception 'Primero generá la vista previa' using errcode = '22023';
  end if;

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

  v_filas := private.calcular_actualizacion_precios(v_org, v_rent = 'edicion', p_modo, p_parametros);

  select jsonb_agg(f) into v_errores from jsonb_array_elements(v_filas) f where f->>'error' is not null;
  if v_errores is not null then
    raise exception 'Hay filas con errores; corregilas y volvé a generar la vista previa'
      using errcode = '22023', detail = v_errores::text;
  end if;

  select count(*) into v_cantidad from jsonb_array_elements(v_filas) f where (f->>'cambia')::boolean;
  if v_cantidad = 0 then
    raise exception 'No hay cambios para aplicar' using errcode = '22023';
  end if;
  v_cantidad := 0;

  for v_fila in
    select f from jsonb_array_elements(v_filas) f
     where (f->>'cambia')::boolean
     order by f->>'producto_id'
  loop
    v_esperado := (v_versiones->>(v_fila->>'producto_id'))::timestamptz;
    select p.updated_at into v_actual
      from dominio.productos p
     where p.id = (v_fila->>'producto_id')::uuid and p.organizacion_id = v_org
       for update;
    if v_esperado is null or v_actual is distinct from v_esperado then
      raise exception 'Un producto fue modificado por otra persona; repetí la vista previa' using errcode = '40001';
    end if;

    v_costo_cambia := v_fila ? 'costo_despues'
      and (v_fila->>'costo_despues') is not null
      and (v_fila->>'costo_despues')::numeric is distinct from (v_fila->>'costo_antes')::numeric;
    if v_costo_cambia then
      insert into dominio.producto_costos as c (producto_id, organizacion_id, costo)
      values ((v_fila->>'producto_id')::uuid, v_org, (v_fila->>'costo_despues')::numeric)
      on conflict (producto_id) do update set costo = excluded.costo
        where c.costo is distinct from excluded.costo;
    end if;

    -- Un cambio de costo también avanza updated_at del producto (bloqueo optimista de F-CAT-04).
    perform set_config('catalogo.costo_cambio', case when v_costo_cambia then 'on' else 'off' end, true);
    update dominio.productos
       set precio_lista = (v_fila->>'lista_despues')::numeric
     where id = (v_fila->>'producto_id')::uuid and organizacion_id = v_org;
    perform set_config('catalogo.costo_cambio', 'off', true);
    v_cantidad := v_cantidad + 1;
  end loop;

  select coalesce(nullif(btrim(concat_ws(' ', pu.nombre, pu.apellido)), ''), u.email::text)
    into v_nombre
    from auth.users u
    left join public.perfiles_usuario pu on pu.user_id = u.id
   where u.id = v_actor;

  -- Sin importes de costo: la tabla y la Actividad las ve quien no tiene `rentabilidad`.
  v_resumen := case p_modo
    when 'porcentaje' then jsonb_build_object(
      'cambia', p_parametros->>'cambia',
      'alcance', coalesce(p_parametros->>'alcance', 'todos'),
      'porcentaje', p_parametros->'porcentaje')
    else jsonb_build_object('filas', jsonb_array_length(p_parametros->'filas'))
  end;

  insert into dominio.actualizaciones_precio (organizacion_id, actor_id, actor_nombre, modo, parametros, cantidad, clave)
  values (v_org, v_actor, v_nombre, p_modo, v_resumen, v_cantidad, p_clave)
  returning id into v_lote;

  v_detalle := case p_modo
    when 'porcentaje' then format('Actualización masiva de precios por porcentaje (%s %%): %s producto(s)',
      replace(p_parametros->>'porcentaje', '.', ','), v_cantidad)
    else format('Actualización masiva de precios por planilla: %s producto(s)', v_cantidad)
  end;
  perform private.insertar_actividad(v_org, v_actor, 'precios.actualizacion_masiva', v_detalle, null);

  return jsonb_build_object('lote_id', v_lote, 'aplicados', v_cantidad, 'repetido', false);
end;
$$;

comment on function public.aplicar_actualizacion_precios(text, jsonb, uuid) is
  'F-PRE-10: aplica una actualización masiva de lista y costo en una transacción (todo o nada), idempotente por clave, con conflicto 40001 por updated_at. Costo solo con Rentabilidad en edición.';

revoke execute on function public.aplicar_actualizacion_precios(text, jsonb, uuid) from public, anon;
grant execute on function public.aplicar_actualizacion_precios(text, jsonb, uuid) to authenticated;
