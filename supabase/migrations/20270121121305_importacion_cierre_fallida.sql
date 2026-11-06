-- MSF-375 (F-CAT-10, FR-109/FR-111): vía a `fallida` para las importaciones de productos.
--
-- Hasta ahora solo el cierre feliz del worker llevaba la importación a `terminada`. Si Storage cae y
-- el worker agota sus reintentos (el flow resuelve la orden con `liberar` hasta el tope), o sale con
-- 78 (`agotar`), la importación quedaba en `aplicando` (o `en_cola` con ejecución) y
-- `despachar_importacion_siguiente` la contaba como en curso: toda importación posterior de la
-- organización esperaba para siempre y la pantalla sondeaba sin fin.
--
-- `private.reconciliar_importaciones_fallidas` cierra como `fallida` (con `mensaje_fallo`) toda
-- importación de la organización cuya ejecución ya no puede avanzar: orden de la outbox agotada,
-- ejecución cerrada sin que la importación terminara, o ejecución vencida por tiempo máximo. Cierra
-- también la ejecución (`fallida`/`timeout`) para liberar el candado de «una sola en curso». Es
-- idempotente y la invocan `despachar_importacion_siguiente` (antes de decidir si hay algo en curso)
-- y `obtener_importacion_productos` (el sondeo de la pantalla), así que no depende de un proceso extra.
--
-- Esquemas (Principio VII): solo funciones; escriben `dominio.importaciones_productos` y
-- `public.ejecuciones_worker` (plataforma). Migración aditiva (create or replace de dos funciones
-- existentes + una nueva). Reversión (migración posterior): restaurar los cuerpos de
-- `despachar_importacion_siguiente` y `obtener_importacion_productos` de 20270121121303 y
--   drop function private.reconciliar_importaciones_fallidas(uuid);

create or replace function private.reconciliar_importaciones_fallidas(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_cerradas integer := 0;
  v_procesadas integer;
  v_omitidas integer;
  v_mensaje text;
begin
  for r in
    select i.id, i.ejecucion_id, e.estado as ejec_estado,
           coalesce(d.estado = 'agotada', false) as orden_agotada,
           (e.estado = 'en_curso'
             and e.iniciada_en < clock_timestamp() - make_interval(secs => c.tiempo_max_seg)) as vencida
      from dominio.importaciones_productos i
      join public.ejecuciones_worker e on e.id = i.ejecucion_id
      join public.capacidades_ejecucion c on c.id = e.capacidad_id
      left join public.despachos_ejecucion d on d.ejecucion_id = e.id
     where i.organizacion_id = p_org
       and i.estado in ('en_cola', 'aplicando')
       and i.ejecucion_id is not null
       and (coalesce(d.estado = 'agotada', false)
            or e.estado in ('fallida', 'timeout', 'exitosa')
            or (e.estado = 'en_curso'
                and e.iniciada_en < clock_timestamp() - make_interval(secs => c.tiempo_max_seg)))
     for update of i
  loop
    v_mensaje := case
      when r.vencida then 'La importación tardó más de lo permitido. Reintentala.'
      else 'La importación falló antes de terminar. Reintentala.'
    end;

    select count(*) filter (where f.resultado = 'aplicada'), count(*) filter (where f.resultado = 'omitida')
      into v_procesadas, v_omitidas
      from dominio.importaciones_productos_filas f where f.importacion_id = r.id;

    update dominio.importaciones_productos
       set estado = 'fallida', procesadas = v_procesadas, omitidas = v_omitidas,
           terminada_en = now(), mensaje_fallo = v_mensaje
     where id = r.id;

    -- Libera el candado de una sola ejecución en curso por organización y capacidad.
    if r.ejec_estado = 'en_curso' then
      update public.ejecuciones_worker
         set estado = case when r.vencida then 'timeout' else 'fallida' end,
             finalizada_en = clock_timestamp(),
             motivo_sanitizado = case when r.vencida then 'IMPORTACION_VENCIDA' else 'IMPORTACION_AGOTADA' end
       where id = r.ejecucion_id and estado = 'en_curso';
    end if;
    v_cerradas := v_cerradas + 1;
  end loop;
  return v_cerradas;
end;
$$;

revoke execute on function private.reconciliar_importaciones_fallidas(uuid) from public, anon, authenticated;
grant execute on function private.reconciliar_importaciones_fallidas(uuid) to workers_orquestacion;

-- Igual que en 20270121121303, más la reconciliación previa a la decisión de «hay una en curso».
create or replace function private.despachar_importacion_siguiente(p_org uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_imp dominio.importaciones_productos;
  v_conexion uuid;
  v_ejecucion uuid;
begin
  -- Serializa las altas/cierres de una misma organización.
  perform pg_advisory_xact_lock(hashtextextended('importaciones_productos:' || p_org::text, 0));

  -- Una importación cuya ejecución ya no puede avanzar pasa a `fallida` y deja de bloquear la cola.
  perform private.reconciliar_importaciones_fallidas(p_org);

  if exists (
    select 1 from dominio.importaciones_productos i
     where i.organizacion_id = p_org
       and (i.estado = 'aplicando' or (i.estado = 'en_cola' and i.ejecucion_id is not null))
  ) then
    return null;
  end if;

  select * into v_imp
    from dominio.importaciones_productos i
   where i.organizacion_id = p_org and i.estado = 'en_cola' and i.ejecucion_id is null
   order by i.creada_en, i.id
   limit 1
   for update;
  if not found then
    return null;
  end if;

  select c.id into v_conexion
    from public.conexiones c
   where c.organizacion_id = p_org and c.sistema_externo = 'importar-productos'
   order by c.created_at desc
   limit 1;
  if v_conexion is null then
    return null;
  end if;

  begin
    v_ejecucion := public.iniciar_ejecucion_worker(
      v_conexion, 'importar-productos', 'manual', v_imp.solicitante,
      jsonb_build_object('importacion_id', v_imp.id)
    );
  exception when sqlstate 'P0001' then
    if sqlerrm like 'YA_EN_CURSO%' then
      return null;
    end if;
    raise;
  end;

  update dominio.importaciones_productos set ejecucion_id = v_ejecucion where id = v_imp.id;
  return v_imp.id;
end;
$$;

-- El sondeo de la pantalla: si la importación sigue abierta, reconcilia y despacha (la propia o la
-- siguiente), así una falla se refleja como `fallida` aunque ningún worker llegue a cerrarla.
create or replace function public.obtener_importacion_productos(p_importacion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_imp dominio.importaciones_productos;
begin
  if v_org is null or (select auth.uid()) is null or not (select private.es_administrador_de(v_org)) then
    raise exception 'NO_AUTORIZADO: solo el Administrador importa productos' using errcode = '42501';
  end if;

  select * into v_imp from dominio.importaciones_productos i
   where i.id = p_importacion_id and i.organizacion_id = v_org;
  if not found then
    raise exception 'La importación no existe' using errcode = 'P0002';
  end if;

  if v_imp.estado in ('en_cola', 'aplicando') then
    perform private.despachar_importacion_siguiente(v_org);
    select * into v_imp from dominio.importaciones_productos where id = p_importacion_id;
  end if;

  return jsonb_build_object(
    'estado', v_imp.estado,
    'total_filas', v_imp.total_filas,
    'importables', v_imp.importables,
    'procesadas', (select count(*) from dominio.importaciones_productos_filas f
                    where f.importacion_id = v_imp.id and f.resultado = 'aplicada'),
    'omitidas', (select count(*) from dominio.importaciones_productos_filas f
                  where f.importacion_id = v_imp.id and f.resultado = 'omitida'),
    'ejecucion_id', v_imp.ejecucion_id,
    'mensaje_fallo', v_imp.mensaje_fallo,
    'errores', coalesce((
      select jsonb_agg(jsonb_build_object('fila', f.fila, 'sku', f.sku, 'mensaje', f.resultado_mensaje) order by f.fila)
        from dominio.importaciones_productos_filas f
       where f.importacion_id = v_imp.id and f.resultado = 'omitida'
    ), '[]'::jsonb)
  );
end;
$$;
