import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Ninguna migración puede hacer HTTP saliente desde SQL: el envío va por un flow de Kestra o una Edge Function.
const prohibited = /\b(pg_net|net\.http|http_(get|post)|webhook)\b/i;
// `comment on … is '…';` es texto descriptivo, no SQL ejecutable: puede nombrar a un webhook (p. ej. «valida el
// destino de un webhook») sin que eso sea una llamada saliente.
const comentarioSql = /\bcomment\s+on\s+[^;']*?\bis\s+'(?:[^']|'')*'\s*;/gi;

export function sqlEjecutable(contents) {
  return contents
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .replace(comentarioSql, '');
}

export function violaFrontera(contents) {
  return prohibited.test(sqlEjecutable(contents));
}

async function main() {
  const migrationsDir = path.resolve('supabase/migrations');
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql'));
  const offenders = [];
  for (const file of files) {
    if (violaFrontera(await readFile(path.join(migrationsDir, file), 'utf8'))) offenders.push(file);
  }
  if (offenders.length > 0) {
    console.error(`Frontera outbox inválida: SQL saliente en ${offenders.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('Frontera outbox válida: no hay HTTP, pg_net ni webhooks en migraciones SQL.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
