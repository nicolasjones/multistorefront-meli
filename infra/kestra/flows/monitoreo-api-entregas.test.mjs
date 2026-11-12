// Contrato estático de los flows de aviso de la API (MSF-837, F-API-01): el chequeo de salud de las entregas cada 15 minutos,
// el subflow que manda el correo y el aviso del fallo de la purga. Ningún secreto en el YAML y la lógica de qué cuenta vive en
// la base. Corre con `node --test`.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sinComentarios = (content) => content
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');

const leer = async (nombre) => sinComentarios(await readFile(`infra/kestra/flows/${nombre}.yml`, 'utf8'));

test('monitoreo-api-entregas corre cada 15 minutos en el namespace de la API', async () => {
  const flow = await leer('monitoreo-api-entregas');
  assert.match(flow, /^id: monitoreo-api-entregas$/m);
  assert.match(flow, /^namespace: platform\.api$/m);
  assert.match(flow, /type: io\.kestra\.plugin\.core\.trigger\.Schedule/);
  assert.match(flow, /cron: "\*\/15 \* \* \* \*"/);
});

test('consulta la salud a la base con el rol de servicio y no cuenta nada por su cuenta', async () => {
  const flow = await leer('monitoreo-api-entregas');
  assert.match(flow, /private\.api_entregas_salud\(CAST\(:ventana AS integer\), CAST\(:atraso AS integer\)\)/);
  assert.match(flow, /username: kestra_orquestacion/);
  assert.match(flow, /password: "\{\{ envs\.kestra_orquestacion_db_password \}\}"/, 'la clave viene del entorno, no del YAML');
  assert.doesNotMatch(flow, /select\s+count\(/i, 'la base cuenta; el flow solo consulta');
});

test('los umbrales son inputs con valores por defecto', async () => {
  const flow = await leer('monitoreo-api-entregas');
  for (const id of ['ventana_min', 'atraso_min', 'umbral_agotadas']) {
    assert.match(flow, new RegExp(`- id: ${id}\\n\\s+type: INT\\n\\s+defaults: \\d+`), `${id} es un input INT con default`);
  }
});

test('avisa solo si hay agotadas sobre el umbral o algo atrasado, y también si el chequeo falla', async () => {
  const flow = await leer('monitoreo-api-entregas');
  assert.match(flow, /condition: "\{\{ \(outputs\.salud\.row\.agotadas \| number\) >= inputs\.umbral_agotadas or \(outputs\.salud\.row\.entregas_atrasadas \| number\) > 0 or \(outputs\.salud\.row\.eventos_atrasados \| number\) > 0 \}\}"/);
  assert.equal((flow.match(/flowId: aviso-fallo-api/g) ?? []).length, 2, 'avisa por el problema y por el fallo del propio chequeo');
  assert.match(flow, /^errors:$/m, 'el fallo del chequeo no pasa en silencio');
  assert.match(flow, /transmitFailed: false/, 'si el correo falla no tumba el chequeo');
});

test('aviso-fallo-api manda el correo por SMTP del entorno a soporte, sin secretos en el YAML', async () => {
  const flow = await leer('aviso-fallo-api');
  assert.match(flow, /^id: aviso-fallo-api$/m);
  assert.match(flow, /^namespace: platform\.api$/m);
  assert.match(flow, /type: io\.kestra\.plugin\.notifications\.mail\.MailSend/);
  for (const variable of ['kestra_smtp_host', 'kestra_smtp_port', 'kestra_smtp_username', 'kestra_smtp_password', 'kestra_smtp_from', 'soporte_correo']) {
    assert.match(flow, new RegExp(`\\{\\{ envs\\.${variable} \\}\\}`), `usa ${variable} del entorno`);
  }
  assert.match(flow, /\{\{ inputs\.motivo \| escape \}\}/, 'el motivo se escapa en el cuerpo HTML');
});

test('la purga avisa si falla y su texto menciona la retención de eventos y entregas', async () => {
  const flow = await leer('purgar-api-llamadas');
  assert.match(flow, /^errors:$/m);
  assert.match(flow, /flowId: aviso-fallo-api/);
  assert.match(flow, /flujo: purgar-api-llamadas/);
  assert.match(await readFile('infra/kestra/flows/purgar-api-llamadas.yml', 'utf8'), /cola_eventos/);
});
