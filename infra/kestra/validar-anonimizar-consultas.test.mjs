// Contrato estático del flow anonimizar-consultas (retención de consultas, lote 39): corre una vez por mes, invoca la función de
// anonimización con el rol de servicio de Kestra, avisa si falla, no escribe credenciales y no tiene salida a internet.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FLOW = 'infra/kestra/flows/anonimizar-consultas.yml';
const sinComentarios = (content) => content
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');
const leer = async () => sinComentarios(await readFile(FLOW, 'utf8'));

test('anonimizar-consultas tiene id, namespace y un trigger Schedule mensual', async () => {
  const content = await leer();
  assert.match(content, /^id: anonimizar-consultas$/m);
  assert.match(content, /^namespace: producto\.clientes$/m);
  assert.match(content, /type: io\.kestra\.plugin\.core\.trigger\.Schedule/);
  assert.match(content, /cron: "\d{1,2} \d{1,2} 1 \* \*"/, 'minuto y hora fijos, el día 1 de cada mes');
});

test('anonimizar-consultas invoca la función con el plazo de 24 meses y el rol de Kestra', async () => {
  const content = await leer();
  assert.match(content, /sql: select private\.anonimizar_consultas_antiguas\(CAST\(:meses AS integer\)\)/);
  assert.match(content, /meses: "\{\{ inputs\.meses \?\? 24 \}\}"/);
  assert.match(content, /username: kestra_orquestacion/);
  assert.doesNotMatch(content, /update\s+dominio\.consultas|delete\s+from/i, 'la base anonimiza; el flow no escribe SQL propio');
});

test('anonimizar-consultas no escribe credenciales, falla visible y avisa', async () => {
  const content = await leer();
  assert.match(content, /password: "\{\{ envs\.kestra_orquestacion_db_password \}\}"/);
  assert.doesNotMatch(content, /password: "(?!\{\{)/, 'la contraseña no puede ir literal');
  assert.doesNotMatch(content, /allowFailure/, 'un fallo de la función debe verse en la ejecución');
  assert.match(content, /timeout: PT\d+M/);
  assert.match(content, /^errors:\n {2}- id: avisar_fallo[\s\S]*flowId: aviso-fallo-flujo/m);
  assert.doesNotMatch(content.slice(content.search(/^errors:/m)), /errorLogs\(\)/, 'el aviso no viaja el mensaje del error');
  assert.match(content, /^concurrency:\n {2}limit: 1\n {2}behavior: CANCEL/m);
});

test('anonimizar-consultas solo habla con la base: no hay salida a internet ni worker', async () => {
  const content = await leer();
  assert.doesNotMatch(content, /plugin\.core\.http|plugin\.scripts|plugin\.notifications|https?:\/\//, 'solo la tarea de base de datos');
  const egress = JSON.parse(await readFile('workers/egress-allowlists.json', 'utf8'));
  assert.ok(!JSON.stringify(egress).includes('anonimizar-consultas'), 'un flow solo-SQL no figura en la lista de egress de los workers');
});
