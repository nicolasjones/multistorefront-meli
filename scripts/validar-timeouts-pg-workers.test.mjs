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

// Comportamiento: se evalúa el mismo `topeMs` que lleva cada infra.ts (sin tipos), idéntico en los 5 workers.
const extraerTopeMs = (ruta) => {
  const bloque = readFileSync(ruta, 'utf8').match(/const topeMs = [\s\S]*?\n\};/)?.[0];
  assert.ok(bloque, `${ruta}: falta topeMs`);
  const js = bloque.replace('(valor: string | undefined, porDefecto: number): number =>', '(valor, porDefecto) =>');
  return { js, fn: new Function(`${js}\nreturn topeMs;`)() };
};

test('topeMs es idéntico en todos los workers', () => {
  const cuerpos = new Set(workers.map((ruta) => extraerTopeMs(ruta).js));
  assert.equal(cuerpos.size, 1);
});

for (const ruta of workers) {
  test(`${ruta}: topeMs acepta solo enteros entre 1 y 2147483647`, () => {
    const { fn } = extraerTopeMs(ruta);
    const D = 777;
    for (const invalido of [undefined, '', '0', '-5', 'abc', '1.5', 'NaN', '1e21', '99999999999999999999', '2147483648']) {
      assert.equal(fn(invalido, D), D, `${ruta}: ${String(invalido)} debe caer al default`);
    }
    assert.equal(fn('1', D), 1);
    assert.equal(fn('2147483647', D), 2147483647);
    assert.equal(fn('300000', D), 300000);
  });
}
