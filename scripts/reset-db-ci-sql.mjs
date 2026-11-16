// Esquemas gestionados por el stack de Supabase: el reset del CI nunca los elimina. Lista a mano:
// revisarla al subir la versión de Supabase (un esquema gestionado que falte se intentaría borrar con CASCADE).
export const ESQUEMAS_STACK = ['auth', 'storage', 'extensions', 'graphql', 'graphql_public', 'realtime', '_realtime', 'vault', 'pgsodium', 'pgsodium_masks', 'supabase_functions', 'supabase_migrations', 'net', 'pgbouncer', 'cron', '_analytics', 'pgmq'];

// SQL que elimina todo esquema que no sea del sistema ni del stack, recrea `public` y deja el rol
// `superset_analitica` en nologin sin contraseña (la migración lo reutiliza y le reasigna sus grants).
// No se usa `drop owned`/`drop role`: `postgres` no es superusuario en Supabase y no puede ejecutarlos
// sobre un rol que no hereda; sus privilegios ya desaparecieron al borrar el esquema `analitica`.
// El `\_` escapa el guion bajo del LIKE: sin él `pg_%` también atraparía esquemas de la aplicación como `pgx`.
export const sqlReset = () => {
  const listaStack = ESQUEMAS_STACK.map((nombre) => `'${nombre}'`).join(', ');
  return `do $reset$ declare esquema text; begin
  for esquema in select nspname from pg_namespace
    where nspname not in (${listaStack}) and nspname not like 'pg\\_%' and nspname <> 'information_schema'
  loop execute format('drop schema if exists %I cascade', esquema); end loop;
  create schema public;
  -- Los roles son objetos de clúster: sobreviven al drop de esquemas y, en runners con Postgres
  -- persistente, arrastrarían atributos (login) de una corrida anterior.
  if exists (select 1 from pg_roles where rolname = 'superset_analitica') then
    alter role superset_analitica with nologin password null;
  end if;
end $reset$;`;
};
