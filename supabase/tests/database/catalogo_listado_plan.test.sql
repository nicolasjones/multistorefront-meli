-- F-CAT-01 (MSF-252) · SC-001: con 10 000 productos, la búsqueda parcial por nombre/SKU y la
-- paginación por nombre/SKU usan índice. Corre como postgres (sin RLS) y compara el plan de la
-- MISMA consulta que arma la app sobre `public.v_productos_listado` (vista + `or` de dos ILIKE).
--
-- `enable_seqscan = off` descarta el falso negativo por tamaño de tabla (10 000 filas entran en
-- pocas páginas y el planner prefiere el seq scan). Con el catálogo de una sola organización, el
-- filtro por `organizacion_id` no discrimina: cualquier btree que empiece por esa columna devuelve
-- todas las filas, así que el EXPLAIN de la búsqueda se hace sin ese filtro (es un AND que sólo
-- reduce filas). Lo que se prueba es que la condición ILIKE —la única que el trigram puede resolver—
-- elige el índice trigram. La elección con los costos normales a 10 000 filas queda documentada en
-- docs/catalogo.md: el trigram rinde cuando el catálogo crece.
begin;

select plan(7);

insert into organizaciones (id, nombre) values ('19a0c000-0000-4000-8000-000000252001', 'Org MSF-252');

-- 10 000 productos con nombres realistas (repetidos, como un catálogo de verdad) y SKU únicos.
insert into dominio.productos (organizacion_id, nombre, sku, precio_lista)
select '19a0c000-0000-4000-8000-000000252001',
       (array['Joystick Gamer','Teclado Mecánico','Cámara Web','Auricular Bluetooth','Cable HDMI',
              'Ñandú de Peluche','Monitor 24 Pulgadas','Mouse Inalámbrico','Parlante Portátil',
              'Funda Protectora','Cargador Rápido','Soporte de Escritorio'])[1 + g % 12],
       'SKU-' || lpad(g::text, 6, '0'),
       10
  from generate_series(1, 9999) g;

-- El producto de los escenarios de aceptación (CA-CAT-01-2): se busca «consola» o «abc».
insert into dominio.productos (organizacion_id, nombre, sku, precio_lista)
values ('19a0c000-0000-4000-8000-000000252001', 'Consola X', 'ABC-1', 10);

analyze dominio.productos;

create function pg_temp.plan_de(p_sql text) returns text language plpgsql as $$
declare
  v_linea text;
  v_plan text := '';
begin
  for v_linea in execute 'explain (costs off) ' || p_sql loop
    v_plan := v_plan || v_linea || E'\n';
  end loop;
  return v_plan;
end;
$$;

set local enable_seqscan = off;

create temp table pg_temp.planes_busqueda as
select
  pg_temp.plan_de($q$
    select id, nombre, sku, activo, imagen_ruta
      from public.v_productos_listado
     where nombre ilike '%consola x%'
$q$) as por_nombre,
  pg_temp.plan_de($q$
    select id, nombre, sku, activo, imagen_ruta
      from public.v_productos_listado
     where sku ilike '%abc-1%'
$q$) as por_sku,
  pg_temp.plan_de($q$
    select id, nombre, sku, activo, imagen_ruta
      from public.v_productos_listado
     where (nombre ilike '%consola x%' or sku ilike '%consola x%')
     order by nombre, id limit 25
$q$) as consulta_real;

create temp table pg_temp.planes_orden as
select
  pg_temp.plan_de($q$
    select id, nombre, sku, activo, imagen_ruta
      from public.v_productos_listado
     where organizacion_id = '19a0c000-0000-4000-8000-000000252001'
     order by nombre, id limit 25 offset 50
$q$) as orden_nombre,
  pg_temp.plan_de($q$
    select id, nombre, sku, activo, imagen_ruta
      from public.v_productos_listado
     where organizacion_id = '19a0c000-0000-4000-8000-000000252001'
     order by sku, id limit 25 offset 50
$q$) as orden_sku;

select is(
  (select count(*)::int from dominio.productos where organizacion_id = '19a0c000-0000-4000-8000-000000252001'),
  10000, 'seed de 10 000 productos'
);
select ok(
  (select count(*) from public.v_productos_listado
    where (nombre ilike '%consola x%' or sku ilike '%consola x%')) > 0,
  'la búsqueda de prueba encuentra el producto (el EXPLAIN no es de una consulta vacía)'
);
select matches((select por_nombre from pg_temp.planes_busqueda), 'productos_nombre_trgm_idx', 'la búsqueda por nombre usa el índice trigram');
select matches((select por_sku from pg_temp.planes_busqueda), 'productos_sku_trgm_idx', 'la búsqueda por SKU usa el índice trigram');
select matches((select consulta_real from pg_temp.planes_busqueda), 'productos_(nombre|sku)_trgm_idx', 'la consulta real (vista + OR de nombre/SKU) usa un índice trigram');
select matches((select orden_nombre from pg_temp.planes_orden), 'productos_org_nombre_orden_idx', 'el orden por nombre usa productos_org_nombre_orden_idx');
select matches((select orden_sku from pg_temp.planes_orden), 'productos_org_sku_orden_idx', 'el orden por SKU usa productos_org_sku_orden_idx');

select * from finish();
rollback;
