-- MSF-202 (revisión independiente, hallazgos 1, 2, 3, 4, 7 y 10): robustez de la importación de productos.
--
-- Qué corrige respecto de 20270206100002/3/4 (inmutables; acá se redefinen con CREATE OR REPLACE):
--   1. Imágenes perdidas en silencio: `aplicar_fila_importacion_productos` marcaba la fila `aplicada` y recién después
--      el worker bajaba/subía las imágenes; si Storage fallaba, el reintento no volvía a ver esa fila (solo se ofrecían
--      las `pendiente`) y la importación cerraba sin sus imágenes. Ahora la fila `aplicada` con imágenes queda con
--      `imagenes_pendientes = true` hasta que el worker confirma (`confirmar_imagenes_fila_importacion_productos`);
--      `filas_pendientes_importacion_productos` e `iniciar_importacion_productos` incluyen esas filas. Adjuntar es
--      idempotente (ruta final determinista, `registrar_imagen_...` devuelve `existente`), así que reintentar no duplica.
--   2. `aplicar_fila_...` ya no convierte en `omitida` definitiva un error transitorio (clases SQLSTATE 40, 53, 55 y
--      57: deadlock, lock no disponible, recursos, cancelación): se propaga y el flow reintenta.
--   3. `validar_filas_importacion_productos`: tope de 1000 caracteres por celda en categoria, proveedor, tiendas e
--      imagenes (error de la fila con mensaje claro) y `carga` guarda solo las columnas conocidas, cada una acotada
--      (antes guardaba `r.original` entero). El mensaje de validación se acota a 1000 (límite de la columna).
--   4. `imagenes_temporales_a_borrar`: nombres del bucket temporal que el worker borra al cerrar (las de la
--      importación) y huérfanas de más de N días (subidas que nunca llegaron a solicitarse, o de una importación
--      fallida). Storage no se borra por SQL en self-hosted: lo hace el worker por la API de Storage.
--   7. `importacion_productos_habilitada`: la pantalla comprueba la conexión `importar-productos` al abrirse y avisa
--      ANTES de pedir el CSV. No se aprovisiona sola: igual que el historial de ventas (MSF-293) la conexión la crea
--      un Administrador con `crear_conexion` y exige servidor y credencial (decisión de negocio/operación).
--  10. `solicitar_importacion_productos` devuelve `reutilizada` (true si la clave ya tenía importación): la UI avisa
--      que las filas enviadas ahora no se tomaron.
--
-- Esquemas (Principio VII), verificados objeto por objeto:
--   dominio.importaciones_productos_filas  dominio (alterada)  columna nueva `imagenes_pendientes`; dato del producto.
--   funciones nuevas en `private` (worker) y `public` (app, solo lectura): no crean tablas.
--
-- Migración aditiva (una columna con default + funciones). Reversión (migración posterior):
--   drop function public.importacion_productos_habilitada();
--   drop function private.imagenes_temporales_a_borrar(uuid, integer, boolean);
--   drop function private.confirmar_imagenes_fila_importacion_productos(uuid, uuid);
--   restaurar los cuerpos de validar_filas_importacion_productos (20270206100002), aplicar_fila_..., iniciar_... y
--   filas_pendientes_... (20270206100004) y solicitar_importacion_productos (20270206100003);
--   drop index dominio.importaciones_productos_filas_imagenes_idx;
--   drop function private.registrar_fallo_fila_importacion_productos(uuid, uuid);
--   restaurar cerrar_importacion_productos (20270206100004) y obtener_importacion_productos (20270206100005);
--   alter table dominio.importaciones_productos_filas drop column imagenes_pendientes, drop column intentos, drop column motivo_codigo;  -- antes, exportar los datos.

alter table dominio.importaciones_productos_filas
  add column if not exists imagenes_pendientes boolean not null default false;

-- Intentos fallidos por error transitorio (hallazgo de la revisión de #794): una fila que SIEMPRE falla con 40/53/55/57
-- no debe frenar a las demás en cada reintento. El worker la registra (`registrar_fallo_fila_...`) y al tercer intento
-- la fila queda `omitida` con un motivo claro.
alter table dominio.importaciones_productos_filas
  add column if not exists intentos smallint not null default 0;

-- Código estable del motivo de una omisión que no es por los datos de la fila (el texto de `resultado_mensaje` es solo
-- para mostrar): hoy solo ERROR_TEMPORAL (intentos agotados por errores transitorios). Lo escribe
-- `registrar_fallo_fila_…` y lo lee `obtener_importacion_productos`.
alter table dominio.importaciones_productos_filas
  add column if not exists motivo_codigo text check (motivo_codigo in ('ERROR_TEMPORAL'));

comment on column dominio.importaciones_productos_filas.imagenes_pendientes is
  'Fila aplicada cuyas imágenes todavía no se adjuntaron: el worker la vuelve a ver hasta confirmarlas (no se pierden si Storage falla).';

create index if not exists importaciones_productos_filas_imagenes_idx
  on dominio.importaciones_productos_filas (importacion_id, fila) where imagenes_pendientes;

create or replace function private.validar_filas_importacion_productos(
  p_org uuid,
  p_con_costo boolean,
  p_filas jsonb,
  p_clave uuid default null
)
returns table (fila integer, sku text, accion text, estado text, mensaje text, carga jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  v_fila integer;
  v_sku text;
  v_errores text[];
  v_avisos text[];
  v_accion text;
  v_existente uuid;
  v_vistos jsonb := '{}'::jsonb;
  v_barras_vistos jsonb := '{}'::jsonb;
  v_barras text;
  v_campo text;
  v_valor text;
  v_tiendas jsonb;
  v_nombre_imagen text;
  v_cantidad_imagenes integer;
  v_subidas text[];
  v_numero constant text := '^[0-9]{1,12}(\.[0-9]{1,2})?$';
  v_tope_celda constant integer := 1000;
  v_sin_tiendas constant jsonb := '{"ids": [], "desconocidas": []}'::jsonb;
begin
  if p_clave is not null then
    select coalesce(array_agg(o.name), '{}') into v_subidas
      from storage.objects o
     where o.bucket_id = 'productos-importaciones'
       and o.name like p_org::text || '/' || p_clave::text || '/%';
  else
    v_subidas := null;
  end if;

  for r in
    select x.*, e.ord, e.v as original
      from jsonb_array_elements(p_filas) with ordinality as e(v, ord),
           lateral jsonb_to_record(e.v) as x(
             fila text, sku text, nombre text, categoria text, costo text,
             precio_x1 text, precio_x5 text, precio_x10 text, precio_x50 text,
             proveedor text, codigo_barras text, tiendas text, imagenes text)
     order by e.ord
  loop
    v_errores := '{}';
    v_avisos := '{}';
    v_fila := case when r.fila ~ '^[0-9]{1,9}$' then greatest(r.fila::integer, 2) else (r.ord + 1)::integer end;
    v_sku := btrim(coalesce(r.sku, ''));

    -- Obligatorias.
    if v_sku = '' then v_errores := v_errores || 'Falta el SKU'::text; end if;
    if btrim(coalesce(r.nombre, '')) = '' then v_errores := v_errores || 'Falta el nombre'::text; end if;
    if btrim(coalesce(r.categoria, '')) = '' then v_errores := v_errores || 'Falta la categoría'::text; end if;
    if length(v_sku) > 80 then v_errores := v_errores || 'El SKU supera los 80 caracteres'::text; end if;
    if length(btrim(coalesce(r.nombre, ''))) > 200 then v_errores := v_errores || 'El nombre supera los 200 caracteres'::text; end if;

    -- Tope por celda (1000 caracteres) en las columnas de texto libre: una celda desmedida es un error de la fila y
    -- no se resuelve contra el catálogo ni se guarda entera.
    if length(coalesce(r.categoria, '')) > v_tope_celda then v_errores := v_errores || 'La columna «categoria» supera los 1000 caracteres'::text; end if;
    if length(coalesce(r.proveedor, '')) > v_tope_celda then v_errores := v_errores || 'La columna «proveedor» supera los 1000 caracteres'::text; end if;
    if length(coalesce(r.tiendas, '')) > v_tope_celda then v_errores := v_errores || 'La columna «tiendas» supera los 1000 caracteres'::text; end if;
    if length(coalesce(r.imagenes, '')) > v_tope_celda then v_errores := v_errores || 'La columna «imagenes» supera los 1000 caracteres'::text; end if;

    -- Categoría existente.
    if btrim(coalesce(r.categoria, '')) <> '' and length(r.categoria) <= v_tope_celda
       and private.resolver_categoria_importacion(p_org, r.categoria) is null then
      v_errores := v_errores || format('La categoría «%s» no existe', left(btrim(r.categoria), 100));
    end if;

    -- ¿El SKU ya existe en la organización?
    v_existente := null;
    if v_sku <> '' then
      select p.id into v_existente
        from dominio.productos p
       where p.organizacion_id = p_org and lower(btrim(p.sku)) = lower(v_sku);
    end if;
    v_accion := case when v_existente is null then 'nuevo' else 'actualiza' end;

    -- SKU repetido en la planilla.
    if v_sku <> '' then
      if v_vistos ? lower(v_sku) then
        v_errores := v_errores || format('SKU repetido en la planilla (ya está en la fila %s)', v_vistos ->> lower(v_sku));
      else
        v_vistos := v_vistos || jsonb_build_object(lower(v_sku), v_fila);
      end if;
    end if;

    -- Importes: no negativos, hasta 2 decimales.
    for v_campo, v_valor in
      select * from (values ('costo', r.costo), ('precio_x1', r.precio_x1), ('precio_x5', r.precio_x5),
                            ('precio_x10', r.precio_x10), ('precio_x50', r.precio_x50)) as c(k, v)
    loop
      if btrim(coalesce(v_valor, '')) <> '' and btrim(v_valor) !~ v_numero then
        v_errores := v_errores || format('«%s» debe ser un número no negativo con hasta 2 decimales', v_campo);
      end if;
    end loop;
    if (case when btrim(coalesce(r.precio_x1, '')) ~ v_numero then btrim(r.precio_x1)::numeric = 0 else false end) then
      v_errores := v_errores || '«precio_x1» debe ser mayor a cero'::text;
    end if;
    if v_accion = 'nuevo' and btrim(coalesce(r.precio_x1, '')) = '' then
      v_errores := v_errores || 'Falta el precio x1 de un producto nuevo'::text;
    end if;

    -- Costo sin acceso a Rentabilidad: se ignora con aviso (FR-106).
    if btrim(coalesce(r.costo, '')) <> '' and not p_con_costo then
      v_avisos := v_avisos || 'Se ignora el costo: tu rol no tiene acceso a Rentabilidad'::text;
    end if;

    -- Código de barras.
    v_barras := btrim(coalesce(r.codigo_barras, ''));
    if v_barras <> '' then
      if v_barras !~ '^[0-9]{13}$' then
        v_errores := v_errores || 'El código de barras debe tener 13 dígitos'::text;
      else
        if v_barras_vistos ? v_barras then
          v_errores := v_errores || format('Código de barras repetido en la planilla (fila %s)', v_barras_vistos ->> v_barras);
        else
          v_barras_vistos := v_barras_vistos || jsonb_build_object(v_barras, v_fila);
        end if;
        if exists (
          select 1 from dominio.productos p
           where p.organizacion_id = p_org and p.codigo_barras = v_barras
             and p.id is distinct from v_existente
        ) then
          v_errores := v_errores || 'El código de barras ya lo usa otro producto'::text;
        end if;
      end if;
    end if;

    -- Proveedor y tiendas: desconocidos se ignoran con aviso.
    if btrim(coalesce(r.proveedor, '')) <> '' and length(r.proveedor) <= v_tope_celda
       and private.resolver_proveedor_importacion(p_org, r.proveedor) is null then
      v_avisos := v_avisos || format('Se ignora el proveedor «%s»: no existe', left(btrim(r.proveedor), 100));
    end if;
    v_tiendas := case when length(coalesce(r.tiendas, '')) > v_tope_celda then v_sin_tiendas
                      else private.resolver_tiendas_importacion(p_org, r.tiendas) end;
    if jsonb_array_length(v_tiendas -> 'desconocidas') > 0 then
      v_avisos := v_avisos || format('Tienda desconocida: %s', (select string_agg(t, ', ') from jsonb_array_elements_text(v_tiendas -> 'desconocidas') as t));
    end if;

    -- Imágenes citadas (la primera es la principal; hasta 4).
    v_cantidad_imagenes := 0;
    for v_nombre_imagen in
      select btrim(t) from unnest(string_to_array(case when length(coalesce(r.imagenes, '')) > v_tope_celda then '' else coalesce(r.imagenes, '') end, '|')) as t where btrim(t) <> ''
    loop
      v_cantidad_imagenes := v_cantidad_imagenes + 1;
      if v_cantidad_imagenes > 4 then
        continue;
      end if;
      if v_nombre_imagen !~* '^[^/\\]+\.(jpe?g|png|webp)$' then
        v_avisos := v_avisos || format('Imagen «%s» inválida (JPG, PNG o WebP)', left(v_nombre_imagen, 100));
      elsif v_subidas is not null and not ((p_org::text || '/' || p_clave::text || '/' || v_nombre_imagen) = any (v_subidas)) then
        v_avisos := v_avisos || format('Imagen «%s» no se subió', left(v_nombre_imagen, 100));
      end if;
    end loop;
    if v_cantidad_imagenes > 4 then
      v_avisos := v_avisos || 'Más de 4 imágenes: se usan las primeras 4'::text;
    end if;

    fila := v_fila;
    sku := v_sku;
    accion := v_accion;
    estado := case when cardinality(v_errores) > 0 then 'error' when cardinality(v_avisos) > 0 then 'aviso' else 'ok' end;
    -- La tabla de filas limita el mensaje a 1000 caracteres.
    mensaje := left(array_to_string(case when cardinality(v_errores) > 0 then v_errores else v_avisos end, '; '), 1000);
    -- Solo las columnas conocidas, cada una acotada: una celda desmedida no se persiste entera (la fila ya es un error).
    carga := jsonb_build_object(
      'fila', left(coalesce(r.fila, ''), 20), 'sku', left(coalesce(r.sku, ''), v_tope_celda),
      'nombre', left(coalesce(r.nombre, ''), v_tope_celda), 'categoria', left(coalesce(r.categoria, ''), v_tope_celda),
      'costo', left(coalesce(r.costo, ''), v_tope_celda), 'precio_x1', left(coalesce(r.precio_x1, ''), v_tope_celda),
      'precio_x5', left(coalesce(r.precio_x5, ''), v_tope_celda), 'precio_x10', left(coalesce(r.precio_x10, ''), v_tope_celda),
      'precio_x50', left(coalesce(r.precio_x50, ''), v_tope_celda), 'proveedor', left(coalesce(r.proveedor, ''), v_tope_celda),
      'codigo_barras', left(coalesce(r.codigo_barras, ''), v_tope_celda), 'tiendas', left(coalesce(r.tiendas, ''), v_tope_celda),
      'imagenes', left(coalesce(r.imagenes, ''), v_tope_celda));
    return next;
  end loop;
end;
$$;

revoke execute on function private.validar_filas_importacion_productos(uuid, boolean, jsonb, uuid) from public, anon, authenticated;

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
             where f.importacion_id = v_imp.id
                and (f.resultado = 'pendiente' or (f.resultado = 'aplicada' and f.imagenes_pendientes)));
end;
$$;

revoke execute on function private.iniciar_importacion_productos(uuid) from public, anon, authenticated;
grant execute on function private.iniciar_importacion_productos(uuid) to workers_orquestacion;

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
     where f.importacion_id = v_imp.id
       and (f.resultado = 'pendiente' or (f.resultado = 'aplicada' and f.imagenes_pendientes))
     order by f.fila
     limit p_limite;
end;
$$;

revoke execute on function private.filas_pendientes_importacion_productos(uuid, integer) from public, anon, authenticated;
grant execute on function private.filas_pendientes_importacion_productos(uuid, integer) to workers_orquestacion;

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
           imagenes_pendientes = jsonb_array_length(v_imagenes) > 0,
           resultado_mensaje = case when v_nuevo then 'Producto creado' else 'Producto actualizado' end
     where id = v_f.id;

    return jsonb_build_object(
      'resultado', 'aplicada', 'producto_id', v_producto.id,
      'mensaje', case when v_nuevo then 'Producto creado' else 'Producto actualizado' end,
      'imagenes', v_imagenes
    );
  exception when others then
    -- Errores transitorios o del servidor (40 rollback/deadlock, 53 recursos, 55 estado del objeto/lock, 57 cancelación)
    -- NO son un problema de los datos de la fila: se propagan para que el flow reintente en vez de dejarla omitida
    -- para siempre. Los errores de datos (23xxx, 22xxx, P0001 propios) siguen omitiendo la fila con su motivo.
    if left(sqlstate, 2) in ('40', '53', '55', '57') then
      raise;
    end if;
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

-- El worker confirma que adjuntó (o descartó con motivo) las imágenes de la fila. Idempotente.
create or replace function private.confirmar_imagenes_fila_importacion_productos(p_ejecucion_id uuid, p_fila_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_imp dominio.importaciones_productos;
begin
  v_imp := private.autorizar_worker_importacion_productos(p_ejecucion_id);
  update dominio.importaciones_productos_filas f
     set imagenes_pendientes = false
   where f.id = p_fila_id and f.importacion_id = v_imp.id;
  if not found then
    raise exception 'FILA_DESCONOCIDA: %', p_fila_id using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function private.confirmar_imagenes_fila_importacion_productos(uuid, uuid) from public, anon, authenticated;
grant execute on function private.confirmar_imagenes_fila_importacion_productos(uuid, uuid) to workers_orquestacion;

-- Objetos del bucket temporal que el worker debe borrar: todos los de la importación de la ejecución (se llama ya
-- cerrada la importación) y los huérfanos de la organización con más de `p_dias` días que no pertenecen a una
-- importación en curso. Con `p_incluir_importacion = false` (al empezar una corrida) solo devuelve huérfanos: las imágenes
-- de la propia importación todavía se necesitan. Hasta 1000 por llamada; el worker repite en una tanda acotada.
create or replace function private.imagenes_temporales_a_borrar(
  p_ejecucion_id uuid, p_dias integer default 7, p_incluir_importacion boolean default true)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_imp dominio.importaciones_productos;
begin
  v_imp := private.autorizar_worker_importacion_productos(p_ejecucion_id);
  if p_dias is null or p_dias < 1 or p_dias > 365 then
    raise exception 'DIAS_INVALIDOS: los días deben estar entre 1 y 365' using errcode = 'P0001';
  end if;
  return query
    select o.name
      from storage.objects o
     where o.bucket_id = 'productos-importaciones'
       and (
         (p_incluir_importacion and o.name like v_imp.organizacion_id::text || '/' || v_imp.clave::text || '/%')
         or (
           o.name like v_imp.organizacion_id::text || '/%'
           and o.created_at < now() - make_interval(days => p_dias)
           and not exists (
             select 1 from dominio.importaciones_productos i
              where i.organizacion_id = v_imp.organizacion_id and i.estado in ('en_cola', 'aplicando')
                and o.name like v_imp.organizacion_id::text || '/' || i.clave::text || '/%')
         )
       )
     order by o.name
     limit 1000;
end;
$$;

revoke execute on function private.imagenes_temporales_a_borrar(uuid, integer, boolean) from public, anon, authenticated;
grant execute on function private.imagenes_temporales_a_borrar(uuid, integer, boolean) to workers_orquestacion;

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
      'importables', v_existente.importables, 'omitidas', v_existente.total_filas - v_existente.importables,
      -- Misma clave: no se crea otra importación ni se toman estas filas; se devuelve la ya solicitada y se avisa.
      'reutilizada', true
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
    'importacion_id', v_id, 'estado', v_existente.estado, 'importables', v_importables, 'omitidas', v_omitidas,
    'reutilizada', false
  );
end;
$$;

revoke execute on function public.solicitar_importacion_productos(jsonb, uuid) from public, anon;
grant execute on function public.solicitar_importacion_productos(jsonb, uuid) to authenticated;

-- ============================================================================
-- public.importacion_productos_habilitada (hallazgo 7): ¿la organización tiene la conexión `importar-productos`?
-- Solo lectura; solo el Administrador. La pantalla la consulta al abrirse.
-- ============================================================================

create or replace function public.importacion_productos_habilitada()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null or (select auth.uid()) is null or not (select private.es_administrador_de(v_org)) then
    raise exception 'NO_AUTORIZADO: solo el Administrador importa productos' using errcode = '42501';
  end if;
  return exists (
    select 1 from public.conexiones c
     where c.organizacion_id = v_org and c.sistema_externo = 'importar-productos');
end;
$$;

comment on function public.importacion_productos_habilitada() is
  'F-CAT-10: true si la organización de la sesión tiene la conexión importar-productos (sin ella solicitar_importacion_productos falla con SIN_CONEXION_IMPORTACION). Solo Administrador (42501).';

revoke execute on function public.importacion_productos_habilitada() from public, anon;
grant execute on function public.importacion_productos_habilitada() to authenticated;

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
  v_sin_imagenes integer;
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

  -- Filas aplicadas cuyas imágenes nunca se adjuntaron: el resultado final las cuenta (no se cierran en silencio).
  select count(*)::integer into v_sin_imagenes
    from dominio.importaciones_productos_filas f
   where f.importacion_id = v_imp.id and f.resultado = 'aplicada' and f.imagenes_pendientes;

  return jsonb_build_object('procesadas', v_procesadas, 'omitidas', v_omitidas, 'sin_imagenes', v_sin_imagenes,
                            'organizacion_id', v_imp.organizacion_id);
end;
$$;

revoke execute on function private.cerrar_importacion_productos(uuid, text, text) from public, anon, authenticated;
grant execute on function private.cerrar_importacion_productos(uuid, text, text) to workers_orquestacion;

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
    -- Omitidas por un error temporal repetido (se pueden volver a importar), distintas de las omitidas por datos.
    'omitidas_temporales', (select count(*) from dominio.importaciones_productos_filas f
                             where f.importacion_id = v_imp.id and f.resultado = 'omitida'
                               and f.motivo_codigo = 'ERROR_TEMPORAL'),
    -- Productos aplicados cuyas imágenes no llegaron a adjuntarse (también en una importación cerrada como fallida).
    'sin_imagenes', (select count(*) from dominio.importaciones_productos_filas f
                      where f.importacion_id = v_imp.id and f.resultado = 'aplicada' and f.imagenes_pendientes),
    'ejecucion_id', v_imp.ejecucion_id,
    'mensaje_fallo', v_imp.mensaje_fallo,
    'errores', coalesce((
      select jsonb_agg(jsonb_build_object('fila', f.fila, 'sku', f.sku, 'mensaje', f.resultado_mensaje, 'codigo', f.motivo_codigo) order by f.fila)
        from dominio.importaciones_productos_filas f
       where f.importacion_id = v_imp.id and f.resultado = 'omitida'
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.obtener_importacion_productos(uuid) from public, anon;
grant execute on function public.obtener_importacion_productos(uuid) to authenticated;

-- ============================================================================
-- Fila que siempre falla con un error transitorio: el worker la registra y, al tercer intento, queda omitida para que
-- el resto de la importación avance (si no, cada reintento chocaría con la misma fila y las siguientes no se verían).
-- Corre en su propia transacción: la de `aplicar_fila_...` se revirtió al propagar el error.
-- ============================================================================

create or replace function private.registrar_fallo_fila_importacion_productos(p_ejecucion_id uuid, p_fila_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_imp dominio.importaciones_productos;
  v_intentos integer;
  v_tope constant integer := 3;
begin
  v_imp := private.autorizar_worker_importacion_productos(p_ejecucion_id);
  update dominio.importaciones_productos_filas f
     set intentos = least(f.intentos + 1, 32000)::smallint
   where f.id = p_fila_id and f.importacion_id = v_imp.id and f.resultado = 'pendiente'
  returning f.intentos into v_intentos;
  if not found then
    raise exception 'FILA_DESCONOCIDA: %', p_fila_id using errcode = 'P0001';
  end if;
  if v_intentos >= v_tope then
    update dominio.importaciones_productos_filas f
       set resultado = 'omitida', aplicada_en = now(), motivo_codigo = 'ERROR_TEMPORAL',
           resultado_mensaje = 'Error temporal repetido; volvé a importar esta fila'
     where f.id = p_fila_id;
  end if;
  return v_intentos;
end;
$$;

comment on function private.registrar_fallo_fila_importacion_productos(uuid, uuid) is
  'F-CAT-10: suma un intento fallido (error transitorio) a una fila pendiente; al tercero la omite con «Error temporal repetido; volvé a importar esta fila» (el motivo dice que fue transitorio). Devuelve los intentos.';

revoke execute on function private.registrar_fallo_fila_importacion_productos(uuid, uuid) from public, anon, authenticated;
grant execute on function private.registrar_fallo_fila_importacion_productos(uuid, uuid) to workers_orquestacion;
