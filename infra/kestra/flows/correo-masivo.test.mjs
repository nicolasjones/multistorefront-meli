// Contrato estático del flow correo-masivo (MSF-370, F-CLI-12): FR-012 (pie con enlace de baja único), FR-016/SC-003
// (lotes con cupo diario por variable; el reparto del cupo y la retoma del día siguiente los prueba pgTAP
// `correo_masivo_lote.test.sql`), FR-017 (reintentos con espera creciente y motivo fijo sin detalle del SMTP) y
// FR-021 (SMTP de Kestra `KESTRA_SMTP_*`, sin proveedor nuevo ni claves en el YAML).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FLOW = 'infra/kestra/flows/correo-masivo.yml';

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
  assert.match(content, /^id: correo-masivo$/m);
  assert.match(content, /^namespace: producto\.clientes$/m);
  assert.match(content, /type: io\.kestra\.plugin\.core\.trigger\.Schedule/);
  assert.match(content, /cron: "\* \* \* \* \*"/);
});

test('reclama un lote con el cupo diario de las variables CORREO_MASIVO_LOTE y CORREO_MASIVO_LIMITE_DIARIO (SC-003)', async () => {
  const reclamo = tarea(await leer(), 'reclamar');
  assert.match(reclamo, /private\.reclamar_lote_correo_masivo\(CAST\(:lote AS integer\), CAST\(:limite AS integer\), \d+\)/);
  assert.match(reclamo, /lote: "\{\{ envs\.correo_masivo_lote \?\? 50 \}\}"/);
  assert.match(reclamo, /limite: "\{\{ envs\.correo_masivo_limite_diario \?\? 500 \}\}"/);
  assert.match(reclamo, /username: kestra_orquestacion/, 'usa el rol de servicio de Kestra');
  assert.doesNotMatch(reclamo, /reclamar_despachos_/, 'no mezcla la outbox genérica de otros productos');
});

test('las variables del flow se declaran en el Compose y en .env.example', async () => {
  const [compose, ejemplo] = await Promise.all([readFile('infra/kestra/compose.yaml', 'utf8'), readFile('infra/kestra/.env.example', 'utf8')]);
  for (const variable of ['CORREO_MASIVO_LOTE', 'CORREO_MASIVO_LIMITE_DIARIO', 'CORREO_MASIVO_URL_BAJA']) {
    assert.match(compose, new RegExp(`ENV_${variable}: \\$\\{${variable}:-`), `${variable} llega a Kestra como ENV_`);
    assert.match(ejemplo, new RegExp(`^${variable}=`, 'm'), `${variable} está en .env.example`);
  }
});

test('el correo sale por el SMTP KESTRA_SMTP_* de MSF-189, sin proveedor nuevo (FR-021)', async () => {
  const content = await leer();
  const correo = tarea(content, 'enviar_correo');
  assert.match(correo, /type: io\.kestra\.plugin\.notifications\.mail\.MailSend/);
  for (const campo of ['host', 'port', 'username', 'password', 'transportStrategy', 'from']) {
    assert.match(correo, new RegExp(campo === 'from' ? 'from: "\\{\\{.*envs\\.kestra_smtp_from' : `${campo}: "\\{\\{ envs\\.kestra_smtp_`), `${campo} sale de KESTRA_SMTP_*`);
  }
  assert.match(correo, /to: "\{\{ fromJson\(parent\.taskrun\.value\)\.correo \}\}"/);
  assert.doesNotMatch(content, /sendgrid|mailgun|postmark|ses\.amazonaws|api\.resend/i, 'ningún proveedor de correo nuevo');
  assert.doesNotMatch(content, /eyJ[A-Za-z0-9_-]{10,}/, 'ningún JWT literal en el flow');
});

test('el cuerpo trae un pie con un enlace de baja propio de cada destinatario y el mensaje va escapado (FR-012)', async () => {
  const correo = tarea(await leer(), 'enviar_correo');
  assert.match(correo, /mensaje \| escape/, 'el mensaje se escapa: sin HTML libre');
  assert.match(
    correo,
    /href="\{\{ envs\.correo_masivo_url_baja \}\}\/baja-correo\/\{\{ fromJson\(parent\.taskrun\.value\)\.token \?\? 'ejemplo' \}\}"/,
    'el enlace usa el token de cada destinatario (en la prueba, uno de ejemplo)',
  );
  assert.match(correo, /date de baja/, 'el pie ofrece la baja');
  assert.match(correo, /<hr>/, 'el pie va separado del mensaje');
  assert.doesNotMatch(correo.replace(/\{\{ fromJson\(parent\.taskrun\.value\)\.cuerpo_html \| raw \}\}/, ''), /\| raw/, 'solo el cuerpo del newsletter, ya escapado por la base, se muestra con raw: nada del mensaje de clientes');
});

// MSF-468 (RF-NL-20, RF-NL-21, D15): el newsletter usa el cuerpo armado por la base y el remitente de la tienda; el correo de clientes no cambia.
test('el newsletter usa el cuerpo y el remitente de la tienda que arma la base, y el de clientes conserva su plantilla', async () => {
  const correo = tarea(await leer(), 'enviar_correo');
  assert.match(correo, /\{% if fromJson\(parent\.taskrun\.value\)\.tipo == 'newsletter' %\}\{\{ fromJson\(parent\.taskrun\.value\)\.cuerpo_html \| raw \}\}\{% else %\}/, 'cuerpo del newsletter');
  assert.match(correo, /\{% endif %\}/);
  assert.match(correo, /from: "\{\{ \(fromJson\(parent\.taskrun\.value\)\.tipo == 'newsletter' and fromJson\(parent\.taskrun\.value\)\.remitente != null\) \? fromJson\(parent\.taskrun\.value\)\.remitente ~ ' <' ~ envs\.kestra_smtp_from ~ '>' : envs\.kestra_smtp_from \}\}"/, 'remitente con el nombre de la tienda sobre la dirección técnica');
  assert.match(correo, /mensaje \| escape/, 'la plantilla de clientes sigue escapando el mensaje');
  assert.match(correo, /\/baja-correo\/\{\{ fromJson\(parent\.taskrun\.value\)\.token \?\? 'ejemplo' \}\}/, 'y su enlace de baja de siempre');
  assert.doesNotMatch(correo, /\| raw[^}]*mensaje|mensaje[^}]*\| raw/, 'el mensaje del dueño nunca se muestra con raw');
});

test('un fallo del SMTP se reintenta con espera creciente (FR-017)', async () => {
  const correo = tarea(await leer(), 'enviar_correo');
  assert.match(correo, /retry:\s+type: exponential\s+interval: PT\d+S\s+maxInterval: PT\d+M\s+maxAttempts: [2-9]/);
});

test('agotados los reintentos el destinatario queda fallido con un motivo fijo, nunca el detalle del SMTP (FR-017)', async () => {
  const content = await leer();
  const fallido = tarea(content, 'cerrar_fallido');
  assert.match(fallido, /cerrar_envio_correo_masivo\(CAST\(:destinatario AS uuid\), 'fallido', 'No se pudo enviar el correo'\)/);
  assert.doesNotMatch(fallido, /\{\{ *(error|taskrun\.outputs|outputs\.enviar_correo)/, 'el motivo no sale del error del SMTP');
  const enviado = tarea(content, 'cerrar_enviado');
  assert.match(enviado, /cerrar_envio_correo_masivo\(CAST\(:destinatario AS uuid\), 'enviado', NULL\)/);
  assert.match(enviado, /retry:\s+type: constant/, 'el cierre como enviado se reintenta');
  // cerrar_fallido solo cuelga del envío: si falla cerrar_enviado, un correo ya entregado no queda fallido.
  const envio = content.slice(content.indexOf('id: intentar_envio'), content.indexOf('id: cerrar_enviado'));
  assert.match(envio, /id: enviar_correo/);
  assert.match(envio, /id: cerrar_fallido/);
  assert.doesNotMatch(content.slice(content.indexOf('id: cerrar_enviado')), /id: cerrar_fallido/);
});

// El enlace de baja no puede salir roto: el flow se niega a enviar con una URL vacía, http o localhost (salvo desarrollo local).
test('el flow valida la URL de baja antes de reclamar el lote y el VPS la exige definida', async () => {
  const [contenido, compose, vps, ejemplo] = await Promise.all([
    leer(),
    readFile('infra/kestra/compose.yaml', 'utf8'),
    readFile('infra/kestra/compose.vps.yaml', 'utf8'),
    readFile('infra/kestra/.env.example', 'utf8'),
  ]);
  const posValidar = contenido.indexOf('- id: validar_url_baja');
  assert.ok(posValidar > 0, 'hay una validación de la URL de baja');
  assert.ok(posValidar < contenido.indexOf('- id: reclamar'), 'se valida ANTES de reclamar el lote');
  const validar = tarea(contenido, 'validar_url_baja');
  assert.match(validar, /type: io\.kestra\.plugin\.core\.execution\.Assert/);
  assert.match(validar, /https:\/\//, 'exige https');
  assert.match(validar, /localhost/, 'rechaza localhost');
  assert.match(validar, /correo_masivo_permitir_local/, 'solo el desarrollo local lo puede relajar');
  assert.match(compose, /ENV_CORREO_MASIVO_PERMITIR_LOCAL: \$\{CORREO_MASIVO_PERMITIR_LOCAL:-false\}/, 'por defecto NO se permite local');
  assert.match(ejemplo, /^CORREO_MASIVO_PERMITIR_LOCAL=true$/m, 'el ejemplo local sí lo permite');
  assert.match(vps, /ENV_CORREO_MASIVO_URL_BAJA: \$\{CORREO_MASIVO_URL_BAJA:\?/, 'el overlay del VPS falla si la variable no está definida');
});

test('la comprobación de https del Assert es por prefijo (startsWith), no por subcadena', async () => {
  const validar = tarea(await leer(), 'validar_url_baja');
  assert.match(validar, /startsWith\('https:\/\/'\)/, 'https se exige al inicio de la URL');
  assert.doesNotMatch(validar, /replace\(\{'https:\/\/'/, 'ya no se acepta «https://» en cualquier parte de la URL');
  assert.doesNotMatch(validar, /\bcontains\b/, 'ninguna comprobación por contains');
});
