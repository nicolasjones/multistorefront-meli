import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('rechaza un entorno incompleto sin revelar un valor sensible', () => {
  const sentinel = 'NO_DEBE_APARECER_EN_SALIDA';
  const result = spawnSync(process.execPath, ['infra/kestra/sincronizar-rol-orquestacion.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, KESTRA_ORQUESTACION_DB_PASSWORD: '' },
  });

  const output = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(output, /KESTRA_ORQUESTACION_DB_PASSWORD/);
  assert.doesNotMatch(output, new RegExp(sentinel));
});
