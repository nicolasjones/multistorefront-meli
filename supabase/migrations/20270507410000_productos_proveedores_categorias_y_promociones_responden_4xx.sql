-- Lote 62 (MSF-654 y MSF-655, sexta ola de la convención de códigos de negocio mapeados a 4xx; ver docs/errores-negocio-postgrest.md): las RPC de
-- Productos, Categorías, Proveedores y Promociones de precio dejan de contestar HTTP 500 cuando el dato no existe (`P0002`) o lo editó
-- otra persona (`40001`). Misma regla que 20270507340000, 20270507350000 y 20270507360000: «no existe / no es de tu organización» pasa a
-- `PT404` (HTTP 404) y el conflicto de edición (bloqueo optimista por `updated_at`) a `PT412` (HTTP 412). Mensaje de negocio idéntico.
-- Las funciones migradas están en la tabla por ola de docs/errores-negocio-postgrest.md.
--
-- Cada función parte de su definición VIGENTE (indicada sobre ella; ninguna fue reescrita in situ por un barrido posterior) y solo cambia
-- el errcode de esos rechazos: mensajes, cuerpo, firma, `security`, `search_path` y grants son los mismos (`create or replace`
-- conserva privilegios y comentario). Ninguna es llamable por `anon` ni la consumen Kestra, workers o Edge Functions: solo la web (el
-- script de datos de demostración las llama sin leer el código de error). Quedan fuera `guardar_variantes_producto` (su rechazo de
-- stock usa `40001` con `detail = 'stock'`, un contrato propio), `55000` y los demás códigos.
--
-- Además actualiza los `comment on function` que nombraban `40001` o `P0002` como código de esos rechazos.
--
-- Migración aditiva (create or replace). Reversión: volver a aplicar la definición vigente indicada sobre cada función y sus comentarios
-- anteriores (en el cuerpo, `errcode = 'PT404'` vuelve a `'P0002'` y `errcode = 'PT412'` a `'40001'`). El cliente acepta los dos códigos.

-- actualizar_producto: definición vigente en 20270507210100_actualizar_producto_borrar_costo.sql
create or replace function public.actualizar_producto(
  p_id uuid,
  p_actualizado_en timestamptz,
  p_nombre text,
  p_descripcion text,
  p_sku text,
  p_compatible_con text[],
  p_moneda text,
  p_precio_lista numeric,
  p_costo numeric default null,
  p_proveedor_id uuid default null,
  p_codigo_proveedor text default null,
  p_cambiar_proveedor boolean default false,
  p_codigo_barras text default null,
  p_cambiar_codigo_barras boolean default false,
  p_disponibilidad_manual text default null,
  p_cambiar_disponibilidad boolean default false,
  p_borrar_costo boolean default false
)
returns dominio.productos
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actual dominio.productos;
  v_fila dominio.productos;
  v_costo_cambio boolean := false;
  v_filas integer;
begin
  if (select private.organizacion_id()) is null or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede editar productos' using errcode = '42501';
  end if;
  if (p_costo is not null or coalesce(p_borrar_costo, false))
     and (select private.nivel_seccion('rentabilidad')) <> 'edicion' then
    raise exception 'Tu rol no puede cargar el costo' using errcode = '42501';
  end if;
  if coalesce(p_borrar_costo, false) and p_costo is not null then
    raise exception 'No se puede cargar y borrar el costo a la vez' using errcode = '22023';
  end if;

  if btrim(coalesce(p_nombre, '')) = '' then
    raise exception 'El nombre del producto es obligatorio' using errcode = '22023';
  end if;
  if coalesce(p_cambiar_proveedor, false) and p_codigo_proveedor is not null and btrim(p_codigo_proveedor) <> '' and p_proveedor_id is null then
    raise exception 'El código del proveedor requiere elegir un proveedor' using errcode = '22023';
  end if;
  if nullif(btrim(p_codigo_barras), '') is not null and btrim(p_codigo_barras) !~ '^[0-9]{13}$' then
    raise exception 'El código de barras debe tener 13 dígitos' using errcode = '22023';
  end if;
  if p_disponibilidad_manual is not null and p_disponibilidad_manual not in ('a_pedido', 'stock_entrante') then
    raise exception 'La disponibilidad solo puede ser A pedido o Stock entrante en breve' using errcode = '22023';
  end if;
  if p_moneda is null or p_moneda not in ('USD', 'ARS') then
    raise exception 'La moneda debe ser USD o ARS' using errcode = '22023';
  end if;
  if p_precio_lista is null or p_precio_lista <= 0 or p_precio_lista <> round(p_precio_lista, 2) then
    raise exception 'El precio de lista debe ser mayor a cero y tener hasta 2 decimales' using errcode = '22023';
  end if;
  if p_costo is not null and (p_costo < 0 or p_costo <> round(p_costo, 2)) then
    raise exception 'El costo no puede ser negativo y admite hasta 2 decimales' using errcode = '22023';
  end if;

  -- Serializa ediciones concurrentes del mismo producto; RLS acota a la organización.
  select * into v_actual from dominio.productos where id = p_id for update;
  if not found then
    raise exception 'El producto no existe' using errcode = 'PT404';
  end if;
  if p_actualizado_en is null or v_actual.updated_at <> p_actualizado_en then
    raise exception 'El producto fue modificado por otra persona' using errcode = 'PT412';
  end if;

  if p_costo is not null then
    insert into dominio.producto_costos as c (producto_id, organizacion_id, costo)
    values (p_id, v_actual.organizacion_id, p_costo)
    on conflict (producto_id) do update set costo = excluded.costo
      where c.costo is distinct from excluded.costo;
    get diagnostics v_filas = row_count;
    v_costo_cambio := v_filas > 0;
  elsif coalesce(p_borrar_costo, false) then
    -- «Vaciar» el costo lo borra (un costo nulo = «sin cambio» no lo distinguía de «no se envió»).
    v_costo_cambio := private.borrar_costo_producto(p_id, v_actual.organizacion_id);
  end if;

  -- Avisa al disparador de updated_at que un cambio de costo cuenta como cambio real.
  perform set_config('catalogo.costo_cambio', case when v_costo_cambio then 'on' else 'off' end, true);

  update dominio.productos
     set nombre = p_nombre,
         descripcion = p_descripcion,
         sku = p_sku,
         compatible_con = coalesce(p_compatible_con, '{}'),
         moneda = p_moneda,
         precio_lista = p_precio_lista,
         proveedor_id = case when coalesce(p_cambiar_proveedor, false) then p_proveedor_id else proveedor_id end,
         codigo_proveedor = case when coalesce(p_cambiar_proveedor, false) then p_codigo_proveedor else codigo_proveedor end,
         codigo_barras = case when coalesce(p_cambiar_codigo_barras, false) then nullif(btrim(p_codigo_barras), '') else codigo_barras end,
         disponibilidad_manual = case when coalesce(p_cambiar_disponibilidad, false) then p_disponibilidad_manual else disponibilidad_manual end
   where id = p_id
  returning * into v_fila;
  if not found then
    raise exception 'El producto no existe' using errcode = 'PT404';
  end if;

  perform set_config('catalogo.costo_cambio', 'off', true);
  return v_fila;
end;
$$;

-- cambiar_estado_producto: definición vigente en 20261017120600_catalogo_cambiar_estado.sql
create or replace function public.cambiar_estado_producto(p_id uuid, p_activo boolean)
returns dominio.productos
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_fila dominio.productos;
begin
  if (select private.organizacion_id()) is null or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede cambiar el estado de los productos' using errcode = '42501';
  end if;
  if p_activo is null then
    raise exception 'El estado es obligatorio' using errcode = '22023';
  end if;

  -- Serializa cambios concurrentes del mismo producto; RLS acota a la organización.
  select * into v_fila from dominio.productos where id = p_id for update;
  if not found then
    raise exception 'El producto no existe' using errcode = 'PT404';
  end if;
  if v_fila.activo = p_activo then
    return v_fila;
  end if;

  update dominio.productos set activo = p_activo where id = p_id returning * into v_fila;
  return v_fila;
end;
$$;

-- definir_empresas_producto: definición vigente en 20261020130101_catalogo_producto_empresa_rpc.sql
create or replace function public.definir_empresas_producto(p_producto_id uuid, p_empresa_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_ids uuid[];
  v_total integer;
begin
  if v_org is null or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede editar productos' using errcode = '42501';
  end if;

  if not exists (
    select 1 from dominio.productos p where p.id = p_producto_id and p.organizacion_id = v_org
  ) then
    raise exception 'El producto no existe' using errcode = 'PT404';
  end if;

  if exists (select 1 from unnest(coalesce(p_empresa_ids, '{}'::uuid[])) as x(id) where x.id is null) then
    raise exception 'La lista de empresas tiene valores vacíos' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct x.id), '{}'::uuid[]) into v_ids
    from unnest(coalesce(p_empresa_ids, '{}'::uuid[])) as x(id);

  if exists (
    select 1 from unnest(v_ids) as x(id)
     where not exists (
       select 1 from dominio.empresas e where e.id = x.id and e.organizacion_id = v_org
     )
  ) then
    raise exception 'Alguna de las empresas no existe o no pertenece a tu organización' using errcode = '22023';
  end if;

  -- Serializa dos guardados simultáneos del mismo producto (delta consistente).
  perform pg_advisory_xact_lock(hashtextextended('producto_empresa:' || p_producto_id::text, 0));

  -- Marca la transacción para que los triggers combinen alta y baja en un solo evento.
  perform set_config('catalogo.pe_producto', p_producto_id::text, true);
  perform set_config('catalogo.pe_agregadas', '', true);

  insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
  select p_producto_id, x.id, v_org
    from unnest(v_ids) as x(id)
   where not exists (
     select 1 from dominio.producto_empresa pe
      where pe.producto_id = p_producto_id and pe.empresa_id = x.id
   );

  -- Corre siempre (aunque no borre filas): el trigger de baja emite el evento combinado.
  delete from dominio.producto_empresa pe
   where pe.producto_id = p_producto_id and pe.empresa_id <> all (v_ids);

  perform set_config('catalogo.pe_producto', '', true);
  perform set_config('catalogo.pe_agregadas', '', true);

  select count(*)::integer into v_total from dominio.producto_empresa pe where pe.producto_id = p_producto_id;
  return v_total;
end;
$$;

-- asignar_categoria_producto: definición vigente en 20270507140000_categorias_baja_candado_orden_y_permiso.sql
create or replace function public.asignar_categoria_producto(p_producto_id uuid, p_categoria_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede editar productos' using errcode = '42501';
  end if;
  if p_categoria_id is not null and (select private.nivel_seccion('categorias')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver categorías, así que no puede asignarlas' using errcode = '42501';
  end if;
  if not exists (select 1 from dominio.productos p where p.id = p_producto_id and p.organizacion_id = v_org) then
    raise exception 'El producto no existe' using errcode = 'PT404';
  end if;
  if p_categoria_id is not null and not exists (
    select 1 from dominio.categorias c where c.id = p_categoria_id and c.organizacion_id = v_org
  ) then
    raise exception 'La categoría no existe' using errcode = 'PT404';
  end if;

  -- Solo si cambia: repetir la misma categoría no escribe ni deja evento (idempotente).
  update dominio.productos p
     set categoria_id = p_categoria_id
   where p.id = p_producto_id and p.organizacion_id = v_org
     and p.categoria_id is distinct from p_categoria_id;

  return p_categoria_id;
end;
$$;

-- guardar_relacionados: definición vigente en 20270220120100_catalogo_relacionados.sql
create or replace function public.guardar_relacionados(p_producto uuid, p_relacionados uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_ids uuid[] := coalesce(p_relacionados, '{}'::uuid[]);
  v_antes uuid[];
  v_producto dominio.productos;
  v_actor uuid := (select auth.uid());
begin
  if v_org is null or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede editar productos' using errcode = '42501';
  end if;

  select * into v_producto from dominio.productos p where p.id = p_producto and p.organizacion_id = v_org;
  if not found then
    raise exception 'El producto no existe' using errcode = 'PT404';
  end if;

  if exists (select 1 from unnest(v_ids) as x(id) where x.id is null) then
    raise exception 'La lista de relacionados tiene valores vacíos' using errcode = '22023';
  end if;
  if p_producto = any (v_ids) then
    raise exception 'Un producto no puede relacionarse consigo mismo' using errcode = '22023';
  end if;
  if (select count(*) from unnest(v_ids)) <> (select count(distinct x.id) from unnest(v_ids) as x(id)) then
    raise exception 'La lista de relacionados repite un producto' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_ids) as x(id)
     where not exists (select 1 from dominio.productos r where r.id = x.id and r.organizacion_id = v_org)
  ) then
    raise exception 'Alguno de los productos relacionados no existe' using errcode = 'PT404';
  end if;

  -- Serializa dos guardados simultáneos del mismo producto.
  perform pg_advisory_xact_lock(hashtextextended('producto_relacionados:' || p_producto::text, 0));

  select coalesce(array_agg(r.relacionado_id order by r.orden), '{}'::uuid[]) into v_antes
    from dominio.producto_relacionados r where r.producto_id = p_producto;

  if v_antes is distinct from v_ids then
    delete from dominio.producto_relacionados r
     where r.producto_id = p_producto and r.relacionado_id <> all (v_ids);

    insert into dominio.producto_relacionados (producto_id, relacionado_id, organizacion_id, orden)
    select p_producto, x.id, v_org, x.pos::integer
      from unnest(v_ids) with ordinality as x(id, pos)
    on conflict (producto_id, relacionado_id) do update set orden = excluded.orden;

    -- Evento solo con cambio real y con sesión; sin precios ni costo.
    if v_actor is not null then
      perform private.registrar_actividad(
        'producto.relacionados_editados',
        format('Cambió los productos relacionados de %s%s: %s',
          v_producto.nombre,
          case when v_producto.sku is null then '' else format(' (SKU %s)', v_producto.sku) end,
          case when cardinality(v_ids) = 0 then 'quitó todos'
               else (select string_agg(r.nombre, ', ' order by x.pos)
                       from unnest(v_ids) with ordinality as x(id, pos)
                       join dominio.productos r on r.id = x.id) end),
        null
      );
    end if;
  end if;

  return jsonb_build_object(
    'relacionados',
    coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'orden', x.pos) order by x.pos)
                from unnest(v_ids) with ordinality as x(id, pos)), '[]'::jsonb)
  );
end;
$$;

-- guardar_categoria: definición vigente en 20270507200200_categorias_validar_niveles_tolerante.sql
CREATE OR REPLACE FUNCTION public.guardar_categoria(p_id uuid, p_nombre text, p_padre_id uuid, p_empresa_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_ids uuid[];
  v_id uuid := p_id;
  v_actual dominio.categorias;
  v_posicion integer;
  v_cambio_empresas boolean := false;
begin
  if v_org is null or (select private.nivel_seccion('categorias')) <> 'edicion' then
    raise exception 'Tu rol no puede editar categorías' using errcode = '42501';
  end if;
  if v_nombre = '' then
    raise exception 'El nombre es obligatorio' using errcode = '22023';
  end if;
  if length(v_nombre) > 100 then
    raise exception 'El nombre admite hasta 100 caracteres' using errcode = '22023';
  end if;

  if exists (select 1 from unnest(coalesce(p_empresa_ids, '{}'::uuid[])) as x(id) where x.id is null) then
    raise exception 'La lista de empresas tiene valores vacíos' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct x.id), '{}'::uuid[]) into v_ids
    from unnest(coalesce(p_empresa_ids, '{}'::uuid[])) as x(id);
  if exists (
    select 1 from unnest(v_ids) as x(id)
     where not exists (select 1 from dominio.empresas e where e.id = x.id and e.organizacion_id = v_org)
  ) then
    raise exception 'Alguna de las empresas no existe o no pertenece a tu organización' using errcode = '22023';
  end if;

  -- Serializa con cualquier otra escritura de categorías de la organización.
  perform pg_advisory_xact_lock(hashtextextended('categorias:' || v_org::text, 0));

  if p_padre_id is not null and not exists (
    select 1 from dominio.categorias c where c.id = p_padre_id and c.organizacion_id = v_org
  ) then
    raise exception 'La categoría padre no existe' using errcode = 'PT404';
  end if;

  begin
    if p_id is null then
      select coalesce(max(c.posicion) + 1, 0) into v_posicion
        from dominio.categorias c
       where c.organizacion_id = v_org and c.padre_id is not distinct from p_padre_id;
      insert into dominio.categorias (organizacion_id, nombre, padre_id, posicion)
      values (v_org, v_nombre, p_padre_id, v_posicion)
      returning id into v_id;
      insert into dominio.categorias_empresa (categoria_id, empresa_id, organizacion_id)
      select v_id, x.id, v_org from unnest(v_ids) as x(id);
    else
      select * into v_actual from dominio.categorias c where c.id = p_id and c.organizacion_id = v_org;
      if not found then
        raise exception 'La categoría no existe' using errcode = 'PT404';
      end if;
      v_posicion := v_actual.posicion;
      if v_actual.padre_id is distinct from p_padre_id then
        -- Cambia de nivel: va al final de su nuevo nivel.
        select coalesce(max(c.posicion) + 1, 0) into v_posicion
          from dominio.categorias c
         where c.organizacion_id = v_org and c.padre_id is not distinct from p_padre_id;
      end if;

      -- Visibilidad: calcula el delta contra el estado actual (idempotente).
      delete from dominio.categorias_empresa ce
       where ce.categoria_id = p_id and ce.empresa_id <> all (v_ids);
      if found then v_cambio_empresas := true; end if;
      insert into dominio.categorias_empresa (categoria_id, empresa_id, organizacion_id)
      select p_id, x.id, v_org
        from unnest(v_ids) as x(id)
       where not exists (
         select 1 from dominio.categorias_empresa ce where ce.categoria_id = p_id and ce.empresa_id = x.id
       );
      if found then v_cambio_empresas := true; end if;

      if v_cambio_empresas then
        perform set_config('catalogo.cat_visibilidad', p_id::text, true);
      end if;
      update dominio.categorias
         set nombre = v_nombre, padre_id = p_padre_id, posicion = v_posicion
       where id = p_id;
      perform set_config('catalogo.cat_visibilidad', '', true);
    end if;
    -- Valida los 2 niveles ahora para fallar con el mensaje claro (no recién en el commit).
    if exists (select 1 from pg_constraint where conrelid = 'dominio.categorias'::regclass and conname = 'categorias_dos_niveles') then
      set constraints dominio.categorias_dos_niveles immediate;
    elsif exists (select 1 from pg_constraint where conrelid = 'dominio.categorias'::regclass and conname = 'categorias_tres_niveles') then
      set constraints dominio.categorias_tres_niveles immediate;
    end if;
  exception when unique_violation then
    raise exception 'Ya existe una categoría con ese nombre en ese nivel' using errcode = '23505';
  end;

  return v_id;
end;
$function$

;

-- eliminar_categoria: definición vigente en 20270507200200_categorias_validar_niveles_tolerante.sql
CREATE OR REPLACE FUNCTION public.eliminar_categoria(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_actual dominio.categorias;
  v_productos integer;
  v_hijos integer;
  v_base integer;
begin
  if v_org is null or (select private.nivel_seccion('categorias')) <> 'edicion' then
    raise exception 'Tu rol no puede editar categorías' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('categorias:' || v_org::text, 0));

  select * into v_actual from dominio.categorias c where c.id = p_id and c.organizacion_id = v_org;
  if not found then
    raise exception 'La categoría no existe' using errcode = 'PT404';
  end if;

  select count(*)::integer into v_productos from dominio.productos p
   where p.categoria_id = p_id and p.organizacion_id = v_org;
  select count(*)::integer into v_hijos from dominio.categorias c
   where c.padre_id = p_id and c.organizacion_id = v_org;

  -- Las subcategorías suben a raíz: no pueden chocar con el nombre de otra raíz.
  if exists (
    select 1
      from dominio.categorias h
      join dominio.categorias r
        on r.organizacion_id = h.organizacion_id and r.padre_id is null and r.id <> p_id
       and lower(btrim(r.nombre)) = lower(btrim(h.nombre))
     where h.padre_id = p_id and h.organizacion_id = v_org
  ) then
    raise exception 'No se puede eliminar: una subcategoría tiene el mismo nombre que otra categoría raíz. Renombrala primero.'
      using errcode = '23505';
  end if;

  perform set_config('catalogo.cat_ctx', 'eliminar', true);
  perform set_config(
    'catalogo.cat_eliminada_info',
    format('%s sin categoría; %s a raíz',
      case when v_productos = 1 then '1 producto quedó' else v_productos || ' productos quedaron' end,
      case when v_hijos = 1 then '1 subcategoría subió' else v_hijos || ' subcategorías subieron' end),
    true
  );

  select coalesce(max(c.posicion), -1) into v_base
    from dominio.categorias c where c.organizacion_id = v_org and c.padre_id is null;
  update dominio.categorias h
     set padre_id = null, posicion = v_base + x.rn
    from (
      select c.id, row_number() over (order by c.posicion, lower(c.nombre), c.id)::integer as rn
        from dominio.categorias c where c.padre_id = p_id and c.organizacion_id = v_org
    ) x
   where h.id = x.id;

  -- Nota: el conteo de productos del evento se hace bajo el RLS de quien llama (sin lectura en
  -- `productos` el resumen diría 0); la desasignación sí ocurre por la FK.
  -- Los productos quedan sin categoría por `on delete set null (categoria_id)`.
  delete from dominio.categorias where id = p_id and organizacion_id = v_org;
  if exists (select 1 from pg_constraint where conrelid = 'dominio.categorias'::regclass and conname = 'categorias_dos_niveles') then
    set constraints dominio.categorias_dos_niveles immediate;
  elsif exists (select 1 from pg_constraint where conrelid = 'dominio.categorias'::regclass and conname = 'categorias_tres_niveles') then
    set constraints dominio.categorias_tres_niveles immediate;
  end if;

  perform set_config('catalogo.cat_ctx', '', true);
  perform set_config('catalogo.cat_eliminada_info', '', true);

  return jsonb_build_object('productos', v_productos, 'subcategorias', v_hijos);
end;
$function$

;

-- reordenar_categorias: definición vigente en 20270507200200_categorias_validar_niveles_tolerante.sql
CREATE OR REPLACE FUNCTION public.reordenar_categorias(p_orden jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_cambios integer;
  v_total integer;
  v_distintos integer;
  v_validos integer;
begin
  if v_org is null or (select private.nivel_seccion('categorias')) <> 'edicion' then
    raise exception 'Tu rol no puede editar categorías' using errcode = '42501';
  end if;
  if p_orden is null or jsonb_typeof(p_orden) <> 'array' then
    raise exception 'El orden debe ser una lista de categorías' using errcode = '22023';
  end if;
  if jsonb_array_length(p_orden) > 5000 then
    raise exception 'El orden admite hasta 5000 categorías por vez' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('categorias:' || v_org::text, 0));

  begin
    select count(*), count(distinct x.id),
           count(*) filter (where x.id is not null and x.posicion is not null and x.posicion >= 0)
      into v_total, v_distintos, v_validos
      from jsonb_to_recordset(p_orden) as x(id uuid, padre_id uuid, posicion integer);
  exception when invalid_text_representation or numeric_value_out_of_range or datatype_mismatch then
    raise exception 'El orden tiene valores inválidos' using errcode = '22023';
  end;
  if v_total <> v_validos or v_total <> v_distintos then
    raise exception 'El orden tiene categorías repetidas o valores inválidos' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_orden) as x(id uuid, padre_id uuid, posicion integer)
     where not exists (select 1 from dominio.categorias c where c.id = x.id and c.organizacion_id = v_org)
        or (x.padre_id is not null
            and not exists (select 1 from dominio.categorias c where c.id = x.padre_id and c.organizacion_id = v_org))
  ) then
    raise exception 'Alguna categoría no existe' using errcode = 'PT404';
  end if;

  begin
    perform set_config('catalogo.cat_ctx', 'reordenar', true);
    -- Una sola sentencia: un solo evento de Actividad y los 2 niveles se validan sobre el estado final.
    update dominio.categorias c
       set padre_id = x.padre_id, posicion = x.posicion
      from jsonb_to_recordset(p_orden) as x(id uuid, padre_id uuid, posicion integer)
     where c.id = x.id
       and c.organizacion_id = v_org
       and (c.padre_id is distinct from x.padre_id or c.posicion <> x.posicion);
    get diagnostics v_cambios = row_count;
    if exists (select 1 from pg_constraint where conrelid = 'dominio.categorias'::regclass and conname = 'categorias_dos_niveles') then
      set constraints dominio.categorias_dos_niveles immediate;
    elsif exists (select 1 from pg_constraint where conrelid = 'dominio.categorias'::regclass and conname = 'categorias_tres_niveles') then
      set constraints dominio.categorias_tres_niveles immediate;
    end if;
    perform set_config('catalogo.cat_ctx', '', true);
  exception when unique_violation then
    raise exception 'Ya existe una categoría con ese nombre en ese nivel' using errcode = '23505';
  end;

  return v_cambios;
end;
$function$

;

-- actualizar_proveedor: definición vigente en 20261018190100_proveedores_rpc.sql
create or replace function public.actualizar_proveedor(
  p_id uuid,
  p_actualizado_en timestamptz,
  p_razon_social text,
  p_cuit text,
  p_persona_contacto text default null,
  p_correo text default null,
  p_telefono text default null,
  p_direccion text default null,
  p_observaciones text default null
)
returns dominio.proveedores
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actual dominio.proveedores;
  v_fila dominio.proveedores;
begin
  if (select private.organizacion_id()) is null or (select private.nivel_seccion('proveedores')) <> 'edicion' then
    raise exception 'Tu rol no puede editar proveedores' using errcode = '42501';
  end if;
  if btrim(coalesce(p_razon_social, '')) = '' then
    raise exception 'La razón social es obligatoria' using errcode = '22023';
  end if;
  if btrim(coalesce(p_cuit, '')) = '' then
    raise exception 'El CUIT es obligatorio' using errcode = '22023';
  end if;

  -- Serializa ediciones concurrentes del mismo proveedor; RLS acota a la organización.
  select * into v_actual from dominio.proveedores where id = p_id for update;
  if not found then
    raise exception 'El proveedor no existe' using errcode = 'PT404';
  end if;
  if p_actualizado_en is null or v_actual.updated_at <> p_actualizado_en then
    raise exception 'El proveedor fue modificado por otra persona' using errcode = 'PT412';
  end if;

  update dominio.proveedores
     set razon_social = p_razon_social,
         cuit = p_cuit,
         persona_contacto = p_persona_contacto,
         correo = p_correo,
         telefono = p_telefono,
         direccion = p_direccion,
         observaciones = p_observaciones
   where id = p_id
  returning * into v_fila;
  return v_fila;
end;
$$;

-- cambiar_estado_proveedor: definición vigente en 20261018190100_proveedores_rpc.sql
create or replace function public.cambiar_estado_proveedor(p_id uuid, p_activo boolean)
returns dominio.proveedores
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_fila dominio.proveedores;
begin
  if (select private.organizacion_id()) is null or (select private.nivel_seccion('proveedores')) <> 'edicion' then
    raise exception 'Tu rol no puede cambiar el estado de los proveedores' using errcode = '42501';
  end if;
  if p_activo is null then
    raise exception 'El estado es obligatorio' using errcode = '22023';
  end if;

  select * into v_fila from dominio.proveedores where id = p_id for update;
  if not found then
    raise exception 'El proveedor no existe' using errcode = 'PT404';
  end if;
  if v_fila.activo = p_activo then
    return v_fila;
  end if;

  update dominio.proveedores set activo = p_activo where id = p_id returning * into v_fila;
  return v_fila;
end;
$$;

-- guardar_promocion_precio: definición vigente en 20270433000000_promocion_precio_no_menor_al_normal.sql
create or replace function public.guardar_promocion_precio(
  p_id uuid,
  p_empresa uuid,
  p_producto uuid,
  p_precio numeric,
  p_desde timestamptz,
  p_hasta timestamptz,
  p_actualizado timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_precio numeric(14, 2);
  v_actual dominio.promociones_precio;
  v_fila dominio.promociones_precio;
begin
  if v_organizacion is null or v_actor is null
     or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede editar promociones de precio' using errcode = '42501';
  end if;
  -- Bandera de apagado (MSF-363, decisión 15): con las promociones apagadas no se programa ni edita ninguna.
  if not (select private.bandera_activa('promociones_precio')) then
    raise exception 'Las promociones de precio están desactivadas en este entorno' using errcode = '55000';
  end if;
  if p_empresa is null or p_producto is null then
    raise exception 'Elegí la empresa y el producto' using errcode = '22023';
  end if;
  if p_precio is null or p_precio <= 0 then
    raise exception 'El precio promocional debe ser mayor a 0' using errcode = '22023';
  end if;
  if abs(p_precio) >= 1e12 then
    raise exception 'El precio promocional es demasiado grande' using errcode = '22003';
  end if;
  v_precio := round(p_precio, 2);
  if v_precio <= 0 then
    raise exception 'El precio promocional debe ser mayor a 0' using errcode = '22023';
  end if;
  if p_desde is null or p_hasta is null then
    raise exception 'Indicá desde y hasta cuándo rige la promoción' using errcode = '22023';
  end if;
  if p_hasta <= p_desde then
    raise exception 'La fecha de fin tiene que ser posterior a la de inicio' using errcode = '22023';
  end if;

  if not exists (
    select 1 from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_organizacion
  ) then
    raise exception 'La empresa no existe en tu organización' using errcode = 'PT404';
  end if;
  -- Hallazgo de la revisión de MSF-363: además de ser de la organización, la tienda debe ser accesible y la persona
  -- debe poder editar `productos` EN ELLA (el nivel global es el más alto entre sus tiendas).
  if (select private.nivel_productos_en_empresa(p_empresa)) <> 'edicion' then
    raise exception 'Tu rol no puede editar promociones de precio en esa tienda' using errcode = '42501';
  end if;
  if not exists (
    select 1 from dominio.productos p where p.id = p_producto and p.organizacion_id = v_organizacion
  ) then
    raise exception 'El producto no existe en tu organización' using errcode = 'PT404';
  end if;

  if p_id is null then
    -- Idempotencia del alta: la misma promoción activa ya cargada se devuelve tal cual.
    select * into v_fila
      from dominio.promociones_precio x
     where x.organizacion_id = v_organizacion and x.empresa_id = p_empresa and x.producto_id = p_producto
       and x.anulada_at is null and x.precio_promocional = v_precio
       and x.desde = p_desde and x.hasta = p_hasta;
    if found then
      return private.promocion_con_aviso(to_jsonb(v_fila), p_empresa, p_producto, v_precio);
    end if;

    if p_hasta <= now() then
      raise exception 'La promoción ya venció: la fecha de fin tiene que ser futura' using errcode = '22023';
    end if;

    insert into dominio.promociones_precio (organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta)
    values (v_organizacion, p_empresa, p_producto, v_precio, p_desde, p_hasta)
    returning * into v_fila;

    perform private.insertar_actividad(
      v_organizacion, v_actor, 'promocion_precio.programada',
      'Programó la promoción de ' || private.describir_promocion_precio(v_fila.id), p_empresa
    );
    return private.promocion_con_aviso(to_jsonb(v_fila), p_empresa, p_producto, v_precio);
  end if;

  -- Primero sin lock: quien no puede editar `productos` en la tienda de la promoción no la bloquea ni distingue
  -- «otra tienda» (22023) de «no es tuya» (42501); recién con permiso se toma el lock y se relee.
  select * into v_actual
    from dominio.promociones_precio x
   where x.id = p_id and x.organizacion_id = v_organizacion;
  if not found then
    raise exception 'La promoción no existe' using errcode = 'PT404';
  end if;
  if (select private.nivel_productos_en_empresa(v_actual.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede editar promociones de precio en esa tienda' using errcode = '42501';
  end if;
  select * into v_actual
    from dominio.promociones_precio x
   where x.id = p_id and x.organizacion_id = v_organizacion
     for update;
  if not found then
    raise exception 'La promoción no existe' using errcode = 'PT404';
  end if;
  if v_actual.empresa_id <> p_empresa or v_actual.producto_id <> p_producto then
    raise exception 'No se puede cambiar la empresa ni el producto de una promoción: anulala y creá otra'
      using errcode = '22023';
  end if;

  -- Guardar lo que ya está guardado es idempotente (también tras anular o vencer).
  if (v_actual.precio_promocional, v_actual.desde, v_actual.hasta) is not distinct from (v_precio, p_desde, p_hasta) then
    return private.promocion_con_aviso(to_jsonb(v_actual), p_empresa, p_producto, v_precio);
  end if;

  if v_actual.anulada_at is not null then
    raise exception 'La promoción está anulada y no se puede editar' using errcode = '22023';
  end if;
  if v_actual.hasta <= now() then
    raise exception 'La promoción ya venció y no se puede editar' using errcode = '22023';
  end if;
  if v_actual.updated_at is distinct from p_actualizado then
    raise exception 'La promoción fue modificada por otra persona' using errcode = 'PT412';
  end if;
  if p_hasta <= now() then
    raise exception 'La fecha de fin tiene que ser futura' using errcode = '22023';
  end if;

  update dominio.promociones_precio
     set precio_promocional = v_precio, desde = p_desde, hasta = p_hasta
   where id = p_id
  returning * into v_fila;

  perform private.insertar_actividad(
    v_organizacion, v_actor, 'promocion_precio.actualizada',
    'Actualizó la promoción de ' || private.describir_promocion_precio(v_fila.id), p_empresa
  );
  return private.promocion_con_aviso(to_jsonb(v_fila), p_empresa, p_producto, v_precio);
end;
$$;

-- anular_promocion_precio: definición vigente en 20270225100000_promociones_precio_permiso_antes_del_lock.sql
create or replace function public.anular_promocion_precio(p_id uuid, p_actualizado timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_actual dominio.promociones_precio;
  v_fila dominio.promociones_precio;
begin
  if v_organizacion is null or v_actor is null
     or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede anular promociones de precio' using errcode = '42501';
  end if;

  -- Permiso en la tienda de la promoción ANTES de bloquear la fila (sin lock no hay señal de existencia por espera).
  select * into v_actual
    from dominio.promociones_precio x
   where x.id = p_id and x.organizacion_id = v_organizacion;
  if not found then
    raise exception 'La promoción no existe' using errcode = 'PT404';
  end if;
  if (select private.nivel_productos_en_empresa(v_actual.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede anular promociones de precio de esa tienda' using errcode = '42501';
  end if;
  select * into v_actual
    from dominio.promociones_precio x
   where x.id = p_id and x.organizacion_id = v_organizacion
     for update;
  if not found then
    raise exception 'La promoción no existe' using errcode = 'PT404';
  end if;

  -- Idempotente: anular una ya anulada devuelve la fila sin evento.
  if v_actual.anulada_at is not null then
    return to_jsonb(v_actual);
  end if;
  if v_actual.hasta <= now() then
    raise exception 'La promoción ya venció: no hace falta anularla' using errcode = '22023';
  end if;
  if v_actual.updated_at is distinct from p_actualizado then
    raise exception 'La promoción fue modificada por otra persona' using errcode = 'PT412';
  end if;

  update dominio.promociones_precio set anulada_at = clock_timestamp() where id = p_id
  returning * into v_fila;

  perform private.insertar_actividad(
    v_organizacion, v_actor, 'promocion_precio.anulada',
    'Anuló la promoción de ' || private.describir_promocion_precio(v_fila.id), v_fila.empresa_id
  );
  return to_jsonb(v_fila);
end;
$$;

comment on function public.actualizar_producto(uuid, timestamptz, text, text, text, text[], text, numeric, numeric, uuid, text, boolean, text, boolean, text, boolean, boolean) is
  'F-CAT-04: edita un producto con bloqueo optimista por updated_at (PT412 ante conflicto); costo solo con edición en Rentabilidad, nulo = sin cambio, p_borrar_costo = true lo borra (MSF-723). F-PRV-03: proveedor y código solo cambian con p_cambiar_proveedor = true. MSF-529: el código de barras solo cambia con p_cambiar_codigo_barras = true. F-CAT-17: la disponibilidad manual solo cambia con p_cambiar_disponibilidad = true.';
comment on function public.definir_empresas_producto(uuid, uuid[]) is
  'F-CAT-07: reemplaza el conjunto de empresas que venden un producto (atómica e idempotente). Exige edición en productos; 22023 empresa ajena, PT404 producto inexistente. Devuelve cuántas empresas quedan.';
comment on function public.asignar_categoria_producto(uuid, uuid) is
  'F-CAT-08: asigna (o quita, con null) la categoría de un producto. Exige edición en productos y, para asignar, lectura de categorías (42501); PT404 producto o categoría inexistentes. Idempotente.';
comment on function public.guardar_relacionados(uuid, uuid[]) is
  'F-CAT-18: reemplaza la lista ordenada de relacionados de un producto (atómica e idempotente). Exige edición en productos (42501); PT404 producto o relacionado inexistente/otra organización; 22023 el propio producto, un id repetido o vacío. Evento producto.relacionados_editados solo con cambio real.';
comment on function public.guardar_categoria(uuid, text, uuid, uuid[]) is
  'F-CAT-08: crea (p_id nulo) o edita una categoría con su visibilidad por tienda. Exige edición en categorias; 22023 datos inválidos, PT404 inexistente, 23505 nombre repetido en el nivel, 23514 más de 2 niveles. Devuelve el id.';
comment on function public.actualizar_proveedor(uuid, timestamptz, text, text, text, text, text, text, text) is
  'F-PRV-01: edita un proveedor con bloqueo optimista por updated_at (PT412 ante conflicto); solo con edición en Proveedores.';
comment on function public.anular_promocion_precio(uuid, timestamptz) is
  'F-PRE-11: anula una promoción programada o vigente. Exige productos=edicion; bloqueo optimista por updated_at (PT412); idempotente; una vencida no se anula (22023).';
