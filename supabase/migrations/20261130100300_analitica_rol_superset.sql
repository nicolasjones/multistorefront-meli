-- F-REN-01 (MSF-204): rol de SOLO LECTURA para Superset sobre el esquema `analitica` (FR-008).
-- Solo `usage` en `analitica`, `select` sobre sus vistas y `execute` sobre sus dos funciones de apoyo
-- (SECURITY DEFINER). Ningún acceso a `public`, `dominio` ni `private`; `anon` y `authenticated`
-- siguen sin acceso a `analitica`.
--
-- Contraseña placeholder: nunca un valor real acá. Se rota por entorno con
--   alter role superset_analitica with password '...'   (variable SUPERSET_ANALITICA_DB_PASSWORD,
-- declarada sin valor real en `.env.example` e `infra/superset/.env.example`). Guardado con chequeo
-- de pg_roles: los roles son objetos de clúster y la migración puede correr dos veces sobre el mismo
-- clúster (runners con Postgres persistente).
--
-- Migración aditiva. Reversión (migración posterior):
--   alter default privileges in schema analitica revoke select on tables from superset_analitica;
--   revoke all on all tables in schema analitica from superset_analitica;
--   revoke all on all functions in schema analitica from superset_analitica;
--   revoke usage on schema analitica from superset_analitica;
--   drop role superset_analitica;   -- solo si ningún Superset sigue conectado con él

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'superset_analitica') then
    create role superset_analitica with login password 'reemplazar-por-entorno' nosuperuser nocreatedb nocreaterole noinherit;
  end if;
end
$$;

comment on role superset_analitica is
  'Rol de solo lectura de Superset sobre el esquema analitica (F-REN-01). Sin auth.uid(): el aislamiento por organización lo fuerza la cláusula rls del guest token.';

grant usage on schema analitica to superset_analitica;
grant select on analitica.margen_producto_canal to superset_analitica;
grant execute on function analitica.a_pesos(numeric, text, uuid) to superset_analitica;
grant execute on function analitica.neto_empresa(uuid, uuid) to superset_analitica;

-- Las vistas de analitica que se sumen después heredan el select de solo lectura.
alter default privileges in schema analitica grant select on tables to superset_analitica;
