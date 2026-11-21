-- Limpia el catálogo de medición sembrado por `scripts/sembrar-tienda-medicion.sql` (MSF-552 · T071/SC-010).
--
-- Para qué: la siembra DEJA datos (la medición por HTTP necesita que el catálogo exista mientras se mide) y
-- por eso lleva una guarda de entorno. Este script es la forma de borrarlos desde el repo: borra sólo lo que
-- esa siembra crea (los productos de ids fijos `ba900000-…` y `bb900000-…` de las dos tiendas del seed, sus
-- existencias, su vínculo con la tienda y la categoría «Medición»). No toca el catálogo real.
--
-- Guarda de entorno: como borra, se niega a correr en una base con organizaciones que NO son del seed (dev,
-- staging o producción).
--
-- Uso (base local o de pruebas; en el CI no hace falta: el stack se tira entero):
--   psql -X -q -v ON_ERROR_STOP=1 -f scripts/limpiar-tienda-medicion.sql <base-local>
--
-- Es idempotente: si no hay nada sembrado, no cambia nada.

begin;

-- Guarda de entorno: este script BORRA, así que sólo corre en una base descartable (la del seed o la del CI).
-- Si la base tiene organizaciones que no son del seed, es dev, staging o producción: no borra nada.
do $$
declare
  ajenas text;
begin
  select string_agg(o.nombre, ', ')
    into ajenas
    from public.organizaciones o
   where o.id not in ('0f5eed00-0000-4000-8000-000000000001', '0f5eed00-0000-4000-8000-000000000002');
  if ajenas is not null then
    raise exception 'Esta base tiene organizaciones que no son del seed (%): no es una base de medición.', ajenas;
  end if;
end $$;

-- Los ids de la siembra: ('b' || prefijo || '900000-0000-4000-8000-' || lpad(n, 12, '0')).
create temporary table productos_medicion (
  id uuid primary key
) on commit drop;

-- Sólo los productos de las dos tiendas del seed: los ids fijos de la siembra, dentro de sus organizaciones.
insert into productos_medicion (id)
  select p.id
    from dominio.productos p
   where p.organizacion_id in ('0f5eed00-0000-4000-8000-000000000001', '0f5eed00-0000-4000-8000-000000000002')
     and (p.id::text like 'ba900000-0000-4000-8000-%'
       or p.id::text like 'bb900000-0000-4000-8000-%')
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
   and c.organizacion_id in ('0f5eed00-0000-4000-8000-000000000001', '0f5eed00-0000-4000-8000-000000000002')
   and c.nombre = 'Medición';

commit;
