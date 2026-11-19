// Contrato estático del flow purgar-consultas-tienda (MSF-944, seguimiento de MSF-176, D-20/D-21):
// la retención de las consultas y las notas de presupuestos de la tienda la dispara Kestra (en el
// repo no hay pg_cron) y solo purga lo vencido con el rol de servicio.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FLOW = 'infra/kestra/flows/purgar-consultas-tienda.yml';

const sinComentarios = (content) => content
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');

const leer = async () => sinComentarios(await readFile(FLOW, 'utf8'));

test('purgar-consultas-tienda tiene un trigger Schedule diario', async () => {
  const content = await leer();
  assert.match(content, /^id: purgar-consultas-tienda$/m);
  assert.match(content, /^namespace: producto\.ventas$/m);
  assert.match(content, /type: io\.kestra\.plugin\.core\.trigger\.Schedule/);
  assert.match(content, /cron: "\d{1,2} \d{1,2} \* \* \*"/, 'minuto y hora fijos, todos los días');
});

test('la purga llama a la función de retención con el rol de servicio', async () => {
  const content = await leer();
  assert.match(content, /private\.purgar_consultas_tienda\(CAST\(:retencion AS integer\)\)/);
  assert.match(content, /retencion: "\{\{ inputs\.retencion_dias \?\? envs\.tienda_consultas_retencion_dias \?\? 180 \}\}"/);
  assert.match(content, /username: kestra_orquestacion/);
  assert.doesNotMatch(content, /delete\s+from\s+dominio\./i, 'la base borra; el flow no borra');
});

test('un fallo de la purga avisa y no se traga el error', async () => {
  const content = await leer();
  assert.match(content, /^errors:$/m);
  assert.match(content, /flowId: aviso-fallo-api/);
  assert.match(content, /flujo: purgar-consultas-tienda/);
});

test('la variable de retención se declara en el Compose y en .env.example', async () => {
  const [compose, ejemplo] = await Promise.all([
    readFile('infra/kestra/compose.yaml', 'utf8'),
    readFile('infra/kestra/.env.example', 'utf8'),
  ]);
  assert.match(compose, /ENV_TIENDA_CONSULTAS_RETENCION_DIAS: \$\{TIENDA_CONSULTAS_RETENCION_DIAS:-180\}/);
  assert.match(ejemplo, /^TIENDA_CONSULTAS_RETENCION_DIAS=180$/m);
});
