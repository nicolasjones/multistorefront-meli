// Contrato estático del flow enviar-avisos (épica MSF-189, F-NOT-01, FR-008, SC-003, SC-004):
// reclamo → un correo por grupo → marcar enviado o registrar fallo, SMTP genérico, valores
// escapados y sin credenciales en Git. No reemplaza una corrida en un Kestra real.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const leer = async (file) => (await readFile(file, 'utf8')).replace(/\r\n/g, '\n');
const flow = () => leer('infra/kestra/flows/enviar-avisos.yml');

test('enviar-avisos vive en platform.avisos y corre cada minuto', async () => {
  const content = await flow();
  assert.match(content, /^id: enviar-avisos$/m);
  assert.match(content, /^namespace: platform\.avisos$/m);
  assert.match(content, /type: io\.kestra\.plugin\.core\.trigger\.Schedule\n\s+cron: "\* \* \* \* \*"/);
});

test('reclama los grupos listos con el rol de servicio y sin otro acceso a las tablas', async () => {
  const content = await flow();
  assert.match(content, /private\.reclamar_avisos_listos\(50\)/);
  assert.match(content, /username: kestra_orquestacion/);
  assert.doesNotMatch(content, /(from|into|update)\s+public\.avisos_pendientes/i, 'no toca la cola directamente');
});

test('envía un correo por grupo por SMTP genérico (KESTRA_SMTP_*)', async () => {
  const content = await flow();
  assert.match(content, /values: "\{\{ outputs\.reclamar\.rows \}\}"/, 'itera los grupos reclamados');
  assert.equal((content.match(/type: io\.kestra\.plugin\.notifications\.mail\.MailSend/g) ?? []).length, 1, 'un MailSend por grupo');
  for (const v of ['host', 'port', 'username', 'password', 'transporte', 'from']) {
    assert.match(content, new RegExp(`envs\\.kestra_smtp_${v}`), `usa KESTRA_SMTP_${v.toUpperCase()}`);
  }
  assert.match(content, /to: "\{\{ fromJson\(parent\.taskrun\.value\)\.destinatario \}\}"/);
});

test('el cuerpo resume cantidad y detalle de cada aviso, con los valores escapados', async () => {
  const content = await flow();
  assert.match(content, /\.cantidad/);
  assert.match(content, /\{% for aviso in fromJson\(fromJson\(parent\.taskrun\.value\)\.detalle\) %\}/);
  assert.match(content, /clave \| escape/);
  assert.match(content, /valor \| escape/);
  assert.match(content, /nombre \| escape/);
});

test('registra el resultado: enviado (idempotente) o fallo con el error real', async () => {
  const content = await flow();
  const ok = content.indexOf('- id: marcar_enviado');
  const mail = content.indexOf('- id: enviar_correo');
  assert.ok(mail !== -1 && ok > mail, 'se marca enviado solo después de enviar el correo');
  assert.match(content, /private\.marcar_aviso_enviado\(CAST\(:grupo_id AS uuid\)\)/);
  const errors = content.slice(content.indexOf('errors:'));
  assert.match(errors, /private\.registrar_fallo_aviso\(CAST\(:grupo_id AS uuid\), :motivo\)/);
  assert.match(errors, /errorLogs\(\)\[0\]\['message'\]/, 'el motivo es el error real');
});

test('toda variable envs.* del flow está en el compose y en los .env.example', async () => {
  const content = await flow();
  const compose = await leer('infra/kestra/compose.yaml');
  const ejemplos = [await leer('.env.example'), await leer('infra/kestra/.env.example')];
  const usadas = new Set([...content.matchAll(/envs\.([a-z0-9_]+)/g)].map((m) => m[1]));
  assert.ok(usadas.size > 0);
  for (const nombre of usadas) {
    const env = nombre.toUpperCase();
    assert.match(compose, new RegExp(`ENV_${env}:`), `${env} no está en infra/kestra/compose.yaml`);
    assert.match(ejemplos[0], new RegExp(`^${env}=`, 'm'), `${env} no está en .env.example`);
  }
});

test('el flow no trae credenciales ni destinatarios en claro', async () => {
  const content = await flow();
  assert.doesNotMatch(content, /password: "(?!\{\{)/, 'las contraseñas salen de variables de entorno');
  assert.doesNotMatch(content, /@[a-z0-9-]+\.(com|net|org)/i, 'sin direcciones de correo fijas');
});
