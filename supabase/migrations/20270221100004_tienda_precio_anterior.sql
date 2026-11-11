-- F-PRE-11 (MSF-439, épica MSF-363): la tienda pública suma `precio_anterior` y muestra el `precio` con la
-- promoción vigente. FR-017.
--
-- Esquemas (Principio VII, re-verificado): no se crea ni altera ninguna tabla.
--   * publico.catalogo_pagina_por_dominio / publico.producto_por_dominio -> `publico` (lectura anónima);
--     `publico` sigue SIN tablas.
--
-- Cambio ADITIVO sobre F-TDA-12 (catálogo) y F-TDA-13 (ficha): cada producto suma la clave
-- `precio_anterior` (null si no hay promoción vigente) y `precio` pasa a salir de
-- `private.precio_vigente_empresa`, que sin promoción devuelve exactamente lo de `private.precio_final_publico`.
-- Mismas listas blancas (una clave nueva, el precio normal que el cliente ya veía); el importe promocional
-- de otra empresa no se filtra porque la promoción se busca por (producto, empresa del host). El orden por
-- precio y el filtro de precio máximo del catálogo usan el precio vigente (el que se ve).
--
-- Inventario de usos de `private.precio_final_publico` (Decisión 7 de la spec): se ADOPTA el precio vigente
-- solo en catálogo y ficha (esta migración). NO se tocan, a propósito: destacados
-- (20261203100000_tienda_destacados_publicos), búsqueda — sugerencias y resultados (20261203110100/
-- 20261203110200) —, precio por escala (`precio_final_publico_escala`, 20261211110000) y precios de cliente
-- por dominio (20261211110100). Se incorporan solo si Nicolás lo pide. Ventas, carrito, POS y
-- Mercado Libre tampoco cobran el promocional (Decisión 6).
--
-- Migración aditiva. Reversión (migración posterior): restaurar la versión previa de las dos funciones
-- (20261023150200_tienda_catalogo_publico.sql y 20261023150300_tienda_ficha_publica.sql); la clave extra
-- `precio_anterior` es aditiva y los clientes la ignoran.

create or replace function publico.catalogo_pagina_por_dominio(
  host text,
  categoria uuid default null,
  solo_con_stock boolean default false,
  precio_max numeric default null,
  orden text default 'relevancia',
  pagina integer default 1
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  c_tamano constant integer := 24;
  v_empresa uuid;
  v_orden text := case when orden in ('relevancia', 'precio_asc', 'precio_desc') then orden else 'relevancia' end;
  v_pagina integer := greatest(coalesce(pagina, 1), 1);
  v_max numeric := case when precio_max is null or precio_max <= 0 then null else precio_max end;
  v_solo boolean := coalesce(solo_con_stock, false);
  v_resultado jsonb;
begin
  select e.id into v_empresa
    from dominio.tiendas ti
    join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id
   where ti.dominio = private.normalizar_host(host) and e.activa;
  if v_empresa is null then
    return null;
  end if;

  -- Los productos de una categoría oculta o ajena no son «efectivos»: la lista sale vacía sin error.
  with prod as (
    select x.producto_id, x.nombre, x.categoria_id, x.destacado,
           pv.precio, pv.precio_anterior,
           private.disponible_publico(x.producto_id) as disponible
      from private.catalogo_tienda_efectivo(v_empresa) x
      cross join lateral private.precio_vigente_empresa(x.producto_id, v_empresa, now()) pv
     where x.efectivo and (categoria is null or x.categoria_id = categoria)
  ),
  filtrado as (
    select * from prod f
     where (not v_solo or f.disponible)
       and (v_max is null or (f.precio is not null and f.precio <= v_max))
  ),
  pagina_ord as (
    select f.*
      from filtrado f
     order by
       case when v_orden = 'relevancia' then (case when f.destacado then 0 else 1 end)
            else (case when f.precio is null then 1 else 0 end) end,
       case when v_orden = 'precio_asc' then f.precio end asc,
       case when v_orden = 'precio_desc' then f.precio end desc,
       lower(f.nombre), f.producto_id
     offset ((v_pagina - 1)::bigint * c_tamano) limit c_tamano
  )
  select jsonb_build_object(
           'total', (select count(*) from filtrado),
           'pagina', v_pagina,
           'tamano', c_tamano,
           'categorias', coalesce(publico.categorias_por_dominio(host) -> 'categorias', '[]'::jsonb),
           'productos', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', g.producto_id,
                      'nombre', g.nombre,
                      'precio', g.precio,
                      'precio_anterior', g.precio_anterior,
                      'disponible', g.disponible,
                      'imagen', (select i.ruta from dominio.producto_imagenes i
                                  where i.producto_id = g.producto_id order by i.posicion limit 1),
                      'categoria_id', g.categoria_id,
                      'destacado', g.destacado
                    ) order by
                      case when v_orden = 'relevancia' then (case when g.destacado then 0 else 1 end)
                           else (case when g.precio is null then 1 else 0 end) end,
                      case when v_orden = 'precio_asc' then g.precio end asc,
                      case when v_orden = 'precio_desc' then g.precio end desc,
                      lower(g.nombre), g.producto_id)
               from pagina_ord g), '[]'::jsonb)
         )
    into v_resultado;
  return v_resultado;
end;
$$;

comment on function publico.catalogo_pagina_por_dominio(text, uuid, boolean, numeric, text, integer) is
  'F-TDA-12 + F-PRE-11: página de 24 del catálogo público por host, con filtros (categoría, solo con stock, precio máximo) y orden (relevancia, menor/mayor precio). El precio es el vigente (con promoción por fecha) y precio_anterior el normal, o null sin promoción. Lista blanca de campos; null si el dominio no existe o la empresa está desactivada.';

create or replace function publico.producto_por_dominio(host text, producto uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  v_empresa uuid;
  v_resultado jsonb;
begin
  select e.id into v_empresa
    from dominio.tiendas ti
    join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id
   where ti.dominio = private.normalizar_host(host) and e.activa;
  if v_empresa is null or producto is null then
    return null;
  end if;

  -- «Efectivo» ya incluye: producto activo, asignado a la empresa, no oculto y categoría visible (con su padre).
  select jsonb_build_object(
           'id', p.id,
           'nombre', p.nombre,
           'descripcion', nullif(btrim(p.descripcion), ''),
           'sku', nullif(btrim(p.sku), ''),
           'categoria', case when c.id is null then null
                             else jsonb_build_object('id', c.id, 'nombre', c.nombre) end,
           'precio', pv.precio,
           'precio_anterior', pv.precio_anterior,
           'disponible', private.disponible_publico(p.id),
           'compatibilidad', nullif(array_to_string(p.compatible_con, ', '), ''),
           'imagenes', coalesce((
             select jsonb_agg(jsonb_build_object('posicion', i.posicion, 'ruta', i.ruta) order by i.posicion)
               from dominio.producto_imagenes i
              where i.producto_id = p.id and i.organizacion_id = p.organizacion_id
           ), '[]'::jsonb)
         )
    into v_resultado
    from private.catalogo_tienda_efectivo(v_empresa) x
    join dominio.productos p on p.id = x.producto_id
    cross join lateral private.precio_vigente_empresa(p.id, v_empresa, now()) pv
    left join dominio.categorias c on c.id = p.categoria_id and c.organizacion_id = p.organizacion_id
   where x.efectivo and x.producto_id = producto;

  return v_resultado;
end;
$$;

comment on function publico.producto_por_dominio(text, uuid) is
  'F-TDA-13 + F-PRE-11: ficha pública de un producto efectivamente visible de la tienda del host (nombre, descripción, SKU, categoría, precio vigente con promoción, precio_anterior o null, disponibilidad, compatibilidad e imágenes). Lista blanca de campos; null idéntico si el producto no existe, está inactivo, oculto, con categoría oculta o es de otra empresa, o si el dominio no existe / la empresa está desactivada.';
