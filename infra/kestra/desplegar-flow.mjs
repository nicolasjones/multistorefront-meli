import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { argumentValue, requireEnvironment, redactError } from '../../scripts/operaciones.mjs';

const args = process.argv.slice(2);
const source = argumentValue(args, '--source');
const namespace = argumentValue(args, '--namespace');
const flowId = argumentValue(args, '--flow-id');
const webhookKeyEnv = argumentValue(args, '--webhook-key-env');
const kestraUrl = argumentValue(args, '--kestra-url', 'http://127.0.0.1:9082').replace(/\/$/, '');
const username = argumentValue(args, '--username', process.env.KESTRA_BASIC_AUTH_USERNAME);
const password = argumentValue(args, '--password', process.env.KESTRA_BASIC_AUTH_PASSWORD);

if (!username?.trim() || !password?.trim()) throw new Error('Definí KESTRA_BASIC_AUTH_USERNAME y KESTRA_BASIC_AUTH_PASSWORD.');
const flow = await readFile(path.resolve(source), 'utf8');
let rendered = flow;
if (webhookKeyEnv) {
  const webhookKey = requireEnvironment(webhookKeyEnv);
  rendered = flow.replace(/^(\s*key:\s+")\{\{\s*secret\('[^']+'\)\s*\}\}("\s*)$/m, `$1${webhookKey}$2`);
  if (rendered === flow || !/^\s*key:\s+"[0-9a-fA-F]+"\s*$/m.test(rendered)) {
    throw new Error('No se encontró una clave webhook renderizable en el flow.');
  }
}

const authorization = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
async function publish(url, method) {
  const response = await fetch(url, { method, headers: { authorization, 'content-type': 'application/x-yaml' }, body: rendered, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    // La respuesta puede contener detalles operativos; no se imprime porque el
    // YAML transitorio contiene la clave webhook sólo en memoria.
    throw new Error(`Kestra devolvió HTTP ${response.status}.`);
  }
  return await response.json();
}

try {
  const flowUrl = `${kestraUrl}/api/v1/main/flows/${encodeURIComponent(namespace)}/${encodeURIComponent(flowId)}`;
  const existing = await fetch(flowUrl, { headers: { authorization }, signal: AbortSignal.timeout(60_000) });
  if (existing.status !== 200 && existing.status !== 404) throw new Error(`Kestra devolvió HTTP ${existing.status} al consultar el flow.`);
  const result = existing.status === 404
    ? await publish(`${kestraUrl}/api/v1/main/flows`, 'POST')
    : await publish(flowUrl, 'PUT');
  console.log(`Desplegado ${namespace}/${flowId}, revisión ${result.revision ?? 'actualizada'}.`);
} catch (error) {
  throw new Error(redactError(error));
}
