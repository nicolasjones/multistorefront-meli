-- Aprovisionamiento de las tiendas online del dataset demo (paso SQL, no vía RPC).
-- `dominio.tiendas` solo la carga el equipo técnico por SQL (docs/tiendas-online.md, FR-004): `authenticated` solo
-- tiene SELECT y no existe una RPC de alta. Idempotente. Se corre con un rol que escriba en `dominio` (postgres):
--   psql "$DEMO_DB_URL" -v org="San Javucho y Mundo JC (demo)" -v sufijo="" -f sql/01-tiendas.sql
-- Los dominios quedan como demo-sanjavucho<sufijo>.localhost y demo-mundojc<sufijo>.localhost.
\set ON_ERROR_STOP on
insert into dominio.tiendas (organizacion_id, empresa_id, dominio)
select o.id, e.id,
       'demo-' || case e.nombre when 'San Javucho' then 'sanjavucho' else 'mundojc' end || :'sufijo' || '.localhost'
  from public.organizaciones o
  join dominio.empresas e on e.organizacion_id = o.id
 where o.nombre = :'org'
on conflict (empresa_id) do nothing;

select e.nombre as empresa, t.dominio
  from dominio.tiendas t
  join dominio.empresas e on e.id = t.empresa_id
  join public.organizaciones o on o.id = t.organizacion_id
 where o.nombre = :'org'
 order by e.nombre;
