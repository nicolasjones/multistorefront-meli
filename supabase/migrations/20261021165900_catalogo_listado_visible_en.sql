-- F-CAT-07 (MSF-276, épica MSF-160): «Visible en» del listado de productos.
-- Esquema (Principio VII): `public.v_productos_listado` es una VISTA (no una tabla); no se crea
-- ninguna tabla. Sigue `security_invoker = true`: rige la RLS de dominio.productos y de
-- dominio.producto_empresa. Se reemplaza con `create or replace view` conservando TODAS las columnas
-- previas en el mismo orden y agregando `empresa_ids` AL FINAL (contrato para MSF-179/202); los
-- privilegios de la vista no cambian (revoke anon / grant authenticated de la migración 20261021160030).
--
-- Migración aditiva. Reversión (migración posterior): `create or replace view` con la definición de
-- 20261021160030_catalogo_listado_vista.sql, sin `empresa_ids` (y sin las columnas de F-CAT-08 si ya existen).

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
  -- Empresas que venden el producto (ids), para los chips de «Visible en» y el filtro de tienda.
  coalesce(
    (select array_agg(pe.empresa_id order by pe.empresa_id)
       from dominio.producto_empresa pe
      where pe.producto_id = p.id and pe.organizacion_id = p.organizacion_id),
    '{}'::uuid[]
  ) as empresa_ids
from dominio.productos p;

comment on view public.v_productos_listado is
  'F-CAT-01/F-CAT-07: listado de productos (id, nombre, SKU, estado, imagen principal, empresa_ids). security_invoker: rige la RLS de las tablas base. Sin costo. Las historias siguientes agregan columnas al final.';
