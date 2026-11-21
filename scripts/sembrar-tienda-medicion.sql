-- Siembra el catálogo de medición en las dos tiendas del seed (MSF-552 · T071/SC-010 de MSF-167).
--
-- Para qué: `supabase/seed.sql` deja las dos tiendas (`mundojc.localhost` y `sanjavucho.localhost`) sin
-- productos visibles (no crea filas en `dominio.producto_empresa`), así que `/catalogo` sale vacío y no hay
-- `/producto/:id` que medir. Con este catálogo, el catálogo muestra una tanda completa de 24 tarjetas y la
-- ficha tiene producto: es el «catálogo de cientos de productos» del protocolo de `docs/tiendas-online.md`
-- («Rendimiento en celular»).
--
-- Uso (SOLO en una base LOCAL o de pruebas; NUNCA contra dev, staging ni producción):
--   psql -X -q -v N=300 -f scripts/sembrar-tienda-medicion.sql <base-local>
--
-- Qué deja: por tienda, una categoría «Medición» con N productos (la mitad con existencias) y precio en
-- pesos. A diferencia de `scripts/medir-tienda-catalogo.sql` (que mide la RPC y revierte), esto DEJA datos:
-- la medición por HTTP (Lighthouse) necesita que el catálogo exista mientras se mide. Es idempotente (ids
-- fijos): volver a correrlo no duplica nada.
--
-- Guarda de entorno: esta siembra deja datos, así que sólo corre en una base descartable (el stack local con
-- el seed o el del CI, que se tira después). Si la base tiene organizaciones que NO son del seed, es dev,
-- staging o producción: el script se niega a sembrar. Para borrar lo que ya se sembró:
-- `scripts/limpiar-tienda-medicion.sql`.

-- Las dos tiendas del seed (supabase/seed.sql · MSF-241).
-- Tabla temporal (la sesión de psql): `on commit preserve rows` a propósito, porque psql corre cada
-- sentencia en su propia transacción y `on commit drop` la borraría enseguida.
create temporary table tiendas_medicion (
  organizacion_id uuid not null,
  empresa_id uuid not null,
  prefijo text not null,
  categoria_id uuid not null
);

insert into tiendas_medicion (organizacion_id, empresa_id, prefijo, categoria_id) values
  ('0f5eed00-0000-4000-8000-000000000001', '0f5eed01-0000-4000-8000-000000000001', 'a', 'ca900000-0000-4000-8000-000000000001'),
  ('0f5eed00-0000-4000-8000-000000000002', '0f5eed01-0000-4000-8000-000000000002', 'b', 'ca900000-0000-4000-8000-000000000002');

-- Si las tiendas del seed no están, esta no es la base del seed: no se siembra nada y se avisa.
do $$
declare
  faltantes text;
begin
  select string_agg(tm.prefijo, ', ')
    into faltantes
    from tiendas_medicion tm
    left join dominio.tiendas ti
      on ti.empresa_id = tm.empresa_id and ti.organizacion_id = tm.organizacion_id
   where ti.dominio is null;
  if faltantes is not null then
    raise exception 'Faltan las tiendas del seed en esta base (prefijo %): se corre solo sobre una base con supabase/seed.sql', faltantes;
  end if;
end $$;

-- Guarda de entorno: esta siembra DEJA datos, así que sólo puede correr en una base descartable (el stack
-- local con el seed o el del CI). Si hay organizaciones que no son del seed, es dev, staging o producción:
-- no se siembra nada (ni se avisa con un simple comentario).
do $$
declare
  ajenas text;
begin
  select string_agg(o.nombre, ', ')
    into ajenas
    from public.organizaciones o
   where o.id not in ('0f5eed00-0000-4000-8000-000000000001', '0f5eed00-0000-4000-8000-000000000002');
  if ajenas is not null then
    raise exception 'Esta base tiene organizaciones que no son del seed (%%): no es una base de medición. La siembra deja datos: usá scripts/limpiar-tienda-medicion.sql si ya la corriste.', ajenas;
  end if;
end $$;

insert into dominio.categorias (id, organizacion_id, nombre)
select tm.categoria_id, tm.organizacion_id, 'Medición'
  from tiendas_medicion tm
on conflict (id) do nothing;

-- Los productos: precio en pesos y la mitad con número par (los que después tienen existencias).
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo, categoria_id)
select ('b' || tm.prefijo || '900000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       tm.organizacion_id,
       'Producto de medición ' || tm.prefijo || '-' || n,
       'MED-' || tm.prefijo || '-' || n,
       1000 + n,
       'ARS',
       true,
       tm.categoria_id
  from tiendas_medicion tm
  cross join generate_series(1, :N) n
on conflict (id) do nothing;

-- Sin esta fila el producto no es visible en la tienda (es lo que join en `private.catalogo_tienda_efectivo`).
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, tm.empresa_id, p.organizacion_id
  from dominio.productos p
  join tiendas_medicion tm
    on tm.organizacion_id = p.organizacion_id and p.sku like 'MED-' || tm.prefijo || '-%'
on conflict (producto_id, empresa_id) do nothing;

-- La fila de existencias nace con el producto (trigger) en 0: la mitad queda con stock para el filtro
-- «solo con stock» y para la etiqueta «Disponible».
update dominio.existencias e
   set cantidad = 5
  from dominio.productos p
 where e.producto_id = p.id
   and e.organizacion_id = p.organizacion_id
   and p.sku like 'MED-%'
   and right(p.id::text, 12)::bigint % 2 = 0;

drop table tiendas_medicion;
