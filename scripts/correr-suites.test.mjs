import assert from 'node:assert/strict';
import test from 'node:test';
import { correrSuites } from './correr-suites.mjs';

const sinSalida = { write() {} };

test('corre todas las suites aunque alguna falle y devuelve 1 con el resumen', () => {
  const corridas = [];
  const estados = { a: 0, b: 3, c: 0, d: 1 };
  const r = correrSuites(['a', 'b', 'c', 'd'], {
    ejecutar: (c) => { corridas.push(c); return estados[c]; },
    salida: sinSalida,
  });
  assert.deepEqual(corridas, ['a', 'b', 'c', 'd']);
  assert.equal(r.codigo, 1);
  assert.deepEqual(r.fallidas.map((f) => f.comando), ['b', 'd']);
});

test('reporta la señal que mató a la suite y pasa el timeout configurado', () => {
  let timeoutVisto;
  let salida = '';
  const r = correrSuites(['a'], {
    ejecutar: (_c, t) => { timeoutVisto = t; return { estado: 1, senal: 'SIGKILL' }; },
    salida: { write: (x) => { salida += x; } },
    timeoutS: 7,
  });
  assert.equal(timeoutVisto, 7000);
  assert.equal(r.codigo, 1);
  assert.match(salida, /murió por SIGKILL/);
});

test('el binario mata una suite colgada con --timeout y lo informa', async () => {
  const { spawnSync } = await import('node:child_process');
  const script = new URL('./correr-suites.mjs', import.meta.url).pathname;
  const r = spawnSync(process.execPath, [script, '--timeout', '1', 'node -e "setTimeout(()=>{},60000)"'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /murió por SIGKILL/);
});

test('devuelve 0 si todas pasan', () => {
  assert.equal(correrSuites(['a', 'b'], { ejecutar: () => 0, salida: sinSalida }).codigo, 0);
});

test('el binario real sale con 1 si una suite falla y 0 si no', async () => {
  const { spawnSync } = await import('node:child_process');
  const script = new URL('./correr-suites.mjs', import.meta.url).pathname;
  const mal = spawnSync(process.execPath, [script, 'node -e "process.exit(0)"', 'node -e "process.exit(2)"', 'node -e "process.exit(0)"'], { encoding: 'utf8' });
  assert.equal(mal.status, 1);
  assert.match(mal.stdout, /Resumen: 2\/3 suites OK/);
  assert.match(mal.stdout, /FALLÓ \(exit 2\)/);
  const bien = spawnSync(process.execPath, [script, 'node -e "process.exit(0)"'], { encoding: 'utf8' });
  assert.equal(bien.status, 0);
});

test('CORRER_SUITES_TIMEOUT_S y --timeout inválidos salen con 2 y mensaje claro, sin stack', async () => {
  const { spawnSync } = await import('node:child_process');
  const script = new URL('./correr-suites.mjs', import.meta.url).pathname;
  for (const crudo of ['abc', '0', '-5', 'Infinity', '999999']) {
    const env = { ...process.env, CORRER_SUITES_TIMEOUT_S: crudo };
    const r = spawnSync(process.execPath, [script, 'node -e "0"'], { encoding: 'utf8', env });
    assert.equal(r.status, 2, crudo);
    assert.match(r.stderr, /CORRER_SUITES_TIMEOUT_S debe ser/);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  }
  const r = spawnSync(process.execPath, [script, '--timeout', 'x', 'node -e "0"'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--timeout debe ser/);
  const ok = spawnSync(process.execPath, [script, 'node -e "0"'], { encoding: 'utf8', env: { ...process.env, CORRER_SUITES_TIMEOUT_S: '30' } });
  assert.equal(ok.status, 0);
});
