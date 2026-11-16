-- MSF-375 (F-CAT-10, FR-108): funciones que usa el worker `importar-productos` con su rol
-- `worker_<org>` (miembro de `workers_orquestacion`). El worker no recibe grants sobre las tablas
-- `dominio.*`: aplica cada fila por `private.aplicar_fila_importacion_productos`, que revalida la
-- ejecución en curso y escribe con las mismas reglas del alta/edición del catálogo.
--
-- Por qué no llama a `crear_producto`/`actualizar_producto`: son `security invoker` y toman la
-- organización y los permisos del JWT de la sesión; un worker no tiene sesión. Las reglas se repiten
-- (nombre/SKU obligatorios, SKU único por organización —lo garantiza además el índice
-- `productos_org_sku_uidx`—, precio de lista > 0 con 2 decimales, código de barras de 13 dígitos único,
-- costo solo si quien importó tenía Rentabilidad al solicitar) y la actividad se registra a nombre
-- de quien solicitó la importación.
--
-- Esquemas (Principio VII): solo funciones en `private`; escriben `dominio.productos`,
-- `producto_costos`, `producto_precios_escala`, `producto_empresa`, `producto_imagenes` e
-- `importaciones_productos*` (todas `dominio`). Ninguna es alcanzable por PostgREST.
--
-- Idempotencia (Principio III): cada fila se aplica una sola vez (`resultado` pasa de `pendiente`
-- a `aplicada`/`omitida` en la misma transacción que sus efectos); reaplicarla devuelve el resultado
-- guardado. Una imagen ya registrada (misma ruta) no se duplica.
--
-- Migración aditiva (solo funciones). Reversión (migración posterior):
--   drop function private.cerrar_importacion_productos(uuid, text, text);
--   drop function private.registrar_imagen_importacion_productos(uuid, uuid, text, text);
--   drop function private.aplicar_fila_importacion_productos(uuid, uuid);
--   drop function private.filas_pendientes_importacion_productos(uuid, integer);
--   drop function private.iniciar_importacion_productos(uuid);
--   drop function private.autorizar_worker_importacion_productos(uuid);

-- Autoriza al worker sobre su ejecución en curso y devuelve la importación asociada.
create or replace function private.autorizar_worker_importacion_productos(p_ejecucion_id uuid)
returns dominio.importaciones_productos
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_e public.ejecuciones_worker;
  v_vigente boolean;
  v_imp dominio.importaciones_productos;
begin
  -- El dueño de la función (postgres) también puede: en el CI no es superusuario y pgTAP no puede
  -- simular el login del worker con `set session authorization` (ver historial_importacion.test.sql).
  if session_user <> current_user
     and (session_user not like 'worker\_%'
          or not pg_catalog.pg_has_role(session_user, 'workers_orquestacion', 'member')) then
    raise exception 'NO_AUTORIZADO: solo un worker accede a los datos de su importación' using errcode = 'P0001';
  end if;

  select * into v_e from public.ejecuciones_worker e where e.id = p_ejecucion_id;
  if not found then
    raise exception 'EJECUCION_DESCONOCIDA: %', p_ejecucion_id using errcode = 'P0001';
  end if;
  perform private.autorizar_llamante_ciclo(v_e.organizacion_id);

  select ev.en_curso into v_vigente from private.estado_ejecucion_vigente(p_ejecucion_id) ev;
  if not coalesce(v_vigente, false) then
    raise exception 'EJECUCION_NO_EN_CURSO: %', p_ejecucion_id using errcode = 'P0001';
  end if;

  select * into v_imp from dominio.importaciones_productos i
   where i.ejecucion_id = p_ejecucion_id and i.organizacion_id = v_e.organizacion_id;
  if not found then
    raise exception 'CONFIGURACION_INVALIDA: la ejecución % no tiene una importación de productos', p_ejecucion_id
      using errcode = 'P0001';
  end if;
  return v_imp;
end;
$$;

revoke execute on function private.autorizar_worker_importacion_productos(uuid) from public, anon, authenticated;

-- Marca la importación como `aplicando` (idempotente en un reintento) y devuelve lo que necesita el worker.
create or replace function private.iniciar_importacion_productos(p_ejecucion_id uuid)
returns table (importacion_id uuid, organizacion_id uuid, clave uuid, pendientes integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_imp dominio.importaciones_productos;
begin
  v_imp := private.autorizar_worker_importacion_productos(p_ejecucion_id);
  update dominio.importaciones_productos i
     set estado = 'aplicando', iniciada_en = coalesce(i.iniciada_en, now())
   where i.id = v_imp.id and i.estado in ('en_cola', 'aplicando');

  return query
    select v_imp.id, v_imp.organizacion_id, v_imp.clave,
           (select count(*)::integer from dominio.importaciones_productos_filas f
             where f.importacion_id = v_imp.id and f.resultado = 'pendiente');
end;
$$;

revoke execute on function private.iniciar_importacion_productos(uuid) from public, anon, authenticated;
grant execute on function private.iniciar_importacion_productos(uuid) to workers_orquestacion;

-- Filas que faltan aplicar, en orden de fila.
create or replace function private.filas_pendientes_importacion_productos(p_ejecucion_id uuid, p_limite integer default 200)
returns table (fila_id uuid, fila integer, sku text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_imp dominio.importaciones_productos;
begin
  v_imp := private.autorizar_worker_importacion_productos(p_ejecucion_id);
  if p_limite is null or p_limite < 1 or p_limite > 1000 then
    raise exception 'LIMITE_INVALIDO: el límite debe estar entre 1 y 1000' using errcode = 'P0001';
  end if;
  return query
    select f.id, f.fila, f.sku
      from dominio.importaciones_productos_filas f
     where f.importacion_id = v_imp.id and f.resultado = 'pendiente'
     order by f.fila
     limit p_limite;
end;
$$;

revoke execute on function private.filas_pendientes_importacion_productos(uuid, integer) from public, anon, authenticated;
grant execute on function private.filas_pendientes_importacion_productos(uuid, integer) to workers_orquestacion;

-- Aplica una fila: alta o actualización según el SKU exista o no en el momento de aplicar.
-- Devuelve { resultado: 'aplicada'|'omitida', producto_id, mensaje, imagenes: [nombres de archivo] }.
create or replace function private.aplicar_fila_importacion_productos(p_ejecucion_id uuid, p_fila_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_imp dominio.importaciones_productos;
  v_f dominio.importaciones_productos_filas;
  c record;
  v_producto dominio.productos;
  v_categoria uuid;
  v_proveedor uuid;
  v_tiendas jsonb;
  v_ids uuid[];
  v_imagenes jsonb;
  v_nuevo boolean;
  v_precio numeric;
  v_escala record;
  v_mensaje text;
begin
  v_imp := private.autorizar_worker_importacion_productos(p_ejecucion_id);

  select * into v_f from dominio.importaciones_productos_filas f
   where f.id = p_fila_id and f.importacion_id = v_imp.id
   for update;
  if not found then
    raise exception 'FILA_DESCONOCIDA: %', p_fila_id using errcode = 'P0001';
  end if;
  if v_f.resultado <> 'pendiente' then
    return jsonb_build_object(
      'resultado', v_f.resultado, 'producto_id', v_f.producto_id, 'mensaje', v_f.resultado_mensaje,
      'imagenes', case when v_f.resultado = 'aplicada' then private.imagenes_de_carga_importacion(v_f.carga) else '[]'::jsonb end
    );
  end if;

  select * into c from jsonb_to_record(v_f.carga) as x(
    sku text, nombre text, categoria text, costo text, precio_x1 text, precio_x5 text, precio_x10 text,
    precio_x50 text, proveedor text, codigo_barras text, tiendas text, imagenes text);

  begin
    v_categoria := private.resolver_categoria_importacion(v_imp.organizacion_id, c.categoria);
    if v_categoria is null then
      raise exception 'La categoría «%» ya no existe', left(btrim(coalesce(c.categoria, '')), 100) using errcode = 'P0001';
    end if;

    select * into v_producto from dominio.productos p
     where p.organizacion_id = v_imp.organizacion_id and lower(btrim(p.sku)) = lower(btrim(c.sku))
     for update;
    v_nuevo := not found;

    v_proveedor := case when btrim(coalesce(c.proveedor, '')) <> ''
                        then private.resolver_proveedor_importacion(v_imp.organizacion_id, c.proveedor) end;

    if v_nuevo then
      if btrim(coalesce(c.precio_x1, '')) = '' then
        raise exception 'Falta el precio x1 de un producto nuevo' using errcode = 'P0001';
      end if;
      insert into dominio.productos (organizacion_id, nombre, sku, precio_lista, categoria_id, proveedor_id, codigo_barras)
      values (v_imp.organizacion_id, btrim(c.nombre), btrim(c.sku), btrim(c.precio_x1)::numeric,
              v_categoria, v_proveedor, nullif(btrim(coalesce(c.codigo_barras, '')), ''))
      returning * into v_producto;
    else
      -- Una celda vacía no pisa el valor actual (Decisión 7).
      update dominio.productos p
         set nombre = btrim(c.nombre),
             categoria_id = v_categoria,
             precio_lista = case when btrim(coalesce(c.precio_x1, '')) <> '' then btrim(c.precio_x1)::numeric else p.precio_lista end,
             proveedor_id = coalesce(v_proveedor, p.proveedor_id),
             codigo_barras = coalesce(nullif(btrim(coalesce(c.codigo_barras, '')), ''), p.codigo_barras)
       where p.id = v_producto.id
      returning * into v_producto;
    end if;

    -- Costo: solo si quien importó tenía Rentabilidad al solicitar (FR-106).
    if v_imp.con_costo and btrim(coalesce(c.costo, '')) <> '' then
      insert into dominio.producto_costos as pc (producto_id, organizacion_id, costo)
      values (v_producto.id, v_imp.organizacion_id, btrim(c.costo)::numeric)
      on conflict (producto_id) do update set costo = excluded.costo
        where pc.costo is distinct from excluded.costo;
    end if;

    -- Escalas x5, x10 y x50 (x1 es el precio de lista).
    for v_escala in
      select * from (values ('x5', c.precio_x5), ('x10', c.precio_x10), ('x50', c.precio_x50)) as e(escala, precio)
       where btrim(coalesce(e.precio, '')) <> ''
    loop
      v_precio := btrim(v_escala.precio)::numeric;
      insert into dominio.producto_precios_escala as pe (producto_id, organizacion_id, escala, precio)
      values (v_producto.id, v_imp.organizacion_id, v_escala.escala, v_precio)
      on conflict (producto_id, escala) do update set precio = excluded.precio
        where pe.precio is distinct from excluded.precio;
    end loop;

    -- Tiendas: con valor, el producto queda publicado en esas tiendas; vacía = no se toca.
    v_tiendas := private.resolver_tiendas_importacion(v_imp.organizacion_id, c.tiendas);
    select coalesce(array_agg(x::uuid), '{}') into v_ids from jsonb_array_elements_text(v_tiendas -> 'ids') as x;
    if cardinality(v_ids) > 0 then
      delete from dominio.producto_empresa pe
       where pe.producto_id = v_producto.id and not (pe.empresa_id = any (v_ids));
      insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
      select v_producto.id, e, v_imp.organizacion_id from unnest(v_ids) as e
      on conflict (producto_id, empresa_id) do nothing;
    end if;

    perform private.insertar_actividad(
      v_imp.organizacion_id, v_imp.solicitante,
      case when v_nuevo then 'producto.creado' else 'producto.editado' end,
      format('%s el producto %s (SKU %s) desde una importación CSV',
             case when v_nuevo then 'Creó' else 'Actualizó' end, v_producto.nombre, v_producto.sku),
      null
    );

    v_imagenes := private.imagenes_de_carga_importacion(v_f.carga);

    update dominio.importaciones_productos_filas
       set resultado = 'aplicada', producto_id = v_producto.id, aplicada_en = now(),
           resultado_mensaje = case when v_nuevo then 'Producto creado' else 'Producto actualizado' end
     where id = v_f.id;

    return jsonb_build_object(
      'resultado', 'aplicada', 'producto_id', v_producto.id,
      'mensaje', case when v_nuevo then 'Producto creado' else 'Producto actualizado' end,
      'imagenes', v_imagenes
    );
  exception when others then
    -- La fila se omite con un motivo legible; sus efectos parciales se deshacen con el subbloque.
    v_mensaje := case
      when sqlstate = '23505' then 'El SKU o el código de barras ya lo usa otro producto'
      when sqlstate = 'P0001' then left(sqlerrm, 300)
      else 'No se pudo aplicar la fila (' || sqlstate || ')'
    end;
  end;

  update dominio.importaciones_productos_filas
     set resultado = 'omitida', resultado_mensaje = v_mensaje, aplicada_en = now()
   where id = v_f.id;
  return jsonb_build_object('resultado', 'omitida', 'producto_id', null, 'mensaje', v_mensaje, 'imagenes', '[]'::jsonb);
end;
$$;

revoke execute on function private.aplicar_fila_importacion_productos(uuid, uuid) from public, anon, authenticated;
grant execute on function private.aplicar_fila_importacion_productos(uuid, uuid) to workers_orquestacion;

-- Nombres de archivo citados en la columna `imagenes` (hasta 4, en orden; la primera es la principal).
create or replace function private.imagenes_de_carga_importacion(p_carga jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(n order by o), '[]'::jsonb)
    from (
      select btrim(t) as n, o
        from unnest(string_to_array(coalesce(p_carga ->> 'imagenes', ''), '|')) with ordinality as u(t, o)
       where btrim(t) ~* '^[^/\\]+\.(jpe?g|png|webp)$'
       order by o
       limit 4
    ) s;
$$;

revoke execute on function private.imagenes_de_carga_importacion(jsonb) from public, anon, authenticated;

-- Registra una imagen ya copiada al bucket `productos-imagenes` en la primera posición libre (1…4).
-- Idempotente: la misma ruta no se duplica. Devuelve 'registrada', 'existente' o 'tope' (ya hay 4).
create or replace function private.registrar_imagen_importacion_productos(
  p_ejecucion_id uuid, p_fila_id uuid, p_nombre text, p_ruta text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_imp dominio.importaciones_productos;
  v_f dominio.importaciones_productos_filas;
  v_posicion smallint;
begin
  v_imp := private.autorizar_worker_importacion_productos(p_ejecucion_id);
  select * into v_f from dominio.importaciones_productos_filas f
   where f.id = p_fila_id and f.importacion_id = v_imp.id and f.resultado = 'aplicada' and f.producto_id is not null;
  if not found then
    raise exception 'FILA_DESCONOCIDA: %', p_fila_id using errcode = 'P0001';
  end if;
  if p_ruta is null
     or left(p_ruta, length(v_imp.organizacion_id::text) + length(v_f.producto_id::text) + 2)
        <> v_imp.organizacion_id::text || '/' || v_f.producto_id::text || '/'
     or p_ruta !~* '\.(jpe?g|png|webp)$' or length(p_ruta) > 300 then
    raise exception 'RUTA_INVALIDA: la ruta no pertenece al producto' using errcode = 'P0001';
  end if;

  if exists (select 1 from dominio.producto_imagenes i where i.ruta = p_ruta) then
    return 'existente';
  end if;

  -- Serializa con el tope de 4 (mismo candado que el disparador limitar_imagenes_producto).
  perform pg_advisory_xact_lock(hashtextextended('producto_imagenes:' || v_f.producto_id::text, 0));
  select min(p) into v_posicion
    from generate_series(1, 4) as p
   where not exists (select 1 from dominio.producto_imagenes i where i.producto_id = v_f.producto_id and i.posicion = p);
  if v_posicion is null then
    return 'tope';
  end if;

  insert into dominio.producto_imagenes (producto_id, organizacion_id, posicion, ruta)
  values (v_f.producto_id, v_imp.organizacion_id, v_posicion, p_ruta);
  return 'registrada';
end;
$$;

revoke execute on function private.registrar_imagen_importacion_productos(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function private.registrar_imagen_importacion_productos(uuid, uuid, text, text) to workers_orquestacion;

-- Cierra la importación: las filas que no se aplicaron quedan omitidas y se fijan los contadores.
create or replace function private.cerrar_importacion_productos(p_ejecucion_id uuid, p_estado text, p_mensaje text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_imp dominio.importaciones_productos;
  v_procesadas integer;
  v_omitidas integer;
begin
  if p_estado not in ('terminada', 'fallida') then
    raise exception 'ESTADO_INVALIDO: debe ser terminada o fallida' using errcode = 'P0001';
  end if;
  v_imp := private.autorizar_worker_importacion_productos(p_ejecucion_id);

  if p_estado = 'terminada' then
    update dominio.importaciones_productos_filas f
       set resultado = 'omitida', resultado_mensaje = 'La fila no se procesó', aplicada_en = now()
     where f.importacion_id = v_imp.id and f.resultado = 'pendiente';
  end if;

  select count(*) filter (where f.resultado = 'aplicada'), count(*) filter (where f.resultado = 'omitida')
    into v_procesadas, v_omitidas
    from dominio.importaciones_productos_filas f
   where f.importacion_id = v_imp.id;

  update dominio.importaciones_productos i
     set estado = p_estado, procesadas = v_procesadas, omitidas = v_omitidas, terminada_en = now(),
         mensaje_fallo = case when p_estado = 'fallida' then left(p_mensaje, 500) end
   where i.id = v_imp.id;

  return jsonb_build_object('procesadas', v_procesadas, 'omitidas', v_omitidas, 'organizacion_id', v_imp.organizacion_id);
end;
$$;

revoke execute on function private.cerrar_importacion_productos(uuid, text, text) from public, anon, authenticated;
grant execute on function private.cerrar_importacion_productos(uuid, text, text) to workers_orquestacion;
