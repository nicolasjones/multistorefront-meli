-- Lote 75 (MSF-599, MSF-654 y MSF-655, duodécima ola de la convención de códigos de negocio mapeados a 4xx): ocho RPC de listas de
-- precios, variantes de producto, mover productos de categoría, actualización masiva de precios y vista previa de la cotización
-- dejan de contestar HTTP 500 cuando rechazan por «no existe» (`P0002`) o conflicto de edición (`40001`). Pasan, con el mismo
-- mensaje de siempre, a `PT404` (HTTP 404) y `PT412` (HTTP 412). Qué código emite cada función: ver la fila 12 de la tabla de
-- docs/errores-negocio-postgrest.md.
--
-- Funciones: archivar_lista_precios, restaurar_lista_precios, guardar_lista_precios, asignar_lista_precios_cliente,
-- guardar_variantes_producto, mover_productos_categoria, previsualizar_cotizacion y aplicar_actualizacion_precios.
--
-- Cada función parte de su definición VIGENTE (la de la base con la undécima ola aplicada, que `pg_get_functiondef` devuelve tal
-- cual: `asignar_lista_precios_cliente` ya apunta a `dominio.clientes` por el barrido 20270418000401) y solo cambia el errcode:
-- mensajes, cuerpo, firma, `security definer` o `invoker`, `search_path` y grants son los mismos (`create or replace` conserva
-- privilegios; no hay drop, grant ni revoke). Cinco comentarios mencionaban el código y se actualizan (aplicar_actualizacion_precios,
-- guardar_lista_precios, guardar_variantes_producto, mover_productos_categoria y previsualizar_cotizacion).
--
-- Ninguna es llamable por `anon` ni la consume Kestra, un worker o una Edge Function: solo la web, que acepta el código viejo y el
-- nuevo (`esCodigoDeConflicto`, `P0002` o `PT404`) porque la migración y el despliegue no son simultáneos.
--
-- Quedan con el código anterior a propósito:
--   (a) los `55000` de bandera apagada de `guardar_lista_precios`, `asignar_lista_precios_cliente`, `aplicar_actualizacion_precios`
--       y `previsualizar_actualizacion_precios` (falla de configuración del entorno, no una regla de negocio de la persona);
--   (b) el `40001` con `detail = 'stock'` de `guardar_variantes_producto` (contrato propio: el cliente muestra el mensaje del
--       servidor cuando el stock de una variante cambió mientras editabas);
--   (c) el `P0002` de producto inexistente de `mover_productos_categoria`, `cambiar_estado_productos` y `definir_empresas_productos`:
--       lo lanza el auxiliar `private.bloquear_productos_masivo` (`cambiar_estado_productos` y `definir_empresas_productos` no lanzan
--       ningún errcode propio de este grupo, así que no se tocan);
--   (d) `conciliar_pago` y `revertir_conciliacion_pago`: no lanzan errores propios, delegan en `private.aplicar_conciliacion`;
--   (e) el `P0002` del resto de las funciones de `public` fuera de este alcance (tienda, claves de API, invitaciones, integraciones,
--       importaciones, documentos de comprobantes, clientes, etc.), para próximas olas.
--
-- Migración aditiva (create or replace).
--
-- Reversión: volver a aplicar, en una migración nueva, la definición vigente anterior de cada función (en el cuerpo, `PT404`
-- vuelve a `P0002` y `PT412` a `40001`, solo en las líneas que esta migración cambia) y restaurar los cinco comentarios previos.
-- Definiciones vigentes anteriores (la última migración que cada función define; antes de copiar un cuerpo hay que comprobar que
-- ningún barrido posterior lo reescribió, como el de `public.clientes` a `dominio.clientes`):
--   archivar_lista_precios: 20270346000000; restaurar_lista_precios y guardar_lista_precios: 20270340000000;
--   asignar_lista_precios_cliente: 20270340000200 (con `public.clientes` reescrito a `dominio.clientes` por 20270418000401);
--   guardar_variantes_producto: 20270220120600; mover_productos_categoria: 20270215100000; previsualizar_cotizacion:
--   20270218500200; aplicar_actualizacion_precios: 20270228300200.
-- Comentarios previos: los de esas mismas migraciones (aplicar_actualizacion_precios: 20270228300200; guardar_lista_precios:
-- 20270340000000; guardar_variantes_producto: 20270220120600; mover_productos_categoria: 20270215100000; previsualizar_cotizacion:
-- 20270218500200). Las migraciones ya aplicadas no se editan.

-- archivar_lista_precios
CREATE OR REPLACE FUNCTION public.archivar_lista_precios(p_id uuid, p_actualizado timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_actual dominio.listas_precios;
  v_clientes bigint;
begin
  if v_organizacion is null or v_actor is null or not (select private.es_administrador_de(v_organizacion)) then
    raise exception 'Solo un administrador puede archivar listas de precios' using errcode = '42501';
  end if;
  select * into v_actual
    from dominio.listas_precios x
   where x.id = p_id and x.organizacion_id = v_organizacion
     for update;
  if not found then
    raise exception 'La lista de precios no existe' using errcode = 'PT404';
  end if;
  -- Archivar lo ya archivado no falla.
  if v_actual.archivada_en is not null then
    return;
  end if;
  if v_actual.updated_at is distinct from p_actualizado then
    raise exception 'La lista fue modificada por otra persona' using errcode = 'PT412';
  end if;
  v_clientes := (select private.cantidad_clientes_lista(v_actual.id));
  if v_clientes > 0 then
    raise exception '%', case when v_clientes = 1
        then 'No se puede archivar: 1 cliente usa esta lista. Reasignalo o quitale la lista primero.'
        else 'No se puede archivar: ' || v_clientes || ' clientes usan esta lista. Reasignalos o quitales la lista primero.' end
      using errcode = '23503', hint = 'clientes_asignados';
  end if;

  update dominio.listas_precios set archivada_en = now() where id = v_actual.id;

  perform private.insertar_cambio_actividad(
    v_organizacion, v_actor, 'lista_precios.archivada',
    'Archivó la lista de precios «' || v_actual.nombre || '» (' || private.texto_ajuste_lista(v_actual.ajuste_pct) || ')',
    jsonb_build_object('archivada', false), jsonb_build_object('archivada', true)
  );
end;
$function$;

-- restaurar_lista_precios
CREATE OR REPLACE FUNCTION public.restaurar_lista_precios(p_id uuid, p_actualizado timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_actual dominio.listas_precios;
begin
  if v_organizacion is null or v_actor is null or not (select private.es_administrador_de(v_organizacion)) then
    raise exception 'Solo un administrador puede restaurar listas de precios' using errcode = '42501';
  end if;
  select * into v_actual
    from dominio.listas_precios x
   where x.id = p_id and x.organizacion_id = v_organizacion
     for update;
  if not found then
    raise exception 'La lista de precios no existe' using errcode = 'PT404';
  end if;
  if v_actual.archivada_en is null then
    return;
  end if;
  if v_actual.updated_at is distinct from p_actualizado then
    raise exception 'La lista fue modificada por otra persona' using errcode = 'PT412';
  end if;

  update dominio.listas_precios set archivada_en = null where id = v_actual.id;

  perform private.insertar_cambio_actividad(
    v_organizacion, v_actor, 'lista_precios.restaurada',
    'Restauró la lista de precios «' || v_actual.nombre || '» (' || private.texto_ajuste_lista(v_actual.ajuste_pct) || ')',
    jsonb_build_object('archivada', true), jsonb_build_object('archivada', false)
  );
end;
$function$;

-- guardar_lista_precios
CREATE OR REPLACE FUNCTION public.guardar_lista_precios(p_id uuid, p_nombre text, p_descripcion text, p_ajuste_pct numeric, p_actualizado timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_nombre text := btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
  v_descripcion text := nullif(btrim(coalesce(p_descripcion, '')), '');
  v_actual dominio.listas_precios;
  v_existente dominio.listas_precios;
  v_id uuid;
begin
  if v_organizacion is null or v_actor is null or not (select private.es_administrador_de(v_organizacion)) then
    raise exception 'Solo un administrador puede crear o editar listas de precios' using errcode = '42501';
  end if;
  if not (select private.bandera_activa('listas_precios')) then
    raise exception 'Las listas de precios están desactivadas en este entorno' using errcode = '55000';
  end if;
  if char_length(v_nombre) < 1 or char_length(v_nombre) > 80 then
    raise exception 'El nombre de la lista debe tener entre 1 y 80 caracteres' using errcode = '22023';
  end if;
  if v_descripcion is not null and char_length(v_descripcion) > 300 then
    raise exception 'La descripción no puede superar los 300 caracteres' using errcode = '22023';
  end if;
  if p_ajuste_pct is null or p_ajuste_pct < -90 or p_ajuste_pct > 100 then
    raise exception 'El ajuste debe estar entre -90 %% y +100 %%' using errcode = '23514';
  end if;
  if round(p_ajuste_pct, 2) <> p_ajuste_pct then
    raise exception 'El ajuste admite hasta 2 decimales' using errcode = '22003';
  end if;

  if p_id is null then
    select * into v_existente
      from dominio.listas_precios x
     where x.organizacion_id = v_organizacion and lower(x.nombre) = lower(v_nombre);
    if found then
      -- Idempotencia del alta: la misma lista (mismos datos) se devuelve tal cual.
      if v_existente.ajuste_pct = round(p_ajuste_pct, 2)
         and v_existente.descripcion is not distinct from v_descripcion
         and v_existente.archivada_en is null then
        return v_existente.id;
      end if;
      raise exception 'Ya existe una lista con ese nombre' using errcode = '23505';
    end if;

    insert into dominio.listas_precios (organizacion_id, nombre, descripcion, ajuste_pct, creada_por)
    values (v_organizacion, v_nombre, v_descripcion, round(p_ajuste_pct, 2), v_actor)
    returning id into v_id;

    perform private.insertar_cambio_actividad(
      v_organizacion, v_actor, 'lista_precios.creada',
      'Creó la lista de precios «' || v_nombre || '» (' || private.texto_ajuste_lista(round(p_ajuste_pct, 2)) || ')',
      null,
      jsonb_build_object('nombre', v_nombre, 'ajuste_pct', round(p_ajuste_pct, 2))
    );
    return v_id;
  end if;

  select * into v_actual
    from dominio.listas_precios x
   where x.id = p_id and x.organizacion_id = v_organizacion
     for update;
  if not found then
    raise exception 'La lista de precios no existe' using errcode = 'PT404';
  end if;

  -- Guardar lo que ya está guardado es idempotente.
  if (v_actual.nombre, v_actual.descripcion, v_actual.ajuste_pct)
     is not distinct from (v_nombre, v_descripcion, round(p_ajuste_pct, 2)) then
    return v_actual.id;
  end if;
  if v_actual.updated_at is distinct from p_actualizado then
    raise exception 'La lista fue modificada por otra persona' using errcode = 'PT412';
  end if;
  if exists (
    select 1 from dominio.listas_precios x
     where x.organizacion_id = v_organizacion and lower(x.nombre) = lower(v_nombre) and x.id <> v_actual.id
  ) then
    raise exception 'Ya existe una lista con ese nombre' using errcode = '23505';
  end if;

  update dominio.listas_precios
     set nombre = v_nombre, descripcion = v_descripcion, ajuste_pct = round(p_ajuste_pct, 2)
   where id = v_actual.id;

  perform private.insertar_cambio_actividad(
    v_organizacion, v_actor, 'lista_precios.editada',
    'Editó la lista de precios «' || v_nombre || '» (' || private.texto_ajuste_lista(v_actual.ajuste_pct)
      || ' → ' || private.texto_ajuste_lista(round(p_ajuste_pct, 2)) || ')',
    jsonb_build_object('nombre', v_actual.nombre, 'ajuste_pct', v_actual.ajuste_pct),
    jsonb_build_object('nombre', v_nombre, 'ajuste_pct', round(p_ajuste_pct, 2))
  );
  return v_actual.id;
end;
$function$;

-- asignar_lista_precios_cliente
CREATE OR REPLACE FUNCTION public.asignar_lista_precios_cliente(p_cliente uuid, p_lista uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_cliente dominio.clientes;
  v_nueva dominio.listas_precios;
  v_anterior dominio.listas_precios;
begin
  if v_organizacion is null or v_actor is null or not (select private.es_administrador_de(v_organizacion)) then
    raise exception 'Solo un administrador puede asignar una lista de precios' using errcode = '42501';
  end if;
  -- Bandera de apagado (D13): apagada no se asigna; quitar la lista sigue permitido.
  if p_lista is not null and not (select private.bandera_activa('listas_precios')) then
    raise exception 'Las listas de precios están desactivadas en este entorno' using errcode = '55000';
  end if;

  select * into v_cliente
    from dominio.clientes c
   where c.id = p_cliente and c.organizacion_id = v_organizacion
     for update;
  if not found then
    raise exception 'El cliente no existe' using errcode = 'PT404';
  end if;
  -- Idempotente: asignar la lista que ya tiene (o quitar la que no tiene) no escribe ni registra nada.
  if v_cliente.lista_precio_id is not distinct from p_lista then
    return;
  end if;
  if p_lista is not null then
    if v_cliente.archivado_en is not null then
      raise exception 'El cliente está archivado' using errcode = '22023';
    end if;
    if v_cliente.es_consumidor_final then
      raise exception 'El Consumidor final no admite una lista de precios' using errcode = '22023';
    end if;
    select * into v_nueva
      from dominio.listas_precios l
     where l.id = p_lista and l.organizacion_id = v_organizacion;
    if not found then
      raise exception 'La lista de precios no existe' using errcode = 'PT404';
    end if;
    if v_nueva.archivada_en is not null then
      raise exception 'La lista de precios está archivada' using errcode = '22023';
    end if;
  end if;
  if v_cliente.lista_precio_id is not null then
    select * into v_anterior from dominio.listas_precios l where l.id = v_cliente.lista_precio_id;
  end if;

  update dominio.clientes set lista_precio_id = p_lista where id = v_cliente.id;

  perform private.insertar_cambio_actividad(
    v_organizacion, v_actor, 'cliente.lista_precio_asignada',
    case
      when p_lista is null then format('Quitó la lista de precios del cliente Nº %s · %s', v_cliente.numero, v_cliente.nombre)
      else format('Asignó la lista de precios «%s» al cliente Nº %s · %s', v_nueva.nombre, v_cliente.numero, v_cliente.nombre)
    end,
    case when v_anterior.id is null then null
         else jsonb_build_object('lista_id', v_anterior.id, 'lista', v_anterior.nombre, 'ajuste_pct', v_anterior.ajuste_pct) end,
    case when v_nueva.id is null then null
         else jsonb_build_object('lista_id', v_nueva.id, 'lista', v_nueva.nombre, 'ajuste_pct', v_nueva.ajuste_pct) end
  );
end;
$function$;

-- guardar_variantes_producto
CREATE OR REPLACE FUNCTION public.guardar_variantes_producto(p_producto uuid, p_actualizado_en timestamp with time zone, p_variantes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_producto dominio.productos;
  v_items jsonb := coalesce(p_variantes, '[]'::jsonb);
  v_item jsonb;
  v_n integer;
  v_id uuid;
  v_nombre text;
  v_codigo text;
  v_barras text;
  v_activa boolean;
  v_stock integer;
  v_codigos text[] := '{}';
  v_barras_vistos text[] := '{}';
  v_ids_payload uuid[] := '{}';
  v_ids uuid[] := '{}';
  v_stocks integer[] := '{}';
  v_leidos integer[] := '{}';
  v_existentes integer;
  v_filas integer;
  v_cambio boolean := false;
  v_actual integer;
  v_actual_deposito integer;
  v_nuevo_deposito integer;
  v_motivo uuid;
  v_deposito uuid;
  v_lista text;
  v_ver_stock boolean;
begin
  if v_org is null or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede editar productos' using errcode = '42501';
  end if;

  -- Orden de bloqueos IGUAL al de `registrar_movimiento_stock` (primero `existencias` y recién después `productos`, que es lo que pide la FK
  -- de `movimientos_stock`): al revés, un guardado y un movimiento concurrentes del mismo producto se bloquean entre sí (deadlock 40P01). Además
  -- serializa la regla de la primera variante (paso 3) y el stock actual (paso 6) con los movimientos que mueven el stock del producto.
  perform 1 from dominio.existencias e where e.producto_id = p_producto and e.organizacion_id = v_org for update;

  -- Serializa guardados del mismo producto y aplica el bloqueo optimista (como actualizar_producto).
  select * into v_producto from dominio.productos p
   where p.id = p_producto and p.organizacion_id = v_org for update;
  if not found then
    raise exception 'El producto no existe' using errcode = 'PT404';
  end if;
  if p_actualizado_en is not null and v_producto.updated_at <> p_actualizado_en then
    raise exception 'El producto fue modificado por otra persona' using errcode = 'PT412';
  end if;

  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'Las variantes deben enviarse como una lista' using errcode = '22023';
  end if;

  -- Sin edición en Stock no se acepta ningún valor de stock, ni siquiera el que coincide con el actual: comparar primero y rechazar después dejaría
  -- adivinar el stock exacto probando valores (el rol sin acceso a Stock no lo ve en la pantalla).
  if exists (select 1 from jsonb_array_elements(v_items) as x
              where jsonb_typeof(x.value) = 'object' and jsonb_typeof(x.value -> 'stock') = 'number')
     and (select private.nivel_seccion('stock')) <> 'edicion' then
    raise exception 'Tu rol no puede ajustar el stock' using errcode = '42501';
  end if;

  -- 0. Reintento idempotente (alta que se repite): una fila sin id cuyo código ya es de una variante de ESTE
  --    producto es esa variante, no una nueva.
  select coalesce(jsonb_agg(
           case when nullif(x.value ->> 'id', '') is null
                     and exists (select 1 from dominio.producto_variantes v
                                  where v.producto_id = p_producto and v.organizacion_id = v_org
                                    and lower(btrim(v.codigo)) = lower(btrim(coalesce(x.value ->> 'codigo', ''))))
                then x.value || jsonb_build_object('id', (select v.id from dominio.producto_variantes v
                                  where v.producto_id = p_producto and v.organizacion_id = v_org
                                    and lower(btrim(v.codigo)) = lower(btrim(x.value ->> 'codigo'))))
                else x.value end
           order by x.ordinality), '[]'::jsonb)
    into v_items
    from jsonb_array_elements(v_items) with ordinality as x
   where jsonb_typeof(x.value) = 'object';

  -- 1. Validación de cada fila y de repetidos dentro del mismo envío.
  for v_item, v_n in select x.value, x.ordinality::integer from jsonb_array_elements(v_items) with ordinality as x loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Cada variante debe ser un objeto' using errcode = '22023';
    end if;
    v_nombre := btrim(coalesce(v_item ->> 'nombre', ''));
    v_codigo := btrim(coalesce(v_item ->> 'codigo', ''));
    v_barras := nullif(btrim(coalesce(v_item ->> 'codigo_barras', '')), '');
    if v_nombre = '' then
      raise exception 'La variante % necesita un nombre', v_n using errcode = '22023', detail = 'nombre';
    end if;
    if length(v_nombre) > 120 then
      raise exception 'El nombre de la variante admite hasta 120 caracteres' using errcode = '22023', detail = 'nombre';
    end if;
    if v_codigo = '' then
      raise exception 'La variante "%" necesita un código', v_nombre using errcode = '22023', detail = 'codigo';
    end if;
    if length(v_codigo) > 80 then
      raise exception 'El código de la variante admite hasta 80 caracteres' using errcode = '22023', detail = 'codigo';
    end if;
    if v_barras is not null and v_barras !~ '^[0-9]{13}$' then
      raise exception 'El código de barras "%" debe tener 13 dígitos (EAN-13)', v_barras
        using errcode = '22023', detail = 'codigo_barras';
    end if;
    if lower(v_codigo) = any (v_codigos) then
      raise exception 'El código "%" está repetido entre las variantes', v_codigo using errcode = '23505', detail = 'codigo';
    end if;
    v_codigos := v_codigos || lower(v_codigo);
    if v_barras is not null then
      if v_barras = any (v_barras_vistos) then
        raise exception 'El código de barras "%" está repetido entre las variantes', v_barras
          using errcode = '23505', detail = 'codigo_barras';
      end if;
      v_barras_vistos := v_barras_vistos || v_barras;
    end if;
    if v_item ? 'stock' and jsonb_typeof(v_item -> 'stock') <> 'null' then
      if jsonb_typeof(v_item -> 'stock') <> 'number' or (v_item ->> 'stock')::numeric <> trunc((v_item ->> 'stock')::numeric)
         or (v_item ->> 'stock')::numeric < 0 or (v_item ->> 'stock')::numeric > 2147483647 then
        raise exception 'El stock de "%" debe ser un entero de cero a 2147483647', v_nombre using errcode = '22023', detail = 'stock';
      end if;
    end if;
    -- `stock_leido`: el stock que la persona vio al abrir la ficha (opcional; ver el paso 6).
    if v_item ? 'stock_leido' and jsonb_typeof(v_item -> 'stock_leido') <> 'null' then
      if jsonb_typeof(v_item -> 'stock_leido') <> 'number' or (v_item ->> 'stock_leido')::numeric <> trunc((v_item ->> 'stock_leido')::numeric)
         or (v_item ->> 'stock_leido')::numeric < 0 or (v_item ->> 'stock_leido')::numeric > 2147483647 then
        raise exception 'El stock leído de "%" no es válido', v_nombre using errcode = '22023', detail = 'stock';
      end if;
    end if;
    if nullif(v_item ->> 'id', '') is not null then
      v_ids_payload := v_ids_payload || (v_item ->> 'id')::uuid;
    end if;
  end loop;

  -- 2. Las variantes no se borran: las existentes tienen que venir en el envío.
  select count(*) into v_existentes from dominio.producto_variantes v
   where v.producto_id = p_producto and v.organizacion_id = v_org;
  if exists (select 1 from dominio.producto_variantes v
              where v.producto_id = p_producto and v.organizacion_id = v_org and v.id <> all (v_ids_payload)) then
    raise exception 'Enviá todas las variantes del producto: las que no uses se desactivan, no se borran'
      using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_ids_payload) as x(id)
              where not exists (select 1 from dominio.producto_variantes v
                                 where v.id = x.id and v.producto_id = p_producto and v.organizacion_id = v_org)) then
    raise exception 'Alguna variante no pertenece a este producto' using errcode = '22023';
  end if;

  -- 3. Decisión 4: la primera variante no se agrega sobre un producto con stock.
  if v_existentes = 0 and jsonb_array_length(v_items) > 0 then
    select e.cantidad into v_actual from dominio.existencias e
     where e.producto_id = p_producto and e.organizacion_id = v_org;
    if coalesce(v_actual, 0) > 0 then
      raise exception 'Este producto tiene % % en stock: dejá el stock del producto en 0 y cargalo en las variantes',
        v_actual, case when v_actual = 1 then 'unidad' else 'unidades' end
        using errcode = '22023', detail = 'primera_variante';
    end if;
  end if;

  -- 4. Choques de código con otras variantes (los choques con productos los corta el disparador, con su mensaje).
  for v_item in select x.value from jsonb_array_elements(v_items) as x loop
    v_id := nullif(v_item ->> 'id', '')::uuid;
    v_codigo := btrim(v_item ->> 'codigo');
    v_barras := nullif(btrim(coalesce(v_item ->> 'codigo_barras', '')), '');
    if exists (select 1 from dominio.producto_variantes v
                where v.organizacion_id = v_org and lower(btrim(v.codigo)) = lower(v_codigo) and v.id is distinct from v_id) then
      raise exception 'El código "%" ya lo usa otra variante', v_codigo using errcode = '23505', detail = 'codigo';
    end if;
    if v_barras is not null and exists (select 1 from dominio.producto_variantes v
                where v.organizacion_id = v_org and v.codigo_barras = v_barras and v.id is distinct from v_id) then
      raise exception 'El código de barras "%" ya lo usa otra variante', v_barras
        using errcode = '23505', detail = 'codigo_barras';
    end if;
  end loop;

  -- 5. Reemplazo completo e idempotente: el orden es la posición.
  for v_item, v_n in select x.value, x.ordinality::integer from jsonb_array_elements(v_items) with ordinality as x loop
    v_id := nullif(v_item ->> 'id', '')::uuid;
    v_nombre := btrim(v_item ->> 'nombre');
    v_codigo := btrim(v_item ->> 'codigo');
    v_barras := nullif(btrim(coalesce(v_item ->> 'codigo_barras', '')), '');
    v_activa := coalesce((v_item ->> 'activa')::boolean, true);
    v_stock := case when v_item ? 'stock' and jsonb_typeof(v_item -> 'stock') = 'number'
                    then (v_item ->> 'stock')::integer end;

    if v_id is null then
      insert into dominio.producto_variantes (organizacion_id, producto_id, nombre, codigo, codigo_barras, activa, orden)
      values (v_org, p_producto, v_nombre, v_codigo, v_barras, v_activa, v_n)
      returning id into v_id;
      v_cambio := true;
    else
      update dominio.producto_variantes v
         set nombre = v_nombre, codigo = v_codigo, codigo_barras = v_barras, activa = v_activa, orden = v_n
       where v.id = v_id and v.producto_id = p_producto and v.organizacion_id = v_org
         and (v.nombre, v.codigo, v.codigo_barras, v.activa, v.orden)
             is distinct from (v_nombre, v_codigo, v_barras, v_activa, v_n);
      get diagnostics v_filas = row_count;
      if v_filas > 0 then
        v_cambio := true;
      end if;
    end if;
    v_ids := v_ids || v_id;
    v_stocks := v_stocks || v_stock;
    v_leidos := v_leidos || (case when v_item ? 'stock_leido' and jsonb_typeof(v_item -> 'stock_leido') = 'number'
                                  then (v_item ->> 'stock_leido')::integer end);
  end loop;

  -- 6. Stock contado: ajuste en el depósito por defecto, solo si difiere (requiere edición en Stock; ver el control de `stock_leido`).
  for v_n in 1 .. coalesce(cardinality(v_ids), 0) loop
    continue when v_stocks[v_n] is null;
    select coalesce(sum(x.cantidad), 0)::integer into v_actual
      from dominio.existencias_variante x where x.variante_id = v_ids[v_n];
    continue when v_actual = v_stocks[v_n];

    -- Compare-and-set: si la ficha trajo el stock que vio la persona y ya es otro, alguien lo movió mientras editaba; sobrescribirlo con un
    -- conteo perdería ese movimiento sin avisar. Se rechaza y la persona recarga.
    if v_leidos[v_n] is not null and v_actual <> v_leidos[v_n] then
      raise exception 'El stock de la variante cambió mientras editabas (ahora hay %, vos viste %): recargá la ficha', v_actual, v_leidos[v_n]
        using errcode = '40001', detail = 'stock';
    end if;

    if (select private.nivel_seccion('stock')) <> 'edicion' then
      raise exception 'Tu rol no puede ajustar el stock' using errcode = '42501';
    end if;
    select d.id into v_deposito from dominio.depositos d
     where d.organizacion_id = v_org and d.por_defecto and d.activo;
    if v_deposito is null then
      raise exception 'No hay un depósito por defecto activo para cargar el stock' using errcode = '22023';
    end if;
    select m.id into v_motivo from dominio.motivos_movimiento m
     where m.organizacion_id = v_org and m.nombre = 'Conteo de inventario' and m.activo and 'ajuste' = any (m.aplica_a)
     limit 1;
    if v_motivo is null then
      raise exception 'No hay un motivo activo «Conteo de inventario» para ajustar el stock' using errcode = '22023';
    end if;
    select coalesce((select x.cantidad from dominio.existencias_variante x
                      where x.variante_id = v_ids[v_n] and x.deposito_id = v_deposito), 0)
      into v_actual_deposito;
    v_nuevo_deposito := v_actual_deposito + (v_stocks[v_n] - v_actual);
    if v_nuevo_deposito < 0 then
      raise exception 'No se puede dejar el stock en %: hay unidades en otros depósitos', v_stocks[v_n]
        using errcode = '22023', detail = 'stock';
    end if;
    perform public.registrar_movimiento_stock(
      p_producto, 'ajuste', v_nuevo_deposito, v_motivo, null, current_date, v_deposito, null, v_ids[v_n]);
  end loop;

  -- 7. Evento solo con cambio real y con sesión; sin precios ni costo.
  if v_cambio and v_actor is not null then
    select string_agg(v.nombre, ', ' order by v.orden) into v_lista
      from dominio.producto_variantes v where v.producto_id = p_producto and v.organizacion_id = v_org;
    perform private.registrar_actividad(
      'producto.variantes_editadas',
      format('Cambió las variantes de %s%s: %s',
        v_producto.nombre,
        case when v_producto.sku is null then '' else format(' (SKU %s)', v_producto.sku) end,
        coalesce(v_lista, 'sin variantes')),
      null
    );
  end if;

  v_ver_stock := (select private.nivel_seccion('stock')) in ('lectura', 'edicion');
  return jsonb_build_object(
    'variantes',
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'nombre', v.nombre, 'codigo', v.codigo, 'codigo_barras', v.codigo_barras,
        'activa', v.activa, 'orden', v.orden,
        'stock', case when v_ver_stock
                      then (select coalesce(sum(x.cantidad), 0)::integer from dominio.existencias_variante x where x.variante_id = v.id)
                 end
      ) order by v.orden)
      from dominio.producto_variantes v where v.producto_id = p_producto and v.organizacion_id = v_org
    ), '[]'::jsonb)
  );
end;
$function$;

-- mover_productos_categoria
CREATE OR REPLACE FUNCTION public.mover_productos_categoria(p_producto_ids uuid[], p_categoria_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_ids uuid[];
  v_id uuid;
  v_cambiados integer := 0;
begin
  if v_org is null or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede editar productos' using errcode = '42501';
  end if;
  if p_categoria_id is null then
    raise exception 'La categoría es obligatoria' using errcode = '22023';
  end if;
  v_ids := private.bloquear_productos_masivo(p_producto_ids, v_org);
  if not exists (select 1 from dominio.categorias c where c.id = p_categoria_id and c.organizacion_id = v_org) then
    raise exception 'La categoría no existe' using errcode = 'PT404';
  end if;

  foreach v_id in array v_ids loop
    if exists (
      select 1 from dominio.productos p
       where p.id = v_id and p.categoria_id is distinct from p_categoria_id
    ) then
      perform public.asignar_categoria_producto(v_id, p_categoria_id);
      v_cambiados := v_cambiados + 1;
    end if;
  end loop;
  return v_cambiados;
end;
$function$;

-- previsualizar_cotizacion
CREATE OR REPLACE FUNCTION public.previsualizar_cotizacion(p_empresa uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_config record;
  v_empresa uuid;
  v_pendiente dominio.cotizacion_pendiente;
  v_vigente numeric;
  v_variacion numeric;
  v_recalcula boolean;
  v_empresas jsonb;
  v_muestra jsonb;
begin
  if v_organizacion is null or (select private.nivel_seccion('cotizacion_dolar')) <> 'edicion' then
    raise exception 'Tu rol no puede ver la vista previa de la cotización' using errcode = '42501';
  end if;
  select * into v_config from private.cotizacion_config(v_organizacion);
  v_empresa := private.empresa_de_cotizacion(v_organizacion, p_empresa);

  select * into v_pendiente from dominio.cotizacion_pendiente p
   where p.organizacion_id = v_organizacion and p.empresa_id is not distinct from v_empresa and p.expira_en > now();
  if not found then
    raise exception 'sin_cotizacion_pendiente' using errcode = 'PT404';
  end if;

  -- Contra la cotización APLICADA, la misma que decide `confirmar_cotizacion` (MSF-352).
  v_vigente := private.cotizacion_para(v_organizacion, v_empresa);
  v_variacion := case when v_vigente is null then null else round((v_pendiente.valor / v_vigente - 1) * 100, 4) end;
  -- Mismo criterio que `confirmar_cotizacion`: sin cotización previa siempre se aplica; si no, |variación| ≥ umbral.
  v_recalcula := v_vigente is null or abs(v_pendiente.valor - v_vigente) * 100 >= v_vigente * v_config.umbral_pct;

  select coalesce(jsonb_agg(jsonb_build_object('empresa_id', u.empresa_id, 'nombre', u.nombre, 'precios', u.precios)
                            order by lower(u.nombre), u.empresa_id), '[]'::jsonb)
    into v_empresas
    from private.precios_usd_por_empresa(v_organizacion) u
   where v_empresa is null or u.empresa_id = v_empresa;

  -- Muestra: productos que alguna empresa del alcance calcula en USD (el producto en USD sin precio propio en pesos, o
  -- cualquier producto con precio propio en USD). «Nuevo» convierte con la cotización pendiente; un precio propio en
  -- pesos no cambia y un producto en ARS no se multiplica por el dólar.
  select coalesce(jsonb_agg(m.fila order by m.orden), '[]'::jsonb) into v_muestra
    from (
      select row_number() over (order by lower(p.nombre), p.id) as orden,
             jsonb_build_object(
               'producto', p.nombre, 'sku', p.sku, 'usd', case when p.moneda = 'USD' then p.precio_lista end,
               'por_empresa', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'empresa_id', e.id,
                          'usd', case when x.moneda is not null then case when x.moneda = 'USD' then x.importe end
                                      when p.moneda = 'USD' then p.precio_lista end,
                          'hoy', private.precio_visible_con_redondeo(
                                   private.a_pesos(p.precio_lista, p.moneda, p.organizacion_id, e.id),
                                   p.id, e.id, v_config.redondeo_pesos),
                          'nuevo', private.precio_visible_con_cotizacion(
                                   case p.moneda when 'USD' then round(p.precio_lista * v_pendiente.valor, 2) else p.precio_lista end,
                                   p.id, e.id, v_config.redondeo_pesos, v_pendiente.valor)
                        ) order by lower(e.nombre), e.id), '[]'::jsonb)
                   from dominio.empresas e
                   left join dominio.precios_propios_empresa x
                     on x.producto_id = p.id and x.empresa_id = e.id and x.organizacion_id = p.organizacion_id
                  where e.organizacion_id = p.organizacion_id and e.activa
                    and (v_empresa is null or e.id = v_empresa)
               )
             ) as fila
        from dominio.productos p
       where p.organizacion_id = v_organizacion and p.activo
         and exists (
           select 1 from dominio.empresas e
             left join dominio.precios_propios_empresa x
               on x.producto_id = p.id and x.empresa_id = e.id and x.organizacion_id = p.organizacion_id
            where e.organizacion_id = p.organizacion_id and e.activa
              and (v_empresa is null or e.id = v_empresa)
              and coalesce(x.moneda, p.moneda) = 'USD')
       order by lower(p.nombre), p.id
       limit 6
    ) m;

  return jsonb_build_object(
    'variacion_pct', v_variacion,
    'recalcula', v_recalcula,
    'empresas', v_empresas,
    'muestra', v_muestra,
    'umbral_pct', v_config.umbral_pct,
    'confirmacion_pct', v_config.confirmacion_pct,
    'redondeo_pesos', v_config.redondeo_pesos
  );
end;
$function$;

-- aplicar_actualizacion_precios
CREATE OR REPLACE FUNCTION public.aplicar_actualizacion_precios(p_modo text, p_parametros jsonb, p_clave uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      raise exception 'Un producto fue modificado por otra persona; repetí la vista previa' using errcode = 'PT412';
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
$function$;

-- Comentarios
comment on function public.aplicar_actualizacion_precios(text,jsonb,uuid) is
  'F-PRE-10 + MSF-363: aplica una actualización masiva de lista y costo (todo o nada, idempotente por clave, PT412 por updated_at). Exige bandera precios_masivos encendida y productos en edición en todas las tiendas activas de la organización; costo solo con Rentabilidad.';

comment on function public.guardar_lista_precios(uuid,text,text,numeric,timestamp with time zone) is
  'F-PRE-14: crea (p_id null) o edita una lista de precios. Solo Administrador; 55000 con la bandera listas_precios apagada; PT412 si cambió mientras editabas.';

comment on function public.guardar_variantes_producto(uuid,timestamp with time zone,jsonb) is
  'F-CAT-15: reemplaza las variantes de un producto (idempotente, atómico; una fila sin id cuyo código ya es de una variante del producto la actualiza, para que un reintento no duplique). Exige edición en productos (42501); PT404 producto inexistente; PT412 si el producto cambió (el 40001 con detail stock sigue igual); 23505 código o código de barras repetido (con el valor); 22023 formato EAN-13, nombre vacío, variantes faltantes o primera variante sobre producto con stock. Una fila con stock distinto del actual exige edición en Stock y registra un ajuste «Conteo de inventario». Evento producto.variantes_editadas solo con cambio real.';

comment on function public.mover_productos_categoria(uuid[],uuid) is
  'F-CAT-12: mueve de 1 a 100 productos a una categoría (atómica e idempotente). Exige edición en productos; 22023 lista vacía, más de 100 o categoría nula; P0002 producto inexistente; PT404 categoría inexistente. Devuelve cuántos cambiaron.';

comment on function public.previsualizar_cotizacion(uuid) is
  'F-PRE-03/F-PRE-06/F-PRE-08: vista previa de la cotización pendiente (de la organización o de p_empresa): variación y umbral medidos contra la cotización aplicada; precios por empresa y muestra hoy/nuevo (productos en USD y productos con precio propio en USD, por empresa) con el redondeo configurado. No escribe. 42501 sin edición en cotizacion_dolar, PT404 sin_cotizacion_pendiente o empresa ajena, 22023 falta empresa.';
