// Contrato estático del flow depuracion-monitoreo (épica MSF-206, revisión independiente): corre a diario, invoca la
// función de retención con el rol de servicio de Kestra, sin secretos en el YAML y sin tragarse el error.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FLOW = 'infra/kestra/flows/depuracion-monitoreo.yml';
const leer = async () => (await readFile(FLOW, 'utf8'))
  .split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');

test('depuracion-monitoreo tiene id, namespace de monitoreo y un trigger Schedule diario', async () => {
  const content = await leer();
  assert.match(content, /^id: depuracion-monitoreo$/m);
  assert.match(content, /^namespace: platform\.monitoreo$/m);
  assert.match(content, /type: io\.kestra\.plugin\.core\.trigger\.Schedule/);
  assert.match(content, /cron: "30 4 \* \* \*"/);
});

test('depuracion-monitoreo invoca private.depurar_monitoreo_y_procesos con el rol de Kestra', async () => {
  const content = await leer();
  assert.match(content, /type: io\.kestra\.plugin\.jdbc\.postgresql\.Query/);
  assert.match(content, /sql: select \* from private\.depurar_monitoreo_y_procesos\(\)/);
  assert.match(content, /username: kestra_orquestacion/);
});

test('depuracion-monitoreo no escribe credenciales y falla visible (sin allowFailure)', async () => {
  const content = await leer();
  assert.match(content, /password: "\{\{ envs\.kestra_orquestacion_db_password \}\}"/);
  assert.doesNotMatch(content, /password: "(?!\{\{)/, 'la contraseña no puede ir literal');
  assert.doesNotMatch(content, /allowFailure/, 'un fallo de la función debe verse en la ejecución');
  assert.match(content, /retry:/);
});
