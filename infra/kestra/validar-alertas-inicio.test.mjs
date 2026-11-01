// Contrato estático del flow alertas-inicio (MSF-361, F-INI-02, FR-022): recalcula las alertas de Inicio
// llamando a la Edge Function, sin secretos en el YAML y sin tocar la base directamente.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FLOW = 'infra/kestra/flows/alertas-inicio.yml';
const sinComentarios = (content) => content
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');
const leer = async () => sinComentarios(await readFile(FLOW, 'utf8'));

test('alertas-inicio tiene un trigger Schedule cada 15 minutos', async () => {
  const content = await leer();
  assert.match(content, /type: io\.kestra\.plugin\.core\.trigger\.Schedule/);
  assert.match(content, /cron: "\*\/15 \* \* \* \*"/);
});

test('alertas-inicio llama por POST a la Edge Function con {"barrer": true}', async () => {
  const content = await leer();
  assert.match(content, /type: io\.kestra\.plugin\.core\.http\.Request/);
  assert.match(content, /uri: "\{\{ envs\.alertas_inicio_url \}\}"/);
  assert.match(content, /method: POST/);
  assert.match(content, /body: '\{"barrer": true\}'/);
});

test('alertas-inicio autentica con el token como secreto y no escribe ningún valor en el YAML', async () => {
  const content = await leer();
  assert.match(content, /x-aviso-token: "\{\{ secret\('ALERTAS_INICIO_TOKEN'\) \}\}"/);
  assert.doesNotMatch(content, /x-aviso-token: "(?!\{\{)/, 'el token no puede ir literal');
  assert.doesNotMatch(content, /eyJ[A-Za-z0-9_-]{10,}/, 'no debe haber un JWT literal');
});

test('alertas-inicio reintenta y no habla con la base ni dispara HTTP desde SQL', async () => {
  const content = await leer();
  assert.match(content, /retry:/);
  assert.doesNotMatch(content, /jdbc\.postgresql/, 'el cálculo y el estado los maneja la función');
  assert.doesNotMatch(content, /pg_net/);
});
