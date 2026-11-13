import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { argumentValue, requireEnvironment, redactError } from '../../scripts/operaciones.mjs';

const args = process.argv.slice(2);
const source = argumentValue(args, '--source');
const namespace = argumentValue(args, '--namespace');
const flowId = argumentValue(args, '--flow-id');
const webhookKeyEnv = argumentValue(args, '--webhook-key-env');
const borrar = args.includes('--borrar');
const retirar = args.includes('--retirar');
const manifiesto = argumentValue(args, '--manifiesto', 'infra/kestra/flows-retirados.txt');
const kestraUrl = argumentValue(args, '--kestra-url', 'http://127.0.0.1:9082').replace(/\/$/, '');
const username = argumentValue(args, '--username', process.env.KESTRA_BASIC_AUTH_USERNAME);
const password = argumentValue(args, '--password', process.env.KESTRA_BASIC_AUTH_PASSWORD);

if (!username?.trim() || !password?.trim()) throw new Error('Definí KESTRA_BASIC_AUTH_USERNAME y KESTRA_BASIC_AUTH_PASSWORD.');

const authorization = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;

// Borra un flow publicado. Un 404 cuenta como «ya no estaba»: el retiro es idempotente.
async function borrarFlow(flowNamespace, flow) {
  const url = `${kestraUrl}/api/v1/main/flows/${encodeURIComponent(flowNamespace)}/${encodeURIComponent(flow)}`;
  const response = await fetch(url, { method: 'DELETE', headers: { authorization }, signal: AbortSignal.timeout(60_000) });
  if (response.status === 404) {
    console.log(`${flowNamespace}/${flow} no estaba publicado.`);
    return;
  }
  if (!response.ok) throw new Error(`Kestra devolvió HTTP ${response.status}.`);
  console.log(`Borrado ${flowNamespace}/${flow}.`);
}

async function publicar() {
  const flow = await readFile(path.resolve(source), 'utf8');
  let rendered = flow;
  if (webhookKeyEnv) {
    const webhookKey = requireEnvironment(webhookKeyEnv);
    rendered = flow.replace(/^(\s*key:\s+")\{\{\s*secret\('[^']+'\)\s*\}\}("\s*)$/m, `$1${webhookKey}$2`);
    if (rendered === flow || !/^\s*key:\s+"[0-9a-fA-F]+"\s*$/m.test(rendered)) {
      throw new Error('No se encontró una clave webhook renderizable en el flow.');
    }
  }

  async function publish(url, method) {
    const response = await fetch(url, { method, headers: { authorization, 'content-type': 'application/x-yaml' }, body: rendered, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) {
      // La respuesta puede contener detalles operativos; no se imprime porque el
      // YAML transitorio contiene la clave webhook sólo en memoria.
      throw new Error(`Kestra devolvió HTTP ${response.status}.`);
    }
    return await response.json();
  }

  const flowUrl = `${kestraUrl}/api/v1/main/flows/${encodeURIComponent(namespace)}/${encodeURIComponent(flowId)}`;
  const existing = await fetch(flowUrl, { headers: { authorization }, signal: AbortSignal.timeout(60_000) });
  if (existing.status !== 200 && existing.status !== 404) throw new Error(`Kestra devolvió HTTP ${existing.status} al consultar el flow.`);
  const result = existing.status === 404
    ? await publish(`${kestraUrl}/api/v1/main/flows`, 'POST')
    : await publish(flowUrl, 'PUT');
  console.log(`Desplegado ${namespace}/${flowId}, revisión ${result.revision ?? 'actualizada'}.`);
}

// Flows retirados del repo: el manifiesto los lista como <namespace>/<id> para borrarlos de cada entorno.
async function retirarFlows() {
  const contenido = await readFile(path.resolve(manifiesto), 'utf8');
  const lineas = contenido.split('\n').map((linea) => linea.trim()).filter((linea) => linea && !linea.startsWith('#'));
  for (const linea of lineas) {
    const [flowNamespace, flow] = linea.split('/');
    if (!flowNamespace || !flow) throw new Error(`Línea inválida en el manifiesto de flows retirados: "${linea}".`);
    await borrarFlow(flowNamespace, flow);
  }
  if (lineas.length === 0) console.log('No hay flows retirados que borrar.');
}

try {
  if (retirar) await retirarFlows();
  else if (borrar) {
    if (!namespace || !flowId) throw new Error('Para borrar un flow pasá --namespace y --flow-id.');
    await borrarFlow(namespace, flowId);
  } else await publicar();
} catch (error) {
  throw new Error(redactError(error));
}
