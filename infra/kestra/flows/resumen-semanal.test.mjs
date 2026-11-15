// Contrato estático del flow resumen-semanal (MSF-287, F-REP-08): FR-010 (un correo por
// destinatario y semana), FR-011 (SMTP de Kestra `KESTRA_SMTP_*`, sin proveedor nuevo),
// FR-013 (reintento sin duplicado y fallo con motivo fijo), FR-014 (HTML escapado).
// No reemplaza una corrida en un Kestra real: la idempotencia por destinatario y semana la
// prueba el pgTAP `resumen_semanal.test.sql`.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FLOW = 'infra/kestra/flows/resumen-semanal.yml';

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

test('tiene id, namespace del producto y corre una vez por semana', async () => {
  const content = await leer();
  assert.match(content, /^id: resumen-semanal$/m);
  assert.match(content, /^namespace: producto\.reportes$/m);
  assert.match(content, /type: io\.kestra\.plugin\.core\.trigger\.Schedule/);
  assert.match(content, /cron: "0 9 \* \* 1"/);
});

test('reclama los destinatarios de la semana con el rol de servicio y sin tocar la tabla', async () => {
  const reclamo = tarea(await leer(), 'reclamar');
  assert.match(reclamo, /private\.reclamar_resumen_semanal\(CAST\(:limite AS integer\)\)/);
  assert.match(reclamo, /username: kestra_orquestacion/, 'usa el rol de servicio de Kestra');
  assert.match(reclamo, /resumen::text as resumen/, 'el resumen viaja como texto');
  assert.doesNotMatch(reclamo, /(from|into|update)\s+dominio\.resumen_semanal_envios/i, 'no toca la tabla directamente');
});

test('envía un correo por destinatario por SMTP genérico (KESTRA_SMTP_*)', async () => {
  const content = await leer();
  assert.match(content, /values: "\{\{ outputs\.reclamar\.rows \}\}"/, 'itera los destinatarios reclamados');
  assert.equal((content.match(/type: io\.kestra\.plugin\.notifications\.mail\.MailSend/g) ?? []).length, 1, 'un MailSend por destinatario');
  for (const campo of ['host', 'port', 'username', 'password', 'transporte', 'from']) {
    assert.match(content, new RegExp(`envs\\.kestra_smtp_${campo}`), `usa KESTRA_SMTP_${campo.toUpperCase()}`);
  }
  assert.match(content, /to: "\{\{ fromJson\(parent\.taskrun\.value\)\.destinatario \}\}"/);
  assert.doesNotMatch(content, /sendgrid|mailgun|postmark|ses\.amazonaws|api\.resend/i, 'ningún proveedor de correo nuevo');
});

test('el cuerpo muestra las secciones del resumen con los valores escapados (FR-014)', async () => {
  const correo = tarea(await leer(), 'enviar_correo');
  assert.match(correo, /for seccion in resumen\.secciones/, 'recorre las secciones del resumen');
  assert.match(correo, /for dato in seccion\.datos/, 'recorre los datos de cada sección');
  assert.match(correo, /titulo \| escape/, 'el título se escapa');
  assert.match(correo, /clave \| escape/, 'la clave se escapa');
  assert.match(correo, /valor \| escape/, 'el valor se escapa');
  assert.doesNotMatch(correo, /\| raw/, 'nada del resumen se muestra sin escapar');
});

test('un fallo del SMTP se reintenta con espera creciente (FR-011)', async () => {
  const correo = tarea(await leer(), 'enviar_correo');
  assert.match(correo, /retry:\s+type: exponential\s+interval: PT\d+S\s+maxInterval: PT\d+M\s+maxAttempts: [2-9]/);
});

test('agotados los reintentos el envío queda fallido con un motivo fijo, nunca el error del SMTP (FR-013)', async () => {
  const content = await leer();
  const fallido = tarea(content, 'cerrar_fallido');
  assert.match(fallido, /private\.registrar_fallo_resumen_semanal\(CAST\(:envio_id AS uuid\), 'No se pudo enviar el correo'\)/);
  assert.doesNotMatch(fallido, /errorLogs\(\)/, 'el motivo no sale del error del SMTP');
  const enviado = tarea(content, 'cerrar_enviado');
  assert.match(enviado, /private\.marcar_resumen_semanal_enviado\(CAST\(:envio_id AS uuid\)\)/);
  assert.match(enviado, /retry:\s+type: constant/, 'el cierre como enviado se reintenta');
  // cerrar_fallido solo cuelga del envío: si falla el cierre de un enviado, no lo vuelve fallido.
  const envio = content.slice(content.indexOf('id: enviar_correo'), content.indexOf('id: cerrar_enviado'));
  assert.match(envio, /id: enviar_correo/);
  assert.match(envio, /id: cerrar_fallido/);
  assert.doesNotMatch(content.slice(content.indexOf('id: cerrar_enviado')), /id: cerrar_fallido/);
});

test('la corrida repetida no duplica: el envío se cierra con la marca idempotente y el reclamo es por semana', async () => {
  const content = await leer();
  // El reclamo vive en la base (una fila por destinatario y semana): el flow no lleva su propia
  // lista de destinatarios ni decide a quién correoear.
  assert.match(content, /private\.reclamar_resumen_semanal\(/, 'el reclamo idempotente manda la lista');
  assert.doesNotMatch(content, /to: "\{\{ envs\./, 'el destinatario no viene de una variable');
  assert.match(content, /private\.marcar_resumen_semanal_enviado\(/, 'el cierre es la marca idempotente');
});

test('las variables del flow se declaran en el Compose y en .env.example', async () => {
  const [compose, ejemplo] = await Promise.all([
    readFile('infra/kestra/compose.yaml', 'utf8'),
    readFile('infra/kestra/.env.example', 'utf8'),
  ]);
  for (const variable of ['RESUMEN_SEMANAL_LIMITE']) {
    assert.match(compose, new RegExp(`ENV_${variable}: \\$\\{${variable}:-`), `${variable} llega a Kestra como ENV_`);
    assert.match(ejemplo, new RegExp(`^${variable}=`, 'm'), `${variable} está en .env.example`);
  }
});

test('el flow no trae credenciales ni destinatarios en claro', async () => {
  const content = await leer();
  assert.doesNotMatch(content, /password: "(?!\{\{)/, 'las contraseñas salen de variables de entorno');
  assert.doesNotMatch(content, /@[a-z0-9-]+\.(com|net|org)/i, 'sin direcciones de correo fijas');
});
