// Contrato estático del flow monitoreo-salud-tiendas (MSF-369, F-OPS-03, FR-025): sondeo cada 2 minutos
// de las tiendas con dominio, sin seguir redirecciones a otros hosts (no abre un SSRF) y sin secretos.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FLOW = 'infra/kestra/flows/monitoreo-salud-tiendas.yml';
const leer = async () => (await readFile(FLOW, 'utf8'))
  .split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');

test('sondea cada 2 minutos', async () => {
  const content = await leer();
  assert.match(content, /type: io\.kestra\.plugin\.core\.trigger\.Schedule/);
  assert.match(content, /cron: "\*\/2 \* \* \* \*"/);
});

test('lista las tiendas por la función dedicada y registra por registrar_evento_monitoreo', async () => {
  const content = await leer();
  assert.match(content, /public\.tiendas_a_sondear\(\)/);
  assert.match(content, /public\.registrar_evento_monitoreo\('tienda'/);
  assert.match(content, /username: kestra_orquestacion/);
});

test('pide solo el dominio de la tienda, fijando la IP validada, sin seguir redirecciones', async () => {
  const content = await leer();
  assert.match(content, /https\.request\(\{\n\s+host: dominio,/);
  assert.match(content, /clasificarIp\(address\)/);
  assert.match(content, /NO_SONDEABLE_/);
  assert.doesNotMatch(content, /followRedirects: true/);
});

test('un sondeo bloqueado o caído no corta el barrido y no hay secretos literales', async () => {
  const content = await leer();
  assert.match(content, /resultado: 'no_sondeable'/);
  assert.match(content, /jsonb_to_recordset/);
  assert.doesNotMatch(content, /password: "(?!\{\{)/);
  assert.doesNotMatch(content, /eyJ[A-Za-z0-9_-]{10,}/);
});
