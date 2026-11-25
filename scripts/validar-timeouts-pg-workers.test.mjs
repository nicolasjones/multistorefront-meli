// Todo worker abre su pool de Postgres con topes de conexión, consulta e inactividad (MSF-871).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const workers = readdirSync('workers', { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
  .map((d) => `workers/${d.name}/src/infra.ts`)
  .filter((ruta) => {
    try {
      return /new pg\.Pool\(/.test(readFileSync(ruta, 'utf8'));
    } catch {
      return false;
    }
  });

test('hay workers con pool de Postgres que verificar', () => {
  assert.ok(workers.length >= 5, `solo ${workers.length}`);
});

for (const ruta of workers) {
  test(`${ruta}: el pool lleva statement_timeout, connectionTimeoutMillis e idleTimeoutMillis`, () => {
    const texto = readFileSync(ruta, 'utf8');
    const pool = texto.match(/new pg\.Pool\(\{([\s\S]*?)\}\)/)?.[1] ?? '';
    for (const opcion of ['statement_timeout', 'connectionTimeoutMillis', 'idleTimeoutMillis']) {
      assert.match(pool, new RegExp(`${opcion}: topeMs\\(`), `${ruta}: falta ${opcion}`);
    }
    for (const variable of ['WORKER_PG_STATEMENT_TIMEOUT_MS', 'WORKER_PG_CONNECT_TIMEOUT_MS', 'WORKER_PG_IDLE_TIMEOUT_MS']) {
      assert.ok(texto.includes(variable), `${ruta}: falta ${variable}`);
    }
  });
}
