-- MSF-375 (F-CAT-10, FR-107, FR-109, FR-111): solicitar y seguir una importación de productos.
--
-- Esquemas (Principio VII): solo funciones. Escriben `dominio.importaciones_productos` y
-- `dominio.importaciones_productos_filas` (dominio, migración 20270121121301) y, por
-- `iniciar_ejecucion_worker`, el ciclo de ejecuciones de la plataforma (`public`).
--
-- Serialización (FR-109): una sola importación por organización tiene ejecución; las demás quedan
-- `en_cola` sin ejecución y `private.despachar_importacion_siguiente` crea la de la más antigua
-- cuando la anterior cierra (la llama el worker al terminar y, si el worker no llegó, la lectura de
-- `obtener_importacion_productos`). No se rechaza la segunda solicitud.
--
-- Migración aditiva (solo funciones). Reversión (migración posterior):
--   drop function public.obtener_importacion_productos(uuid);
--   drop function public.solicitar_importacion_productos(jsonb, uuid);
--   drop function private.despachar_importacion_siguiente(uuid);

-- Crea la ejecución (y su orden en la outbox) de la importación `en_cola` más antigua de la
-- organización, si ninguna otra está aplicándose o ya despachada. Devuelve el id de la importación
-- despachada, o nulo si no había nada para despachar.
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
    -- YA_EN_CURSO: la ejecución anterior todavía no cerró; la importación sigue en cola y la
    -- despachará quien cierre esa ejecución. Cualquier otro motivo se propaga.
    if sqlerrm like 'YA_EN_CURSO%' then
      return null;
    end if;
    raise;
  end;

  update dominio.importaciones_productos set ejecucion_id = v_ejecucion where id = v_imp.id;
  return v_imp.id;
end;
$$;

revoke execute on function private.despachar_importacion_siguiente(uuid) from public, anon, authenticated;
grant execute on function private.despachar_importacion_siguiente(uuid) to workers_orquestacion;

-- ============================================================================
-- public.solicitar_importacion_productos (FR-107)
-- ============================================================================

create or replace function public.solicitar_importacion_productos(p_filas jsonb, p_clave uuid default gen_random_uuid())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_con_costo boolean;
  v_existente dominio.importaciones_productos;
  v_id uuid;
  v_total integer;
  v_importables integer;
  v_omitidas integer;
begin
  if v_org is null or v_actor is null or not (select private.es_administrador_de(v_org)) then
    raise exception 'NO_AUTORIZADO: solo el Administrador importa productos' using errcode = '42501';
  end if;
  if p_clave is null then
    raise exception 'CLAVE_INVALIDA: falta la clave de la importación' using errcode = '22023';
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'FILAS_INVALIDAS: se esperaba una lista de filas' using errcode = '22023';
  end if;
  v_total := jsonb_array_length(p_filas);
  if v_total = 0 or v_total > 2000 then
    raise exception 'FILAS_INVALIDAS: la planilla debe tener entre 1 y 2000 filas' using errcode = '22023';
  end if;

  -- Serializa solicitudes con la misma clave (idempotencia) y las de una misma organización.
  perform pg_advisory_xact_lock(hashtextextended('importaciones_productos:' || v_org::text, 0));

  select * into v_existente from dominio.importaciones_productos i
   where i.organizacion_id = v_org and i.clave = p_clave;
  if found then
    return jsonb_build_object(
      'importacion_id', v_existente.id, 'estado', v_existente.estado,
      'importables', v_existente.importables, 'omitidas', v_existente.total_filas - v_existente.importables
    );
  end if;

  -- Falla acá (sin dejar nada) si la organización no tiene habilitada la importación.
  perform 1 from private.capacidad_importacion_productos();

  v_con_costo := (select private.nivel_seccion('rentabilidad')) = 'edicion';

  insert into dominio.importaciones_productos (organizacion_id, clave, solicitante, con_costo, total_filas, importables, omitidas)
  values (v_org, p_clave, v_actor, v_con_costo, v_total, 0, 0)
  returning id into v_id;

  -- Una sola pasada de validación: las filas con error quedan omitidas desde el inicio.
  insert into dominio.importaciones_productos_filas
    (importacion_id, organizacion_id, fila, sku, accion, validacion, validacion_mensaje, carga, resultado, resultado_mensaje)
  select v_id, v_org, v.fila, v.sku, v.accion, v.estado, v.mensaje, v.carga,
         case when v.estado = 'error' then 'omitida' else 'pendiente' end,
         case when v.estado = 'error' then v.mensaje else '' end
    from private.validar_filas_importacion_productos(v_org, v_con_costo, p_filas, p_clave) v;

  select count(*) filter (where f.validacion <> 'error'), count(*) filter (where f.validacion = 'error')
    into v_importables, v_omitidas
    from dominio.importaciones_productos_filas f
   where f.importacion_id = v_id;
  if v_importables = 0 then
    raise exception 'FILAS_INVALIDAS: ninguna fila se puede importar' using errcode = '22023';
  end if;

  update dominio.importaciones_productos set importables = v_importables, omitidas = v_omitidas where id = v_id;

  perform private.despachar_importacion_siguiente(v_org);

  select * into v_existente from dominio.importaciones_productos where id = v_id;
  return jsonb_build_object(
    'importacion_id', v_id, 'estado', v_existente.estado, 'importables', v_importables, 'omitidas', v_omitidas
  );
end;
$$;

comment on function public.solicitar_importacion_productos(jsonb, uuid) is
  'F-CAT-10 (FR-107/109): persiste la importación y sus filas (revalida todo en el servidor) y encola la orden en la outbox; una segunda importación de la organización queda en_cola hasta que cierre la primera. Idempotente por p_clave. Errores: 42501, 22023 (filas fuera de 1…2000 o ninguna importable), SIN_CONEXION_IMPORTACION.';

revoke execute on function public.solicitar_importacion_productos(jsonb, uuid) from public, anon;
grant execute on function public.solicitar_importacion_productos(jsonb, uuid) to authenticated;

-- ============================================================================
-- public.obtener_importacion_productos (FR-110, FR-111): estado para el sondeo de la pantalla
-- ============================================================================

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

  -- Si el worker no llegó a despachar la siguiente, la lectura lo hace.
  if v_imp.estado = 'en_cola' and v_imp.ejecucion_id is null then
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

comment on function public.obtener_importacion_productos(uuid) is
  'F-CAT-10 (FR-110/111): estado (en_cola, aplicando, terminada, fallida), contadores y filas omitidas con su motivo. Solo Administrador de la organización de la sesión; P0002 si no existe.';

revoke execute on function public.obtener_importacion_productos(uuid) from public, anon;
grant execute on function public.obtener_importacion_productos(uuid) to authenticated;
