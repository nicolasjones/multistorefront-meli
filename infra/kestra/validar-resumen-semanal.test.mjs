// Contrato estático del flow resumen-semanal (MSF-265, F-REP-08): resumen semanal por correo los lunes 08:00 (Buenos Aires)
// llamando a la Edge Function, con reintentos que no duplican, sin secretos en el YAML y sin tocar la base directamente.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FLOW = 'infra/kestra/flows/resumen-semanal.yml';
const sinComentarios = (content) => content
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');
const leer = async () => sinComentarios(await readFile(FLOW, 'utf8'));

test('resumen-semanal corre los lunes a las 08:00 en la zona horaria de Buenos Aires', async () => {
  const content = await leer();
  assert.match(content, /id: lunes_0800\n\s+type: io\.kestra\.plugin\.core\.trigger\.Schedule\n\s+cron: "0 8 \* \* 1"\n\s+timezone: America\/Argentina\/Buenos_Aires/);
});

test('resumen-semanal reintenta cada 15 minutos en la misma zona horaria (la base impide el duplicado)', async () => {
  const content = await leer();
  assert.match(content, /id: reintentos\n\s+type: io\.kestra\.plugin\.core\.trigger\.Schedule\n\s+cron: "\*\/15 \* \* \* \*"\n\s+timezone: America\/Argentina\/Buenos_Aires/);
  assert.equal((content.match(/trigger\.Schedule/g) ?? []).length, 2, 'solo los dos disparadores previstos');
});

test('resumen-semanal llama por POST a la Edge Function con {"barrer": true} y reintenta la llamada', async () => {
  const content = await leer();
  assert.match(content, /type: io\.kestra\.plugin\.core\.http\.Request/);
  assert.match(content, /uri: "\{\{ envs\.resumen_semanal_url \}\}"/);
  assert.match(content, /method: POST/);
  assert.match(content, /body: '\{"barrer": true\}'/);
  assert.match(content, /retry:\n\s+type: constant/);
});

test('resumen-semanal autentica con el token como secreto y no escribe ningún valor en el YAML', async () => {
  const content = await leer();
  assert.match(content, /x-aviso-token: "\{\{ secret\('RESUMEN_SEMANAL_TOKEN'\) \}\}"/);
  assert.doesNotMatch(content, /x-aviso-token: "(?!\{\{)/, 'el token no puede ir literal');
  assert.doesNotMatch(content, /eyJ[A-Za-z0-9_-]{10,}/, 'no debe haber un JWT literal');
});

test('resumen-semanal no habla con la base ni dispara HTTP desde SQL, y no manda correo por sí mismo', async () => {
  const content = await leer();
  assert.doesNotMatch(content, /jdbc\.postgresql/, 'el cálculo y el estado los maneja la función');
  assert.doesNotMatch(content, /pg_net/);
  assert.doesNotMatch(content, /MailSend/, 'el correo sale por la función (SMTP_* de sus secretos), con el estado en la base');
});

test('el compose de Kestra expone las tres variables del flow', async () => {
  const compose = await readFile('infra/kestra/compose.yaml', 'utf8');
  assert.match(compose, /ENV_RESUMEN_SEMANAL_URL:/);
  assert.match(compose, /ENV_RESUMEN_SEMANAL_APIKEY:/);
  assert.match(compose, /SECRET_RESUMEN_SEMANAL_TOKEN: \$\{SECRET_RESUMEN_SEMANAL_TOKEN:-\}/);
});

test('el token de ejemplo de Kestra está en base64 y coincide con el de la función', async () => {
  const ejemplo = await readFile('infra/kestra/.env.example', 'utf8');
  const valor = ejemplo.match(/^SECRET_RESUMEN_SEMANAL_TOKEN=(.+)$/m)?.[1];
  assert.ok(valor, 'falta SECRET_RESUMEN_SEMANAL_TOKEN en infra/kestra/.env.example');
  assert.match(valor, /^[A-Za-z0-9+/]+={0,2}$/);
  const funcion = await readFile('supabase/functions/.env.example', 'utf8');
  const plano = funcion.match(/^RESUMEN_SEMANAL_TOKEN=(.+)$/m)?.[1];
  assert.equal(Buffer.from(valor, 'base64').toString('utf8'), plano, 'decodificado debe igualar al de la función');
  assert.doesNotMatch(ejemplo, /^RESUMEN_SEMANAL_TOKEN=/m, 'el nombre sin SECRET_ no se usa en Kestra');
});

test('la función y el config.toml del runtime conocen el secreto', async () => {
  const config = await readFile('supabase/config.toml', 'utf8');
  assert.match(config, /RESUMEN_SEMANAL_TOKEN = "env\(RESUMEN_SEMANAL_TOKEN\)"/);
});
