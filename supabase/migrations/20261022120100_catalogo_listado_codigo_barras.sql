-- F-CAT-14 (MSF-350, épica MSF-179): código de barras en el listado de productos.
-- Esquemas (Principio VII): no se crea ninguna tabla. `public.v_productos_listado` es una VISTA en `public`
-- (security_invoker: rige la RLS de `dominio.productos`); `dominio.productos.codigo_barras` ya existe (MSF-529)
-- y se busca por el índice único `productos_org_codigo_barras_uidx`.
-- Cambio aditivo: `create or replace view` conserva todas las columnas vigentes y suma `codigo_barras` AL FINAL.
-- Sin costo, sin `anon`.
-- REVERSIÓN: volver a ejecutar `create or replace view public.v_productos_listado` con la definición de
-- 20261022120000_catalogo_disponibilidad.sql (sin la columna final; `create or replace` no puede quitar
-- columnas, por lo que la reversión es `drop view public.v_productos_listado;` seguido de esa definición y
-- de sus `revoke`/`grant`). Ningún dato se pierde: la columna sigue en `dominio.productos`.

create or replace view public.v_productos_listado
with (security_invoker = true) as
select
  p.id,
  p.organizacion_id,
  p.nombre,
  p.sku,
  p.activo,
  (select i.ruta
     from dominio.producto_imagenes i
    where i.producto_id = p.id and i.organizacion_id = p.organizacion_id
    order by i.posicion
    limit 1) as imagen_ruta,
  p.updated_at,
  coalesce(
    (select array_agg(pe.empresa_id order by pe.empresa_id)
       from dominio.producto_empresa pe
      where pe.producto_id = p.id and pe.organizacion_id = p.organizacion_id),
    '{}'::uuid[]
  ) as empresa_ids,
  p.categoria_id,
  (select case when cp.id is null then c.nombre else cp.nombre || ' > ' || c.nombre end
     from dominio.categorias c
     left join dominio.categorias cp on cp.id = c.padre_id and cp.organizacion_id = c.organizacion_id
    where c.id = p.categoria_id and c.organizacion_id = p.organizacion_id) as categoria_ruta,
  (select array_remove(array[c.id, c.padre_id], null)
     from dominio.categorias c
    where c.id = p.categoria_id and c.organizacion_id = p.organizacion_id) as categoria_ids,
  -- F-CAT-17: misma regla que private.disponibilidad_producto(uuid), evaluada por lotes.
  coalesce(
    p.disponibilidad_manual,
    case when p.id in (select private.productos_con_stock()) then 'stock' else 'sin_stock' end
  ) as disponibilidad,
  -- F-CAT-14: búsqueda por escaneo (coincidencia exacta de EAN-13 en el servidor).
  p.codigo_barras
from dominio.productos p;

comment on view public.v_productos_listado is
  'F-CAT-01/07/08/17/14: listado de productos (id, nombre, SKU, estado, imagen principal, empresa_ids, categoría, disponibilidad, código de barras). security_invoker: rige la RLS de las tablas base. Sin costo. Las historias siguientes agregan columnas al final.';

revoke all on public.v_productos_listado from public, anon;
grant select on public.v_productos_listado to authenticated;
