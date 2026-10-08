import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyVersionBumps } from './verificar-versiones-capacidades.mjs';

const previous = { schema_version: 1, capabilities: [{ id: 'worker-cycle', version: '1.0.0', paths: ['workers/'] }] };

test('exige incrementar SemVer cuando cambia el código de una capacidad', () => {
  const current = { ...previous, capabilities: [{ ...previous.capabilities[0], title: 'Ciclo', version: '1.0.0' }] };
  assert.deepEqual(verifyVersionBumps(previous, current, ['workers/worker.mjs']), [
    { id: 'worker-cycle', version: '1.0.0', paths: ['workers/worker.mjs'] },
  ]);
});

test('acepta la versión incrementada y los cambios ajenos a capacidades registradas', () => {
  const current = { ...previous, capabilities: [{ ...previous.capabilities[0], version: '1.1.0' }] };
  assert.deepEqual(verifyVersionBumps(previous, current, ['workers/worker.mjs']), []);
  assert.deepEqual(verifyVersionBumps(previous, previous, ['docs/guia.md']), []);
});

test('rechaza borrar una capacidad ya publicada', () => {
  assert.throws(() => verifyVersionBumps(previous, { schema_version: 1, capabilities: [] }, []), /no se pueden borrar/);
});

test('permite publicar el catálogo por primera vez', () => {
  assert.deepEqual(verifyVersionBumps({ schema_version: 1, capabilities: [] }, previous, ['template-capabilities.json']), []);
});
