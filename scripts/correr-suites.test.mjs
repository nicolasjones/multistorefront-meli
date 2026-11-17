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

test('devuelve 0 si todas pasan', () => {
  assert.equal(correrSuites(['a', 'b'], { ejecutar: () => 0, salida: sinSalida }).codigo, 0);
});

test('el binario real sale con 1 si una suite falla y 0 si no', async () => {
  const { spawnSync } = await import('node:child_process');
  const script = new URL('./correr-suites.mjs', import.meta.url).pathname;
  const mal = spawnSync(process.execPath, [script, 'node -e "process.exit(0)"', 'node -e "process.exit(2)"', 'node -e "process.exit(0)"'], { encoding: 'utf8' });
  assert.equal(mal.status, 1);
  assert.match(mal.stdout, /1\/3|2\/3/);
  assert.match(mal.stdout, /FALLÓ \(exit 2\)/);
  const bien = spawnSync(process.execPath, [script, 'node -e "process.exit(0)"'], { encoding: 'utf8' });
  assert.equal(bien.status, 0);
});
