import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { run } from './operaciones.mjs';
import { verificarDestinoCiActual } from './supabase-ci.mjs';

const root = path.resolve(import.meta.dirname, '..');
// Sin puerto por defecto: el destino sale de `pnpm db:ci:preparar` y la guarda
// aborta si no es el stack propio del CI (nunca un stack de desarrollo).
const { puerto } = await verificarDestinoCiActual();
const baseArgs = ['--host', 'host.docker.internal', '--port', String(puerto), '--username', 'postgres', '--dbname', 'postgres', '--set', 'ON_ERROR_STOP=1', '--quiet'];
const env = { PGPASSWORD: 'postgres', PGSSLMODE: 'disable' };
const execute = async (input) => await run('psql', baseArgs, { cwd: root, env, input, quiet: true });

// Deja la base como recién creada: elimina todo esquema que no sea del sistema ni gestionado por el
// stack de Supabase (los de la aplicación, presentes y futuros: private, dominio, publico, analitica...)
// y recrea `public`. La ranura de CI se reutiliza entre corridas, así que nada puede sobrevivir al reset.
// ESQUEMAS_STACK es una lista a mano: revisarla al subir la versión de Supabase (un esquema gestionado
// que falte se intentaría borrar con CASCADE).
const ESQUEMAS_STACK = ['auth', 'storage', 'extensions', 'graphql', 'graphql_public', 'realtime', '_realtime', 'vault', 'pgsodium', 'pgsodium_masks', 'supabase_functions', 'supabase_migrations', 'net', 'pgbouncer', 'cron', '_analytics', 'pgmq'];
const listaStack = ESQUEMAS_STACK.map((nombre) => `'${nombre}'`).join(', ');
await execute(`do $reset$ declare esquema text; begin
  for esquema in select nspname from pg_namespace
    where nspname not in (${listaStack}) and nspname not like 'pg\\_%' and nspname <> 'information_schema'
  loop execute format('drop schema if exists %I cascade', esquema); end loop;
  create schema public;
end $reset$;`);
const migrations = (await readdir(path.join(root, 'supabase/migrations'))).filter((file) => file.endsWith('.sql')).sort();
for (const migration of migrations) {
  console.log(`Aplicando supabase/migrations/${migration}...`);
  await execute(await readFile(path.join(root, 'supabase/migrations', migration), 'utf8'));
}
console.log('Sembrando supabase/seed.sql...');
await execute(await readFile(path.join(root, 'supabase/seed.sql'), 'utf8'));
