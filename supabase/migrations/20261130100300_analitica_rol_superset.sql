-- F-REN-01 (MSF-204): rol de SOLO LECTURA para Superset sobre el esquema `analitica` (FR-008).
-- Solo `usage` en `analitica` y `select` sobre sus vistas. Ningún `execute` sobre las funciones de
-- apoyo: la vista corre como su dueño y las llama por dentro, así que el rol de Superset no las
-- necesita (y no puede invocarlas directo con otra organización). Ningún acceso a `public`,
-- `dominio` ni `private`; `anon` y `authenticated` siguen sin acceso a `analitica`.
--
-- El rol nace `nologin` y SIN contraseña: no puede autenticarse hasta que el despliegue lo habilite
-- (`pnpm db:migrar:cloud` ejecuta `alter role superset_analitica with login password ...` con
-- SUPERSET_ANALITICA_DB_PASSWORD y falla si la variable falta). Nunca hay un valor real ni un
-- placeholder en Git. Guardado con chequeo de pg_roles: los roles son objetos de clúster y la migración puede correr dos veces sobre el mismo
-- clúster (runners con Postgres persistente).
--
-- Migración aditiva. Reversión (migración posterior):
--   alter default privileges in schema analitica revoke select on tables from superset_analitica;
--   revoke all on all tables in schema analitica from superset_analitica;
--   revoke usage on schema analitica from superset_analitica;
--   drop role superset_analitica;   -- solo si ningún Superset sigue conectado con él

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'superset_analitica') then
    create role superset_analitica with nologin nosuperuser nocreatedb nocreaterole noinherit;
  end if;
end
$$;

comment on role superset_analitica is
  'Rol de solo lectura de Superset sobre el esquema analitica (F-REN-01). Sin auth.uid(): el aislamiento por organización lo fuerza la cláusula rls del guest token.';

grant usage on schema analitica to superset_analitica;
grant select on analitica.margen_producto_canal to superset_analitica;
-- A propósito NO se otorga execute sobre analitica.a_pesos / analitica.neto_empresa: la vista las
-- invoca como su dueño y el rol de Superset no debe poder pedir el neto o el costo de otra
-- organización por fuera de la cláusula `rls` del guest token.

-- Las vistas de analitica que se sumen después heredan el select de solo lectura.
alter default privileges in schema analitica grant select on tables to superset_analitica;
