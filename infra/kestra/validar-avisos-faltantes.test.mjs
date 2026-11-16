// Contrato estático del flow avisos-faltantes (MSF-405, F-STK-17, FR-308): barre los avisos de reposición
// llamando a la Edge Function, sin secretos en el YAML y sin tocar la base directamente.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FLOW = 'infra/kestra/flows/avisos-faltantes.yml';
const sinComentarios = (content) => content
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');
const leer = async () => sinComentarios(await readFile(FLOW, 'utf8'));

test('avisos-faltantes tiene un trigger Schedule cada minuto', async () => {
  const content = await leer();
  assert.match(content, /type: io\.kestra\.plugin\.core\.trigger\.Schedule/);
  assert.match(content, /cron: "\* \* \* \* \*"/);
});

test('avisos-faltantes llama por POST a la Edge Function con {"barrer": true}', async () => {
  const content = await leer();
  assert.match(content, /type: io\.kestra\.plugin\.core\.http\.Request/);
  assert.match(content, /uri: "\{\{ envs\.avisos_faltantes_url \}\}"/);
  assert.match(content, /method: POST/);
  assert.match(content, /body: '\{"barrer": true\}'/);
});

test('avisos-faltantes autentica con el token como secreto y no escribe ningún valor en el YAML', async () => {
  const content = await leer();
  assert.match(content, /x-aviso-token: "\{\{ secret\('AVISOS_FALTANTES_TOKEN'\) \}\}"/);
  assert.doesNotMatch(content, /x-aviso-token: "(?!\{\{)/, 'el token no puede ir literal');
  assert.doesNotMatch(content, /eyJ[A-Za-z0-9_-]{10,}/, 'no debe haber un JWT literal');
});

test('avisos-faltantes no habla con la base ni dispara HTTP desde SQL', async () => {
  const content = await leer();
  assert.doesNotMatch(content, /jdbc\.postgresql/, 'el envío y el estado los maneja la función');
  assert.doesNotMatch(content, /pg_net/);
});

test('el compose de Kestra expone las tres variables del flow', async () => {
  const compose = await readFile('infra/kestra/compose.yaml', 'utf8');
  assert.match(compose, /ENV_AVISOS_FALTANTES_URL:/);
  assert.match(compose, /ENV_AVISOS_FALTANTES_APIKEY:/);
  assert.match(compose, /SECRET_AVISOS_FALTANTES_TOKEN: \$\{SECRET_AVISOS_FALTANTES_TOKEN:-\}/);
});

test('el token de ejemplo de Kestra está en base64 (secret() lo decodifica)', async () => {
  const ejemplo = await readFile('infra/kestra/.env.example', 'utf8');
  const valor = ejemplo.match(/^SECRET_AVISOS_FALTANTES_TOKEN=(.+)$/m)?.[1];
  assert.ok(valor, 'falta SECRET_AVISOS_FALTANTES_TOKEN en infra/kestra/.env.example');
  assert.match(valor, /^[A-Za-z0-9+/]+={0,2}$/);
  assert.equal(Buffer.from(valor, 'base64').toString('utf8'), 'change-me-local');
  assert.doesNotMatch(ejemplo, /^AVISOS_FALTANTES_TOKEN=/m, 'el nombre sin SECRET_ ya no se usa');
});
