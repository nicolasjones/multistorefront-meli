import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { compareAdoption } from './verificar-adopcion-template.mjs';

test('workflow sincroniza issues por tÃ­tulo sin depender de etiquetas preexistentes', async () => {
  const workflow = await readFile(path.resolve('.github/workflows/sync-template.yml'), 'utf8');
  assert.doesNotMatch(workflow, /gh label create|--label template-sync/);
  assert.match(workflow, /select\(\.title == "Configurar lectura del template"\)/);
  assert.match(workflow, /select\(.*pendiente del template/);
});

const catalog = {
  schema_version: 1,
  template_repository: 'example/platform-template',
  capabilities: [
    { id: 'execution-cycle', version: '1.2.0', title: 'Ciclo de ejecución' },
    { id: 'analytics', version: '1.0.0', title: 'Analítica' },
  ],
};
const adoption = {
  schema_version: 1,
  template_repository: catalog.template_repository,
  product: 'producto-a',
  capabilities: {
    'execution-cycle': { version: '1.2.0', status: 'adopted' },
    analytics: { version: '1.0.0', status: 'adopted' },
  },
};

test('manifiesto alineado no reporta commits ni capacidades pendientes', () => {
  assert.deepEqual(compareAdoption(catalog, adoption), {
    ok: true,
    product: 'producto-a',
    template_repository: catalog.template_repository,
    pending: [],
    current: [
      { id: 'execution-cycle', version: '1.2.0' },
      { id: 'analytics', version: '1.0.0' },
    ],
    excluded: [],
  });
});

test('capacidad nueva o desactualizada aparece como pendiente', () => {
  const result = compareAdoption(catalog, {
    ...adoption,
    capabilities: { 'execution-cycle': { version: '1.1.0', status: 'adopted' } },
  });
  assert.deepEqual(result.pending.map(({ id, adopted_version, current_version }) => [id, adopted_version, current_version]), [
    ['execution-cycle', '1.1.0', '1.2.0'],
    ['analytics', null, '1.0.0'],
  ]);
  assert.equal(result.ok, false);
});

test('exclusión requiere y conserva un motivo sin marcar pendiente', () => {
  const result = compareAdoption(catalog, {
    ...adoption,
    capabilities: {
      'execution-cycle': { version: '1.2.0', status: 'adopted' },
      analytics: { status: 'not-applicable', reason: 'El producto no ofrece analítica.' },
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.excluded, [{ id: 'analytics', status: 'not-applicable', reason: 'El producto no ofrece analítica.' }]);
});

test('postergación con versión al día sigue visible como pendiente', () => {
  const result = compareAdoption(catalog, {
    ...adoption,
    capabilities: {
      'execution-cycle': { version: '1.2.0', status: 'deferred', reason: 'Requiere reconciliación.' },
      analytics: adoption.capabilities.analytics,
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.pending[0].status, 'deferred');
});

test('rechaza versiones futuras, ids desconocidos y catálogos duplicados', () => {
  assert.throws(() => compareAdoption(catalog, {
    ...adoption,
    capabilities: { ...adoption.capabilities, 'execution-cycle': { version: '2.0.0', status: 'adopted' } },
  }), /posterior/);
  assert.throws(() => compareAdoption(catalog, {
    ...adoption,
    capabilities: { ...adoption.capabilities, retired: { version: '1.0.0', status: 'adopted' } },
  }), /ausente del catálogo/);
  assert.throws(() => compareAdoption({ ...catalog, capabilities: [...catalog.capabilities, catalog.capabilities[0]] }, adoption), /repite/);
});

test('CLI devuelve código 1 con JSON sanitizado al detectar pendiente', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'adopcion-template-'));
  const catalogFile = path.join(directory, 'catalog.json');
  const adoptionFile = path.join(directory, 'adoption.json');
  const script = path.resolve('scripts/verificar-adopcion-template.mjs');
  try {
    await writeFile(catalogFile, JSON.stringify(catalog));
    await writeFile(adoptionFile, JSON.stringify({ ...adoption, capabilities: {} }));
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, [script, '--catalog', catalogFile, '--adoption', adoptionFile, '--json', '--check'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
    assert.equal(result.code, 1);
    assert.equal(result.stderr, '');
    assert.equal(JSON.parse(result.stdout).pending.length, 2);
    assert.doesNotMatch(result.stdout, /token|authorization|secret/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
