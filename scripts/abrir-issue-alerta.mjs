// MSF-680: abre (o actualiza) un issue de GitHub cuando falla un workflow que nadie mira: el gate de migraciones a staging y release-please
// fallaban desde el 21/10 sin que nadie se enterara. Un solo issue abierto por título: si ya existe se agrega un comentario (no se llena el
// repo de duplicados). Usa el GITHUB_TOKEN del job (permiso `issues: write`); no necesita ningún secret nuevo.
//
//   node scripts/abrir-issue-alerta.mjs --titulo "Falla: migraciones a staging" --detalle "job staging"
//
// El cuerpo solo lleva la URL del run y el texto de --detalle (el llamador no debe pasarle secretos). Sale 0 aunque la API falle
// (la alerta no puede romper un job que ya estaba fallando); el motivo va a stderr.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ETIQUETA = 'alerta-ci';

export function cuerpoDelAviso({ detalle, urlRun, ahora = new Date() }) {
  return [`Falló un workflow que nadie estaba mirando (${ahora.toISOString()}).`, '', `- Run: ${urlRun}`, ...(detalle ? [`- Detalle: ${detalle}`] : []), '', 'Cuando se arregle, cerrá este issue; si vuelve a fallar se abrirá otro.'].join('\n');
}

export async function avisar({ env, titulo, detalle, fetchFn = fetch, ahora = new Date() }) {
  const token = env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPOSITORY;
  if (!token || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Faltan GITHUB_TOKEN o GITHUB_REPOSITORY.');
  if (!titulo || titulo.length > 200) throw new Error('--titulo es obligatorio (hasta 200 caracteres).');
  const api = env.GITHUB_API_URL || 'https://api.github.com';
  const cabeceras = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' };
  const urlRun = env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL || 'https://github.com'}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : '(sin run)';
  const cuerpo = cuerpoDelAviso({ detalle, urlRun, ahora });
  const llamar = async (ruta, opciones) => {
    const respuesta = await fetchFn(`${api}/repos/${repo}${ruta}`, { ...opciones, headers: cabeceras });
    if (!respuesta.ok) throw new Error(`GitHub respondió HTTP ${respuesta.status} en ${opciones?.method ?? 'GET'} ${ruta.split('?')[0]}.`);
    return respuesta.json();
  };
  const abiertos = await llamar(`/issues?state=open&labels=${ETIQUETA}&per_page=100`, { method: 'GET' });
  const existente = abiertos.find((i) => i.title === titulo && !i.pull_request);
  if (existente) {
    await llamar(`/issues/${existente.number}/comments`, { method: 'POST', body: JSON.stringify({ body: cuerpo }) });
    return { accion: 'comentado', numero: existente.number };
  }
  const creado = await llamar('/issues', { method: 'POST', body: JSON.stringify({ title: titulo, body: cuerpo, labels: [ETIQUETA] }) });
  return { accion: 'creado', numero: creado.number };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const opcion = (nombre) => { const i = process.argv.indexOf(nombre); return i === -1 ? undefined : process.argv[i + 1]; };
  try {
    const r = await avisar({ env: process.env, titulo: opcion('--titulo'), detalle: opcion('--detalle') });
    console.log(`Alerta ${r.accion}: issue #${r.numero}.`);
  } catch (error) {
    console.error(`No se pudo abrir la alerta: ${error instanceof Error ? error.message : 'error desconocido'}`);
  }
}
