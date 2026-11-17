// Contrato estático del flow newsletter-confirmaciones (MSF-468, Fase 2, RF-NL-4): reclamo por lote con variable, correo por el SMTP de
// Kestra (`KESTRA_SMTP_*`, sin proveedor nuevo ni secretos en el YAML), enlace al dominio de la tienda con el token, reintentos con espera
// creciente y motivo fijo. El vencimiento a 48 h, el hash y la poda los prueban los pgTAP `newsletter_suscripcion.test.sql`.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FLOW = 'infra/kestra/flows/newsletter-confirmaciones.yml';

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

test('tiene id, namespace del producto y corre cada minuto', async () => {
  const content = await leer();
  assert.match(content, /^id: newsletter-confirmaciones$/m);
  assert.match(content, /^namespace: producto\.clientes$/m);
  assert.match(content, /type: io\.kestra\.plugin\.core\.trigger\.Schedule/);
  assert.match(content, /cron: "\* \* \* \* \*"/);
});

test('reclama un lote con NEWSLETTER_CONFIRMACION_LOTE y el rol de servicio de Kestra', async () => {
  const reclamo = tarea(await leer(), 'reclamar');
  assert.match(reclamo, /private\.reclamar_confirmaciones_newsletter\(CAST\(:lote AS integer\), \d+\)/);
  assert.match(reclamo, /lote: "\{\{ envs\.newsletter_confirmacion_lote \?\? 20 \}\}"/);
  assert.match(reclamo, /username: kestra_orquestacion/);
  assert.doesNotMatch(reclamo, /reclamar_lote_correo_masivo|reclamar_despachos_/, 'no toca el motor del correo masivo');
});

test('la variable se declara en el Compose y en .env.example', async () => {
  const [compose, ejemplo] = await Promise.all([readFile('infra/kestra/compose.yaml', 'utf8'), readFile('infra/kestra/.env.example', 'utf8')]);
  assert.match(compose, /ENV_NEWSLETTER_CONFIRMACION_LOTE: \$\{NEWSLETTER_CONFIRMACION_LOTE:-/);
  assert.match(ejemplo, /^NEWSLETTER_CONFIRMACION_LOTE=/m);
});

test('el correo sale por el SMTP KESTRA_SMTP_* con el nombre de la tienda y el enlace de su dominio con el token', async () => {
  const content = await leer();
  const correo = tarea(content, 'enviar_correo');
  assert.match(correo, /type: io\.kestra\.plugin\.notifications\.mail\.MailSend/);
  for (const campo of ['host', 'port', 'username', 'password', 'transportStrategy']) {
    assert.match(correo, new RegExp(`${campo}: "\\{\\{ envs\\.kestra_smtp_`), `${campo} sale de KESTRA_SMTP_*`);
  }
  assert.match(correo, /from: "\\"\{\{ fromJson\(parent\.taskrun\.value\)\.tienda \}\}\\" <\{\{ envs\.kestra_smtp_from \}\}>"/, 'remitente con el nombre de la tienda');
  assert.match(correo, /to: "\{\{ fromJson\(parent\.taskrun\.value\)\.correo \}\}"/);
  assert.match(
    correo,
    /href="https:\/\/\{\{ fromJson\(parent\.taskrun\.value\)\.dominio \}\}\/newsletter\/confirmar\/\{\{ fromJson\(parent\.taskrun\.value\)\.token \}\}"/,
    'el enlace apunta al dominio de la tienda con su token',
  );
  assert.match(correo, /tienda \| escape/, 'el nombre de la tienda se escapa en el HTML');
  const asunto = /subject: "([^"]*)"/.exec(correo)[1];
  assert.doesNotMatch(asunto, /escape|raw/, 'el asunto es texto plano: sin entidades HTML (una tienda con & no muestra &amp;)');
  assert.doesNotMatch(asunto, /\\r|\\n|<br/, 'el asunto no admite saltos de línea');
  assert.match(asunto, /\.tienda \}\}$/, 'el asunto usa el nombre ya saneado por la base');
  assert.match(correo, /48 horas/, 'el correo avisa el vencimiento');
  assert.doesNotMatch(content, /sendgrid|mailgun|postmark|ses\.amazonaws|api\.resend/i, 'ningún proveedor de correo nuevo');
  assert.doesNotMatch(content, /eyJ[A-Za-z0-9_-]{10,}/, 'ningún JWT literal en el flow');
  assert.doesNotMatch(correo, /\| raw/, 'nada se muestra sin escapar');
});

test('un fallo del SMTP se reintenta con espera creciente y, agotado, queda un motivo fijo (nunca el detalle del SMTP)', async () => {
  const content = await leer();
  const correo = tarea(content, 'enviar_correo');
  assert.match(correo, /retry:\s+type: exponential\s+interval: PT\d+S\s+maxInterval: PT\d+M\s+maxAttempts: [2-9]/);
  const fallido = tarea(content, 'cerrar_fallido');
  assert.match(fallido, /cerrar_confirmacion_newsletter\(CAST\(:suscriptor AS uuid\), 'fallido', 'No se pudo enviar el correo'\)/);
  assert.doesNotMatch(fallido, /\{\{ *(error|taskrun\.outputs|outputs\.enviar_correo)/, 'el motivo no sale del error del SMTP');
  const enviado = tarea(content, 'cerrar_enviado');
  assert.match(enviado, /cerrar_confirmacion_newsletter\(CAST\(:suscriptor AS uuid\), 'enviado', NULL\)/);
  assert.match(enviado, /retry:\s+type: constant/);
  assert.doesNotMatch(content.slice(content.indexOf('id: cerrar_enviado')), /id: cerrar_fallido/, 'cerrar_fallido solo cuelga del envío');
});

test('no envía a nadie por su cuenta: todo destinatario sale del reclamo de la base (que respeta bandera e interruptor)', async () => {
  const content = await leer();
  assert.doesNotMatch(content, /newsletter_suscriptores/, 'el flow no lee la tabla: solo las funciones del reclamo y el cierre');
  assert.match(content, /values: "\{\{ outputs\.reclamar\.rows \}\}"/);
});
