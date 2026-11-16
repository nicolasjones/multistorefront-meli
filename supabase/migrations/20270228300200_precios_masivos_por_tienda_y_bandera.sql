-- MSF-363 (decisiones 14 y 15, aprobadas por Nicolás el 2026-11-12): precios masivos por tienda y con bandera de apagado.
--
-- (14) Antes `previsualizar_actualizacion_precios` y `aplicar_actualizacion_precios` exigían `productos` = edición GLOBAL
--      (`private.nivel_seccion`, el nivel más alto entre las tiendas de la persona). Ahora exigen edición EN LA TIENDA con
--      `private.nivel_productos_en_empresa` (20270223200000).
--      Interpretación: el precio de lista y el costo son de la ORGANIZACIÓN (`dominio.productos.precio_lista` y
--      `dominio.producto_costos`; los precios por tienda se calculan al leer), así que un cambio mueve el precio de TODAS las
--      tiendas donde el producto se vende y no hay un subconjunto «afectado» limpio (productos sin asignar, alcance por
--      categoría, planilla). Regla elegida (aprobada por Nicolás): la persona debe poder EDITAR `productos` en TODAS las
--      tiendas ACTIVAS de la organización (y haber al menos una). Una tienda a la que no accede cuenta como sin edición
--      (`nivel_productos_en_empresa` da 'ninguno'). Quien edita en A y solo lee —o no accede— en B recibe 42501 (sin
--      distinguir «otra tienda»); Administrador y superadmin con contexto cumplen; una tienda desactivada no cuenta.
--      El permiso se comprueba ANTES de cualquier lock o lectura de datos.
-- (15) Bandera `precios_masivos` (20270228300000), apagada por defecto: apagada, ambas RPC rechazan con 55000 y un mensaje claro.
--
-- Esquema (Principio VII): sin tablas nuevas; una función de plataforma en `private` y dos RPC reemplazadas (mismas firmas y grants).
-- Migración aditiva. Reversión (migración posterior): recrear las RPC de 20270223200100 (previsualizar) y 20270221100008
-- (aplicar) y `drop function private.productos_edicion_en_todas_las_tiendas()`; o encender la bandera.

create or replace function private.productos_edicion_en_todas_las_tiendas()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from dominio.empresas e
            where e.organizacion_id = (select private.organizacion_id()) and e.activa
         )
     and not exists (
           select 1 from dominio.empresas e
            where e.organizacion_id = (select private.organizacion_id()) and e.activa
              and (select private.nivel_productos_en_empresa(e.id)) <> 'edicion'
         );
$$;

revoke execute on function private.productos_edicion_en_todas_las_tiendas() from public, anon, authenticated;

comment on function private.productos_edicion_en_todas_las_tiendas() is
  'MSF-363: true si la persona edita `productos` en TODAS las tiendas activas de su organización (y hay al menos una); una tienda sin acceso cuenta como sin edición. Regla de los precios masivos, que mueven el precio de lista de la organización.';

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
  -- MSF-363 (decisiones 14 y 15): bandera de apagado y permiso EN LAS TIENDAS (ver private.productos_edicion_en_todas_las_tiendas).
  if not (select private.bandera_activa('precios_masivos')) then
    raise exception 'La actualización masiva de precios está desactivada en este entorno' using errcode = '55000';
  end if;
  if not (select private.productos_edicion_en_todas_las_tiendas()) then
    raise exception 'Para actualizar precios necesitás permiso de edición de productos en todas las tiendas' using errcode = '42501';
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
  -- MSF-363 (decisiones 14 y 15): bandera de apagado y permiso EN LAS TIENDAS (ver private.productos_edicion_en_todas_las_tiendas).
  if not (select private.bandera_activa('precios_masivos')) then
    raise exception 'La actualización masiva de precios está desactivada en este entorno' using errcode = '55000';
  end if;
  if not (select private.productos_edicion_en_todas_las_tiendas()) then
    raise exception 'Para actualizar precios necesitás permiso de edición de productos en todas las tiendas' using errcode = '42501';
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
  'F-PRE-10 + MSF-363: aplica una actualización masiva de lista y costo (todo o nada, idempotente por clave, 40001 por updated_at). Exige bandera precios_masivos encendida y productos en edición en todas las tiendas activas de la organización; costo solo con Rentabilidad.';
