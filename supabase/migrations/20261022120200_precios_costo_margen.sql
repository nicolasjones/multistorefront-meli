-- F-PRE-01 (MSF-115, épica MSF-114): precio central, costo en pesos y margen.
-- Esquema: vista de lectura en `public` (no almacena datos; Principio VII), `security_invoker`:
-- hereda la RLS de `dominio.productos`, `dominio.cotizacion_inicial` y `dominio.producto_costos`.
--
-- El costo vive en `producto_costos`, restringido a la sección `rentabilidad`. La vista lo une
-- con LEFT JOIN: quien no tiene esa sección no recibe filas de costo (costo_ars y margen
-- quedan en null), pero sí el precio central en pesos. Margen = (neto − costo en pesos) / neto,
-- siempre sobre el neto (sin IVA); en esta historia el neto es el precio central (escala x1).
--
-- Migración aditiva. Reversión (migración posterior):
--   drop view public.productos_precio_costo;

create or replace view public.productos_precio_costo
with (security_invoker = true)
as
select
  p.id as producto_id,
  p.organizacion_id,
  p.moneda,
  p.precio_lista,
  c.valor as cotizacion,
  c.updated_at as cotizacion_fecha,
  private.a_pesos(p.precio_lista, p.moneda, p.organizacion_id) as precio_central_ars,
  private.a_pesos(k.costo, p.moneda, p.organizacion_id) as costo_ars,
  case
    when private.a_pesos(p.precio_lista, p.moneda, p.organizacion_id) > 0
      and private.a_pesos(k.costo, p.moneda, p.organizacion_id) is not null
    then round(
      (private.a_pesos(p.precio_lista, p.moneda, p.organizacion_id)
        - private.a_pesos(k.costo, p.moneda, p.organizacion_id))
      / private.a_pesos(p.precio_lista, p.moneda, p.organizacion_id), 4)
  end as margen
from dominio.productos p
left join dominio.cotizacion_inicial c on c.organizacion_id = p.organizacion_id
left join dominio.producto_costos k on k.producto_id = p.id and k.organizacion_id = p.organizacion_id;

comment on view public.productos_precio_costo is
  'F-PRE-01: precio central en pesos (sin IVA), costo en pesos y margen. costo_ars y margen solo con la sección rentabilidad.';

revoke all on public.productos_precio_costo from public, anon, authenticated;
grant select on public.productos_precio_costo to authenticated;
