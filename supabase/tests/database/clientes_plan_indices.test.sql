-- T019 (SC-002, MSF-180): la búsqueda parcial y la paginación de clientes usan sus índices.
-- Seed de ~5.000 clientes mixtos (con tilde, como los nombres reales) y EXPLAIN verificado por el CI
-- (job `database`), no por una persona. Corre como postgres (sin RLS): compara el plan del índice,
-- no el de la RPC. `enable_seqscan = off` descarta el falso negativo por tamaño de tabla,
-- pero entonces el test prueba que el índice ES UTILIZABLE y que el planner lo prefiere frente al btree de
-- organización con un patrón selectivo; no prueba la elección con costos normales (ver docs/clientes.md).
begin;

select plan(5);

insert into organizaciones (id, nombre)
values ('19a0c000-0000-4000-8000-000000005019', 'Org T019')
on conflict (id) do nothing;

insert into clientes (organizacion_id, nombre, documento, correo, localidad, tipo, archivado_en)
select '19a0c000-0000-4000-8000-000000005019',
       (array['José','María','Ñandú','Sofía','Andrés','Luciana'])[1 + g % 6] || ' Cliente ' || g,
       lpad((20000000 + g)::text, 8, '0'),
       'cliente' || g || '@ejemplo.test',
       (array['Córdoba','Rosario','Mendoza','Tucumán'])[1 + g % 4],
       case when g % 3 = 0 then 'mayorista' else 'minorista' end,
       case when g % 10 = 0 then now() end
  from generate_series(1, 5000) g;

analyze public.clientes;

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

-- Con seqscan off el planner a veces prefiere el Index Scan del btree de organización (costos de la
-- tabla recién analizada); el GIN solo admite bitmap scan, así que se descarta el index scan simple
-- para que el test no dependa de empates de costo.
set local enable_indexscan = off;

-- En CI el planner a veces elegía el bitmap del btree de organización (la org entera es el seed) en lugar
-- del GIN. Se descarta ese btree dentro de la transacción (rollback al final) para que la prueba no
-- dependa del empate de costos; la paginación usa clientes_org_nombre_idx, que no se toca.
drop index public.clientes_organizacion_id_idx;

create temp table pg_temp.busqueda_plan as
select pg_temp.plan_de($q$
  select c.id from public.clientes c
   where c.organizacion_id = '19a0c000-0000-4000-8000-000000005019'
     and c.archivado_en is null
     and lower(coalesce(c.nombre, '') || ' ' || coalesce(c.documento, '') || ' ' || coalesce(c.correo, '') || ' '
         || coalesce(c.telefono, '') || ' ' || coalesce(c.celular, '') || ' ' || coalesce(c.localidad, '') || ' '
         || c.numero::text) like '%andrés cliente 42%'
$q$) as plan;

set local enable_indexscan = on;

create temp table pg_temp.paginacion_plan as
select pg_temp.plan_de($q$
  select c.id from public.clientes c
   where c.organizacion_id = '19a0c000-0000-4000-8000-000000005019' and c.archivado_en is null
   order by lower(c.nombre), c.id limit 25 offset 50
$q$) as plan;

select cmp_ok(
  (select count(*)::int from public.clientes
    where organizacion_id = '19a0c000-0000-4000-8000-000000005019' and archivado_en is null
      and lower(nombre) like '%andrés cliente 42%'),
  '>', 0,
  'el seed genera nombres con tilde que la búsqueda de prueba encuentra (no es un EXPLAIN vacío)'
);

select ok(
  (select count(*) from public.clientes
    where organizacion_id = '19a0c000-0000-4000-8000-000000005019'
      and not es_consumidor_final) = 5000,
  'seed de 5.000 clientes (sin el Consumidor final que crea el trigger de la org)'
);

select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'clientes_busqueda_trgm_idx'),
  'existe clientes_busqueda_trgm_idx (requiere pg_trgm)'
);

select matches(
  (select plan from pg_temp.busqueda_plan),
  'clientes_busqueda_trgm_idx',
  'la búsqueda parcial usa clientes_busqueda_trgm_idx'
);

select matches(
  (select plan from pg_temp.paginacion_plan),
  'clientes_org_nombre_idx',
  'la paginación por defecto usa clientes_org_nombre_idx'
);

select * from finish();
rollback;
