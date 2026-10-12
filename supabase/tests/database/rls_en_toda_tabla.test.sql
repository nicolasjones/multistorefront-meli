-- Toda tabla de los esquemas expuestos por la API debe tener RLS activado
-- (acceso y organización, F-ORG-01, FR-012). Recorre el catálogo en vez de
-- una lista fija: una tabla nueva sin RLS rompe esta prueba sin tocarla.
-- Esquemas expuestos: public (plataforma) y dominio (producto), ver
-- [api] schemas en supabase/config.toml.
begin;

select plan(4);

select is(
  (select count(*) from pg_namespace where nspname in ('public', 'dominio'))::int,
  2,
  'existen los dos esquemas expuestos: public y dominio'
);

-- Tablas ordinarias y particionadas; se omiten las particiones hijas (la
-- política vive en la tabla padre) y las que pertenecen a una extensión.
create temp table tablas_expuestas on commit drop as
select n.nspname as esquema, c.relname as tabla, c.relrowsecurity as rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'dominio')
  and c.relkind in ('r', 'p')
  and not c.relispartition
  and not exists (
    select 1 from pg_depend d
    where d.classid = 'pg_class'::regclass
      and d.objid = c.oid
      and d.deptype = 'e'
  );

select cmp_ok(
  (select count(*) from tablas_expuestas)::int, '>', 0,
  'el recorrido encuentra tablas expuestas (la prueba no pasa en vacío)'
);

select is(
  (select coalesce(array_agg(esquema || '.' || tabla order by esquema, tabla), array[]::text[])
     from tablas_expuestas where not rls),
  array[]::text[],
  'ninguna tabla de public ni de dominio tiene RLS desactivado'
);

select ok(
  exists (select 1 from tablas_expuestas where esquema = 'public' and tabla = 'clientes' and rls),
  'control positivo: public.clientes figura en el recorrido con RLS activo'
);

select * from finish();

rollback;
