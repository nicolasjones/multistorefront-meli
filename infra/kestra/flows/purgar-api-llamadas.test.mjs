// Contrato estático del flow purgar-api-llamadas (MSF-403, F-API-01, FR-008, D-10): la retención de
// 90 días de la auditoría de la API la dispara Kestra (en el repo no hay pg_cron) y solo borra lo
// vencido.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FLOW = 'infra/kestra/flows/purgar-api-llamadas.yml';

const sinComentarios = (content) => content
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');

const leer = async () => sinComentarios(await readFile(FLOW, 'utf8'));

test('purgar-api-llamadas tiene un trigger Schedule diario', async () => {
  const content = await leer();
  assert.match(content, /^id: purgar-api-llamadas$/m);
  assert.match(content, /^namespace: platform\.api$/m);
  assert.match(content, /type: io\.kestra\.plugin\.core\.trigger\.Schedule/);
  assert.match(content, /cron: "\d{1,2} \d{1,2} \* \* \*"/, 'minuto y hora fijos, todos los días');
});

test('la purga llama a la función de retención con el rol de servicio', async () => {
  const content = await leer();
  assert.match(content, /private\.purgar_api_llamadas\(CAST\(:retencion AS integer\)\)/);
  assert.match(content, /retencion: "\{\{ inputs\.retencion_dias \?\? envs\.api_auditoria_retencion_dias \?\? 90 \}\}"/);
  assert.match(content, /username: kestra_orquestacion/);
  assert.doesNotMatch(content, /delete\s+from\s+public\.api_llamadas/i, 'la base borra; el flow no borra');
});

test('la variable de retención se declara en el Compose y en .env.example', async () => {
  const [compose, ejemplo] = await Promise.all([
    readFile('infra/kestra/compose.yaml', 'utf8'),
    readFile('infra/kestra/.env.example', 'utf8'),
  ]);
  assert.match(compose, /ENV_API_AUDITORIA_RETENCION_DIAS: \$\{API_AUDITORIA_RETENCION_DIAS:-/);
  assert.match(ejemplo, /^API_AUDITORIA_RETENCION_DIAS=/m);
});
