import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { discoverWorkers } from './descubrir-workers.mjs';

function createWorker(root, name, overrides = {}) {
  const directory = path.join(root, name);
  fs.mkdirSync(path.join(directory, 'src'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'src', 'index.ts'), 'export {};');
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({
    name: `@workers/${name}`,
    scripts: { build: 'tsc', lint: 'oxlint', test: 'vitest run', start: 'node dist/index.js' },
    ...overrides,
  }));
}

test('descubre workers válidos en orden estable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workers-discovery-'));
  createWorker(root, 'zeta');
  createWorker(root, 'alfa');
  fs.mkdirSync(path.join(root, 'fixtures'));

  assert.deepEqual(discoverWorkers(root).map((worker) => worker.id), ['alfa', 'zeta']);
});

test('rechaza un paquete con scripts incompletos', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workers-discovery-'));
  createWorker(root, 'incompleto', { scripts: { build: 'tsc' } });

  assert.throws(() => discoverWorkers(root), /debe declarar el script lint/);
});

test('rechaza un nombre de worker no portable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workers-discovery-'));
  createWorker(root, 'Worker_Windows');

  assert.throws(() => discoverWorkers(root), /Nombre de worker inválido/);
});
