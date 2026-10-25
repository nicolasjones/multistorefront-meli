// Contrato estático del flow avisos-reposicion-stock (MSF-394, F-STK-09, FR-205): barre el resumen de
// reposición llamando a la Edge Function, sin secretos en el YAML y sin tocar la base directamente.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FLOW = 'infra/kestra/flows/avisos-reposicion-stock.yml';
const sinComentarios = (content) => content
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');
const leer = async () => sinComentarios(await readFile(FLOW, 'utf8'));

test('avisos-reposicion-stock tiene un trigger Schedule diario', async () => {
  const content = await leer();
  assert.match(content, /type: io\.kestra\.plugin\.core\.trigger\.Schedule/);
  assert.match(content, /cron: "\d{1,2} \d{1,2} \* \* \*"/, 'minuto y hora fijos, todos los días');
});

test('avisos-reposicion-stock llama por POST a la Edge Function con {"barrer": true}', async () => {
  const content = await leer();
  assert.match(content, /type: io\.kestra\.plugin\.core\.http\.Request/);
  assert.match(content, /uri: "\{\{ envs\.avisos_reposicion_url \}\}"/);
  assert.match(content, /method: POST/);
  assert.match(content, /body: '\{"barrer": true\}'/);
});

test('avisos-reposicion-stock autentica con el token como secreto y no escribe ningún valor en el YAML', async () => {
  const content = await leer();
  assert.match(content, /x-aviso-token: "\{\{ secret\('AVISOS_REPOSICION_TOKEN'\) \}\}"/);
  assert.doesNotMatch(content, /x-aviso-token: "(?!\{\{)/, 'el token no puede ir literal');
  assert.doesNotMatch(content, /eyJ[A-Za-z0-9_-]{10,}/, 'no debe haber un JWT literal');
});

test('avisos-reposicion-stock no habla con la base ni dispara HTTP desde SQL', async () => {
  const content = await leer();
  assert.doesNotMatch(content, /jdbc\.postgresql/, 'el cálculo y el estado los maneja la función');
  assert.doesNotMatch(content, /pg_net/);
});

test('el compose de Kestra expone las tres variables del flow', async () => {
  const compose = await readFile('infra/kestra/compose.yaml', 'utf8');
  assert.match(compose, /ENV_AVISOS_REPOSICION_URL:/);
  assert.match(compose, /ENV_AVISOS_REPOSICION_APIKEY:/);
  assert.match(compose, /SECRET_AVISOS_REPOSICION_TOKEN: \$\{SECRET_AVISOS_REPOSICION_TOKEN:-\}/);
});

test('el token de ejemplo de Kestra está en base64 y coincide con el de la función', async () => {
  const ejemplo = await readFile('infra/kestra/.env.example', 'utf8');
  const valor = ejemplo.match(/^SECRET_AVISOS_REPOSICION_TOKEN=(.+)$/m)?.[1];
  assert.ok(valor, 'falta SECRET_AVISOS_REPOSICION_TOKEN en infra/kestra/.env.example');
  assert.match(valor, /^[A-Za-z0-9+/]+={0,2}$/);
  const funcion = await readFile('supabase/functions/.env.example', 'utf8');
  const plano = funcion.match(/^AVISOS_REPOSICION_TOKEN=(.+)$/m)?.[1];
  assert.equal(Buffer.from(valor, 'base64').toString('utf8'), plano, 'decodificado debe igualar al de la función');
  assert.doesNotMatch(ejemplo, /^AVISOS_REPOSICION_TOKEN=/m, 'el nombre sin SECRET_ no se usa en Kestra');
});
