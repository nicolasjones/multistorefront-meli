// Publica los videos E2E en el propio runner (spec 022, ver-para-aprobar).
//
// Corre en el runner self-hosted tras la corrida visible: copia videos +
// manifiesto a `$HOME/e2e-videos/<run-id>/`, genera un `index.html` por run
// (historias con reproductor) y un índice general, sirve todo por HTTP solo
// en la tailnet (puerto 9324) y conserva los últimos 5 runs.
//
// Uso:
//   node scripts/publicar-videos-e2e.mjs --manifiesto <cobertura.json> --videos <test-results> --run-id <id>
import { execSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { argumentValue } from './operaciones.mjs';

const PUERTO = 9324;
const CONSERVAR_RUNS = 5;

function ipTailnet() {
  const candidatas = [];
  try {
    const ip = execSync('tailscale ip -4', { encoding: 'utf8' }).trim().split('\n')[0];
    if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) candidatas.push(['tailscale', ip]);
  } catch { /* sin tailscale en el PATH */ }
  try {
    for (const ip of execSync('hostname -I', { encoding: 'utf8' }).trim().split(/\s+/)) {
      if (/^\d+\.\d+\.\d+\.\d+$/.test(ip) && !ip.startsWith('127.')) candidatas.push(['hostname', ip]);
    }
  } catch { /* sin red detectable */ }
  console.log(`IPs candidatas: ${candidatas.map(([origen, ip]) => `${origen}=${ip}`).join(', ') || 'ninguna'}`);
  // La tailnet usa 100.64.0.0/10: priorizarla; los puentes docker (172.17-172.31) no sirven.
  const esDocker = (ip) => /^172\.(1[7-9]|2\d|3[01])\./.test(ip);
  return (
    candidatas.find(([, ip]) => ip.startsWith('100.'))?.[1] ??
    candidatas.find(([, ip]) => !esDocker(ip))?.[1] ??
    '127.0.0.1'
  );
}

export function copiarVideos(dirVideos, destino) {
  const copiados = [];
  const recorrer = (origen, rel = '') => {
    for (const entrada of readdirSync(origen, { withFileTypes: true })) {
      if (entrada.isDirectory()) recorrer(join(origen, entrada.name), join(rel, entrada.name));
      else if (entrada.name.endsWith('.webm')) {
        const dest = join(destino, rel, entrada.name);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, readFileSync(join(origen, entrada.name)));
        copiados.push(join(rel, entrada.name));
      }
    }
  };
  recorrer(resolve(dirVideos));
  return copiados;
}

export function paginaRun(manifiesto) {
  const porHistoria = new Map();
  for (const e of manifiesto.evidencias) {
    if (!porHistoria.has(e.specTitulo)) porHistoria.set(e.specTitulo, []);
    porHistoria.get(e.specTitulo).push(e);
  }
  const secciones = [...porHistoria.entries()].map(([titulo, evs]) => {
    const bloques = evs.map((e) => {
      const items = e.items.map((i) => `<li>[${i.id}] ${i.texto}${i.hecho ? ' ✓' : ' (pendiente)'}</li>`).join('');
      const video = e.video
        ? `<video controls preload="none" src="${e.video}" style="width:100%;max-width:960px"></video>`
        : '<p><em>Sin video en esta corrida.</em></p>';
      return `<h3>${e.test}</h3><ul>${items}</ul>${video}`;
    }).join('\n');
    return `<section><h2>${titulo}</h2>${bloques}</section>`;
  }).join('\n');
  const huerfanos = (manifiesto.huerfanos ?? []).map((h) => `<li>${h.test} — ${h.motivo}</li>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Cobertura E2E ${manifiesto.run_id}</title></head><body>
<h1>Cobertura E2E — corrida ${manifiesto.run_id}</h1>
<p>Fecha: ${manifiesto.fecha} · modo: ${manifiesto.modo}</p>
${secciones}
${huerfanos ? `<h2>Sin etiqueta válida</h2><ul>${huerfanos}</ul>` : ''}
</body></html>`;
}

function asegurarServidor(base, ip) {
  try {
    execSync(`curl -sf --max-time 3 http://${ip}:${PUERTO}/ > /dev/null`);
    return;
  } catch { /* no escucha en la IP elegida: (re)levantarlo */ }
  execSync(`pkill -f 'http.server ${PUERTO}' || true`, { shell: '/bin/bash' });
  execSync(`nohup python3 -m http.server ${PUERTO} --bind ${ip} --directory ${base} > ${base}/servidor.log 2>&1 &`, { shell: '/bin/bash' });
}

function podar(base) {
  const runs = readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== '__pycache__')
    .map((e) => e.name)
    .sort()
    .reverse();
  for (const viejo of runs.slice(CONSERVAR_RUNS)) rmSync(join(base, viejo), { recursive: true, force: true });
}

const esEjecucionDirecta = process.argv[1] != null && resolve(process.argv[1]).endsWith('publicar-videos-e2e.mjs');
if (esEjecucionDirecta) {
  const args = process.argv.slice(2);
  const manifiestoPath = argumentValue(args, '--manifiesto');
  const dirVideos = argumentValue(args, '--videos');
  const runId = argumentValue(args, '--run-id', `run-${Date.now()}`);
  if (!manifiestoPath || !dirVideos) throw new Error('Uso: node scripts/publicar-videos-e2e.mjs --manifiesto <json> --videos <test-results> [--run-id <id>]');
  if (!existsSync(manifiestoPath)) {
    // El paso corre con if: always(): si el E2E no llegó a correr, no hay nada que publicar.
    console.log(`sin manifiesto ${manifiestoPath}: se omite la publicación de videos.`);
    process.exit(0);
  }
  const manifiesto = JSON.parse(readFileSync(manifiestoPath, 'utf8'));
  const base = join(homedir(), 'e2e-videos');
  const destino = join(base, runId);
  mkdirSync(destino, { recursive: true });
  copiarVideos(dirVideos, destino);
  writeFileSync(join(destino, 'cobertura-e2e.json'), readFileSync(manifiestoPath));
  writeFileSync(join(destino, 'index.html'), paginaRun(manifiesto));
  podar(base);
  const ip = ipTailnet();
  asegurarServidor(base, ip);
  const url = `http://${ip}:${PUERTO}/${runId}/`;
  console.log(`videos publicados en ${url}`);
  const resumen = process.env.GITHUB_STEP_SUMMARY;
  if (resumen) appendFileSync(resumen, `\n### Videos del recorrido visible\n- **Mirar para aprobar:** ${url}\n`);
}
