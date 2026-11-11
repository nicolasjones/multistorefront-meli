// Contrato estático del flow entregar-webhooks-api (MSF-403, F-API-01, FR-012, SC-003): el reparto de
// los eventos a las suscripciones, la entrega por la Edge Function con la clave de servicio y la
// espera creciente la deja la base. Ningún secreto en el YAML y nada de HTTP desde SQL.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FLOW = 'infra/kestra/flows/entregar-webhooks-api.yml';

const sinComentarios = (content) => content
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');

const leer = async () => sinComentarios(await readFile(FLOW, 'utf8'));

/** Texto de una tarea (desde su `- id:` hasta el siguiente `- id:` del mismo nivel). */
const tarea = (content, id) => {
  const inicio = content.search(new RegExp(`^( *)- id: ${id}$`, 'm'));
  assert.ok(inicio >= 0, `existe la tarea ${id}`);
  const resto = content.slice(inicio);
  const sangria = /^( *)- id:/.exec(resto)[1];
  const siguiente = resto.slice(1).search(new RegExp(`^${sangria}- id:`, 'm'));
  return siguiente < 0 ? resto : resto.slice(0, siguiente + 1);
};

test('entregar-webhooks-api corre cada minuto en el namespace de plataforma', async () => {
  const content = await leer();
  assert.match(content, /^id: entregar-webhooks-api$/m);
  assert.match(content, /^namespace: platform\.api$/m);
  assert.match(content, /type: io\.kestra\.plugin\.core\.trigger\.Schedule/);
  assert.match(content, /cron: "\* \* \* \* \*"/);
});

test('reclama los tres tipos de evento con lease y 5 intentos', async () => {
  const reclamo = tarea(await leer(), 'reclamar_eventos');
  assert.match(reclamo, /private\.api_reclamar_eventos_api\(ARRAY\['stock\.actualizado', 'precio\.actualizado', 'venta\.registrada'\], CAST\(:lote AS integer\), \d+, 5\)/);
  assert.match(reclamo, /lote: "\{\{ inputs\.lote \?\? envs\.api_webhooks_lote \?\? \d+ \}\}"/);
  assert.match(reclamo, /username: kestra_orquestacion/, 'usa el rol de servicio de Kestra');
});

test('reparte el evento en una entrega por suscripción y confirma el evento', async () => {
  const repartir = tarea(await leer(), 'repartir');
  const generar = tarea(repartir, 'generar_entregas');
  assert.match(generar, /private\.api_fanout_evento\(CAST\(:evento_id AS uuid\)\)/);
  const confirmar = tarea(repartir, 'confirmar_evento');
  assert.match(confirmar, /private\.resolver_evento\(CAST\(:evento_id AS uuid\), CAST\(:intento AS integer\), 'confirmar', NULL, \d+, 5\)/);
  assert.match(confirmar, /intento: "\{\{ fromJson\(parent\.taskrun\.value\)\.intento \}\}"/, 'confirma con el intento real del reclamo');
});

test('reclama las entregas pendientes con lease de 60 s', async () => {
  const reclamo = tarea(await leer(), 'reclamar_entregas');
  assert.match(reclamo, /private\.api_reclamar_entregas\(CAST\(:lote AS integer\), 60\)/);
  assert.match(reclamo, /fetchType: FETCH/);
});

test('entrega por la Edge Function con la clave de servicio como secreto', async () => {
  const entrega = tarea(await leer(), 'entregar_aviso');
  assert.match(entrega, /type: io\.kestra\.plugin\.core\.http\.Request/);
  assert.match(entrega, /uri: "\{\{ envs\.entregar_webhook_url \}\}"/);
  assert.match(entrega, /method: POST/);
  assert.match(entrega, /apikey: "\{\{ secret\('ENTREGAR_WEBHOOK_APIKEY'\) \}\}"/);
  assert.match(entrega, /Authorization: "Bearer \{\{ secret\('ENTREGAR_WEBHOOK_APIKEY'\) \}\}"/);
  assert.match(entrega, /body: '\{"entrega_id": "\{\{ fromJson\(parent\.taskrun\.value\)\.id \}\}"\}'/);
  assert.match(entrega, /timeout: PT\d+S/);
  assert.doesNotMatch(entrega, /retry:/, 'el reintento lo gobierna la base, no Kestra');
});

test('el flow no lleva secretos ni habla con la base desde SQL', async () => {
  const content = await leer();
  assert.doesNotMatch(content, /eyJ[A-Za-z0-9_-]{10,}/, 'ningún JWT literal');
  assert.doesNotMatch(content, /pg_net/);
  assert.doesNotMatch(content, /service_role['"]?\s*:\s*['"][A-Za-z0-9]/, 'ninguna clave literal');
});

test('las variables del flow se declaran en el Compose y en .env.example', async () => {
  const [compose, ejemplo] = await Promise.all([
    readFile('infra/kestra/compose.yaml', 'utf8'),
    readFile('infra/kestra/.env.example', 'utf8'),
  ]);
  assert.match(compose, /ENV_ENTREGAR_WEBHOOK_URL: \$\{ENTREGAR_WEBHOOK_URL:-/);
  assert.match(compose, /SECRET_ENTREGAR_WEBHOOK_APIKEY: \$\{SECRET_ENTREGAR_WEBHOOK_APIKEY:-\}/);
  assert.match(compose, /ENV_API_WEBHOOKS_LOTE: \$\{API_WEBHOOKS_LOTE:-/);
  assert.match(ejemplo, /^ENTREGAR_WEBHOOK_URL=/m);
  assert.match(ejemplo, /^SECRET_ENTREGAR_WEBHOOK_APIKEY=/m);
  assert.match(ejemplo, /^API_WEBHOOKS_LOTE=/m);
});
