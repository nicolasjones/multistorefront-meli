import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const migrationsDir = path.resolve('supabase/migrations');
const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql'));
const prohibited = /\b(pg_net|net\.http|http_(get|post)|webhook)\b/i;
const offenders = [];

for (const file of files) {
  const contents = await readFile(path.join(migrationsDir, file), 'utf8');
  const executableSql = contents
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  if (prohibited.test(executableSql)) offenders.push(file);
}

if (offenders.length > 0) {
  console.error(`Frontera outbox inválida: SQL saliente en ${offenders.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('Frontera outbox válida: no hay HTTP, pg_net ni webhooks en migraciones SQL.');
}
