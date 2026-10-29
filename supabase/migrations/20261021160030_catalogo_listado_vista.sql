-- F-CAT-01 (MSF-252, épica MSF-160): contrato de lectura del listado de productos.
-- Esquema (Principio VII): `public.v_productos_listado` es una VISTA (no una tabla) que combina
-- `dominio.productos` y `dominio.producto_imagenes`; no se crea ninguna tabla. Hereda la RLS por
-- organización y por sección `productos` de las tablas base (`security_invoker = true`).
-- Sin costo (Decisión 5): `producto_costos` queda restringida a Rentabilidad y no se une acá.
-- Las historias F-CAT-07 y F-CAT-08 la reemplazan con `create or replace view` agregando
-- columnas AL FINAL (contrato para MSF-179/202).
--
-- Migración aditiva. Reversión (en una migración posterior, no en este PR):
--   drop view public.v_productos_listado;

create view public.v_productos_listado
with (security_invoker = true) as
select
  p.id,
  p.organizacion_id,
  p.nombre,
  p.sku,
  p.activo,
  -- Ruta de la imagen principal (la de menor posición) en el bucket privado: la app la firma.
  (select i.ruta
     from dominio.producto_imagenes i
    where i.producto_id = p.id and i.organizacion_id = p.organizacion_id
    order by i.posicion
    limit 1) as imagen_ruta,
  p.updated_at
from dominio.productos p;

comment on view public.v_productos_listado is
  'F-CAT-01: listado de productos (id, nombre, SKU, estado, imagen principal). security_invoker: rige la RLS de dominio.productos. Sin costo. Las historias siguientes agregan columnas al final.';

revoke all on public.v_productos_listado from public, anon;
grant select on public.v_productos_listado to authenticated;
