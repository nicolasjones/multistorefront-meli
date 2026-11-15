// Pruebas de la reparación del runner tras una autoactualización interrumpida.
// Ejecutar: `pnpm test:runner:selfheal` (o `node --test infra/runner/restaurar-bin.test.mjs`).
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { restaurarBin, respaldoUsable, tieneBin } from './restaurar-bin.mjs';

function runnerFixture(respaldo) {
  const dir = mkdtempSync(path.join(tmpdir(), 'runner-selfheal-'));
  if (respaldo) {
    mkdirSync(path.join(dir, `bin.${respaldo}`));
    writeFileSync(path.join(dir, `bin.${respaldo}`, 'Runner.Listener'), 'x');
  }
  return dir;
}

function listener(dir) {
  return path.join(dir, 'bin', 'Runner.Listener');
}

test('con bin sano no hace nada', () => {
  const dir = runnerFixture();
  try {
    mkdirSync(path.join(dir, 'bin'));
    writeFileSync(listener(dir), 'x');
    assert.equal(tieneBin(dir), true);
    assert.equal(restaurarBin(dir), null);
    assert.equal(existsSync(listener(dir)), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('con bin ausente lo restaura del respaldo', () => {
  const dir = runnerFixture('2.337.0');
  try {
    assert.equal(tieneBin(dir), false);
    assert.equal(respaldoUsable(dir), 'bin.2.337.0');
    assert.equal(restaurarBin(dir), 'bin.2.337.0');
    assert.equal(tieneBin(dir), true);
    // El respaldo se CONSUME: queda movido a `bin`, no duplicado.
    assert.equal(existsSync(path.join(dir, 'bin.2.337.0')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('con varios respaldos usa el más nuevo', () => {
  const dir = runnerFixture('2.337.0');
  try {
    mkdirSync(path.join(dir, 'bin.2.338.2'));
    writeFileSync(path.join(dir, 'bin.2.338.2', 'Runner.Listener'), 'x');
    assert.equal(respaldoUsable(dir), 'bin.2.338.2');
    assert.equal(restaurarBin(dir), 'bin.2.338.2');
    assert.equal(tieneBin(dir), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sin bin ni respaldo no inventa nada (queda el crash-loop para que lo vea el log)', () => {
  const dir = runnerFixture();
  try {
    assert.equal(respaldoUsable(dir), null);
    assert.equal(restaurarBin(dir), null);
    assert.equal(tieneBin(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('un respaldo sin Runner.Listener no sirve', () => {
  const dir = runnerFixture();
  try {
    mkdirSync(path.join(dir, 'bin.2.337.0'));
    writeFileSync(path.join(dir, 'bin.2.337.0', 'otro.txt'), 'x');
    assert.equal(respaldoUsable(dir), null);
    assert.equal(restaurarBin(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
