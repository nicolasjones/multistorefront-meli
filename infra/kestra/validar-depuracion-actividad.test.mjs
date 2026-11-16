// Contrato estático del flow depuracion-actividad (MSF-259, F-AUD-02, FR-009): corre programado, invoca la
// función de depuración con el rol de servicio de Kestra, sin secretos en el YAML y sin tragarse el error.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FLOW = 'infra/kestra/flows/depuracion-actividad.yml';
const sinComentarios = (content) => content
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');
const leer = async () => sinComentarios(await readFile(FLOW, 'utf8'));

test('depuracion-actividad tiene id, namespace de plataforma y un trigger Schedule diario', async () => {
  const content = await leer();
  assert.match(content, /^id: depuracion-actividad$/m);
  assert.match(content, /^namespace: platform\.auditoria$/m);
  assert.match(content, /type: io\.kestra\.plugin\.core\.trigger\.Schedule/);
  assert.match(content, /cron: "0 4 \* \* \*"/);
});

test('depuracion-actividad invoca private.depurar_registro_actividad con el rol de Kestra', async () => {
  const content = await leer();
  assert.match(content, /type: io\.kestra\.plugin\.jdbc\.postgresql\.Query/);
  assert.match(content, /sql: select private\.depurar_registro_actividad\(\)/);
  assert.match(content, /username: kestra_orquestacion/);
});

test('depuracion-actividad no escribe credenciales y falla visible (sin allowFailure)', async () => {
  const content = await leer();
  assert.match(content, /password: "\{\{ envs\.kestra_orquestacion_db_password \}\}"/);
  assert.doesNotMatch(content, /password: "(?!\{\{)/, 'la contraseña no puede ir literal');
  assert.doesNotMatch(content, /allowFailure/, 'un fallo de la función debe verse en la ejecución');
  assert.match(content, /retry:/);
});
