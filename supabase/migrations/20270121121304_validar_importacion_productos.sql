-- MSF-375 (F-CAT-10, FR-105, FR-106): validación por fila de una importación de productos.
--
-- Esquemas (Principio VII): solo funciones. Leen `dominio.productos`, `categorias`, `proveedores`,
-- `empresas` y `storage.objects`; no crean ni alteran tablas. Los ayudantes viven en `private`
-- (no alcanzables por PostgREST) y la RPC de la app en `public`.
--
-- Qué es error (la fila se omite) y qué es aviso (la fila se importa igual):
--   error: sku/nombre/categoría vacíos o demasiado largos; categoría inexistente (ruta «A > B»);
--          precios y costo no numéricos, negativos o con más de 2 decimales; precio x1 faltante en un
--          producto nuevo o igual a cero; SKU repetido en la planilla; código de barras con formato
--          inválido, repetido en la planilla o usado por otro producto.
--   aviso: tienda desconocida (se ignora); proveedor desconocido (se ignora); imagen citada con extensión
--          inválida o que no se subió (se importa sin ella); más de 4 imágenes (se usan las 4 primeras);
--          costo sin acceso a Rentabilidad (se ignora).
--
-- Migración aditiva (solo funciones). Reversión (migración posterior):
--   drop function public.validar_importacion_productos(jsonb, uuid);
--   drop function private.validar_filas_importacion_productos(uuid, boolean, jsonb, uuid);
--   drop function private.resolver_proveedor_importacion(uuid, text);
--   drop function private.resolver_tiendas_importacion(uuid, text);
--   drop function private.resolver_categoria_importacion(uuid, text);

-- Ruta «A > B > C» → id de categoría (nulo si algún tramo no existe). Sin distinguir mayúsculas.
create or replace function private.resolver_categoria_importacion(p_org uuid, p_ruta text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tramo text;
  v_id uuid := null;
  v_hay boolean := false;
begin
  for v_tramo in select btrim(t) from unnest(string_to_array(coalesce(p_ruta, ''), '>')) as t loop
    if v_tramo = '' then
      return null;
    end if;
    select c.id into v_id
      from dominio.categorias c
     where c.organizacion_id = p_org
       and lower(btrim(c.nombre)) = lower(v_tramo)
       and c.padre_id is not distinct from (case when v_hay then v_id else null end)
     limit 1;
    if v_id is null then
      return null;
    end if;
    v_hay := true;
  end loop;
  return v_id;
end;
$$;

revoke execute on function private.resolver_categoria_importacion(uuid, text) from public, anon, authenticated;

-- Columna `tiendas`: códigos (o nombres) separados por «|». Devuelve las empresas halladas y los
-- tokens que no corresponden a ninguna.
create or replace function private.resolver_tiendas_importacion(p_org uuid, p_tiendas text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_ids uuid[] := '{}';
  v_desconocidas text[] := '{}';
  v_hallados uuid[];
begin
  for v_token in
    select distinct btrim(t) from unnest(string_to_array(coalesce(p_tiendas, ''), '|')) as t where btrim(t) <> ''
  loop
    select array_agg(e.id) into v_hallados
      from dominio.empresas e
     where e.organizacion_id = p_org
       and (private.codigo_tienda(e.nombre) = upper(v_token) or lower(btrim(e.nombre)) = lower(v_token));
    if v_hallados is null then
      v_desconocidas := v_desconocidas || v_token;
    else
      v_ids := v_ids || v_hallados;
    end if;
  end loop;
  return jsonb_build_object(
    'ids', to_jsonb((select coalesce(array_agg(distinct x), '{}') from unnest(v_ids) as x)),
    'desconocidas', to_jsonb(v_desconocidas)
  );
end;
$$;

revoke execute on function private.resolver_tiendas_importacion(uuid, text) from public, anon, authenticated;

-- Proveedor por razón social (sin distinguir mayúsculas). Nulo si no existe o está inactivo.
create or replace function private.resolver_proveedor_importacion(p_org uuid, p_nombre text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
    from dominio.proveedores p
   where p.organizacion_id = p_org and p.activo
     and lower(btrim(p.razon_social)) = lower(btrim(coalesce(p_nombre, '')))
   limit 1;
$$;

revoke execute on function private.resolver_proveedor_importacion(uuid, text) from public, anon, authenticated;

-- Valida todas las filas. `p_clave` es la clave de la importación: con ella se comprueba qué
-- imágenes se subieron al bucket temporal (sin clave no se comprueba y no hay avisos de imagen
-- por falta de archivo).
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

    -- Categoría existente.
    if btrim(coalesce(r.categoria, '')) <> '' and private.resolver_categoria_importacion(p_org, r.categoria) is null then
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
    if btrim(coalesce(r.proveedor, '')) <> '' and private.resolver_proveedor_importacion(p_org, r.proveedor) is null then
      v_avisos := v_avisos || format('Se ignora el proveedor «%s»: no existe', left(btrim(r.proveedor), 100));
    end if;
    v_tiendas := private.resolver_tiendas_importacion(p_org, r.tiendas);
    if jsonb_array_length(v_tiendas -> 'desconocidas') > 0 then
      v_avisos := v_avisos || format('Tienda desconocida: %s', (select string_agg(t, ', ') from jsonb_array_elements_text(v_tiendas -> 'desconocidas') as t));
    end if;

    -- Imágenes citadas (la primera es la principal; hasta 4).
    v_cantidad_imagenes := 0;
    for v_nombre_imagen in
      select btrim(t) from unnest(string_to_array(coalesce(r.imagenes, ''), '|')) as t where btrim(t) <> ''
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
    mensaje := array_to_string(case when cardinality(v_errores) > 0 then v_errores else v_avisos end, '; ');
    carga := r.original;
    return next;
  end loop;
end;
$$;

revoke execute on function private.validar_filas_importacion_productos(uuid, boolean, jsonb, uuid) from public, anon, authenticated;

-- ============================================================================
-- public.validar_importacion_productos (FR-105): vista previa. Solo lectura.
-- ============================================================================

create or replace function public.validar_importacion_productos(p_filas jsonb, p_clave uuid default null)
returns table (fila integer, sku text, accion text, estado text, mensaje text)
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
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'FILAS_INVALIDAS: se esperaba una lista de filas' using errcode = '22023';
  end if;
  if jsonb_array_length(p_filas) = 0 then
    raise exception 'FILAS_INVALIDAS: la planilla no tiene filas' using errcode = '22023';
  end if;
  if jsonb_array_length(p_filas) > 2000 then
    raise exception 'FILAS_INVALIDAS: la planilla supera las 2000 filas' using errcode = '22023';
  end if;

  return query
    select v.fila, v.sku, v.accion, v.estado, v.mensaje
      from private.validar_filas_importacion_productos(
        v_org, (select private.nivel_seccion('rentabilidad')) = 'edicion', p_filas, p_clave) v;
end;
$$;

comment on function public.validar_importacion_productos(jsonb, uuid) is
  'F-CAT-10 (FR-105/106): valida las filas de la planilla y devuelve acción (nuevo/actualiza), estado (ok/aviso/error) y mensaje por fila. Solo Administrador; p_clave (opcional) comprueba las imágenes subidas. Errores: 42501, 22023 (más de 2000 filas o formato).';

revoke execute on function public.validar_importacion_productos(jsonb, uuid) from public, anon;
grant execute on function public.validar_importacion_productos(jsonb, uuid) to authenticated;
