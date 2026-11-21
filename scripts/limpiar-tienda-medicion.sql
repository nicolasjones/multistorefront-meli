-- Limpia el catálogo de medición sembrado por `scripts/sembrar-tienda-medicion.sql` (MSF-552 · T071/SC-010).
--
-- Para qué: la siembra DEJA datos (la medición por HTTP necesita que el catálogo exista mientras se mide) y
-- por eso lleva una guarda de entorno. Este script es la forma de borrarlos desde el repo: borra sólo lo que
-- esa siembra crea (los productos de ids fijos `ba900000-…` y `bb900000-…`, sus existencias, su vínculo con
-- la tienda y la categoría «Medición»). No toca el catálogo real.
--
-- Uso (base local o de pruebas; en el CI no hace falta: el stack se tira entero):
--   psql -X -q -f scripts/limpiar-tienda-medicion.sql <base-local>
--
-- Es idempotente: si no hay nada sembrado, no cambia nada.

begin;

-- Los ids de la siembra: ('b' || prefijo || '900000-0000-4000-8000-' || lpad(n, 12, '0')).
create temporary table productos_medicion (
  id uuid primary key
) on commit drop;

insert into productos_medicion (id)
  select p.id
    from dominio.productos p
   where p.id::text like 'ba900000-0000-4000-8000-%'
      or p.id::text like 'bb900000-0000-4000-8000-%'
on conflict (id) do nothing;

delete from dominio.existencias e
  using productos_medicion pm
 where e.producto_id = pm.id;

delete from dominio.producto_empresa pe
  using productos_medicion pm
 where pe.producto_id = pm.id;

delete from dominio.productos p
  using productos_medicion pm
 where p.id = pm.id;

-- La categoría de la medición (las de `dominio.categorias`, con `on delete set null` en los productos).
delete from dominio.categorias c
 where c.id in ('ca900000-0000-4000-8000-000000000001', 'ca900000-0000-4000-8000-000000000002')
   and c.nombre = 'Medición';

commit;
