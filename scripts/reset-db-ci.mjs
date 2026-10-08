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

await execute('drop schema if exists public cascade; drop schema if exists private cascade; drop schema if exists dominio cascade; create schema public;');
const migrations = (await readdir(path.join(root, 'supabase/migrations'))).filter((file) => file.endsWith('.sql')).sort();
for (const migration of migrations) {
  console.log(`Aplicando supabase/migrations/${migration}...`);
  await execute(await readFile(path.join(root, 'supabase/migrations', migration), 'utf8'));
}
console.log('Sembrando supabase/seed.sql...');
await execute(await readFile(path.join(root, 'supabase/seed.sql'), 'utf8'));
