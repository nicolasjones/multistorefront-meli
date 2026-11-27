// Guardas estáticas de los workflows de GitHub Actions (auditoría MSF-647):
//   - MSF-925: toda acción de terceros (`uses: owner/repo@ref`) va pineada por SHA COMPLETO de commit (40 hex) con un comentario
//     con el tag que resolvió (`# v4`). Un tag mutable (`@v4`) deja que el dueño de la acción cambie lo que corre en nuestros
//     runners self-hosted sin que nadie lo revise. Las acciones locales (`./...`) y los workflows reutilizables locales no aplican.
//   - MSF-926: todo job que corre pasos (`runs-on`) declara `timeout-minutes`: el default de GitHub son 360 min y un job colgado
//     ocuparía un runner self-hosted horas. Los jobs que solo llaman a un workflow reutilizable (`uses:` a nivel de job) no lo admiten.
//   - MSF-703/704: higiene de los pools de runners (NO es un control de seguridad frente a un autor hostil: en un `pull_request` GitHub usa el
//     workflow del propio PR, que puede cambiar `runs-on`, y este guard corre desde ese mismo PR). Ningún `runs-on` lleva la etiqueta `self-hosted`
//     literal: va por una variable de repo (`vars.CI_RUNS_ON_PR` para PR/CI, `vars.CI_RUNS_ON_DEPLOY` para deploys, `vars.CI_RUNS_ON_PESADO` para los
//     jobs pesados). Los jobs con `environment:` y el de release-please van SIEMPRE en el pool de deploy y ningún otro job lo usa; un workflow
//     disparado por `pull_request` no puede tener jobs con `environment:`. Sirve para que un error honesto de un mantenedor no mezcle los pools.
//     Lo que protege los secretos de producción es que los Environments estén restringidos a ramas protegidas y que cada job corra en un contenedor
//     que se destruye al terminar (docs/endurecimiento-infra.md, «Control principal»).
// Uso: node scripts/verificar-workflows.mjs [directorio] (por defecto .github/workflows). Sale 1 con la lista de hallazgos.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function analizar(nombre, texto) {
  const hallazgos = [];
  const lineas = texto.split('\n');
  lineas.forEach((linea, i) => {
    const m = linea.match(/^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/);
    if (!m) return;
    const destino = m[1];
    if (destino.startsWith('./') || destino.startsWith('docker://')) return;
    const [, ref] = destino.split('@');
    if (!/^[0-9a-f]{40}$/.test(ref ?? '')) hallazgos.push(`${nombre}:${i + 1}: ${destino} no está pineada por SHA completo de commit.`);
    else if (!/^\s*#\s*\S+/.test(m[2])) hallazgos.push(`${nombre}:${i + 1}: ${destino} no lleva el comentario con el tag (\`# v4\`).`);
  });
  const inicio = lineas.indexOf('jobs:');
  if (inicio !== -1) {
    let job = null;
    const jobs = [];
    for (const linea of lineas.slice(inicio + 1)) {
      const m = linea.match(/^ {2}([\w-]+):\s*$/);
      if (m) { job = { nombre: m[1], timeout: false, runsOn: false, runsOnTexto: '', usa: false, environment: false, release: false }; jobs.push(job); continue; }
      if (!job) continue;
      if (/^ {4}timeout-minutes:/.test(linea)) job.timeout = true;
      if (/^ {4}runs-on:/.test(linea)) { job.runsOn = true; job.runsOnTexto = linea; }
      if (/^ {4}uses:/.test(linea)) job.usa = true;
      if (/^ {4}environment:/.test(linea)) job.environment = true;
      if (linea.includes('googleapis/release-please-action')) job.release = true;
    }
    for (const j of jobs) if (j.runsOn && !j.usa && !j.timeout) hallazgos.push(`${nombre}: el job ${j.nombre} no declara timeout-minutes.`);
    hallazgos.push(...analizarPools(nombre, lineas, jobs));
  }
  return hallazgos;
}

// Disparadores del workflow (claves de `on:` a 2 espacios de sangría). Acepta `on:` y `"on":`.
function disparadores(lineas) {
  const i = lineas.findIndex((l) => /^["']?on["']?:\s*$/.test(l));
  if (i === -1) return new Set();
  const claves = new Set();
  for (const l of lineas.slice(i + 1)) {
    if (/^\S/.test(l)) break;
    const m = l.match(/^ {2}([\w_]+):/);
    if (m) claves.add(m[1]);
  }
  return claves;
}

// MSF-703/704: reglas de separación de pools (ver el encabezado).
export function analizarPools(nombre, lineas, jobs) {
  const hallazgos = [];
  const esPr = ['pull_request', 'pull_request_target'].some((t) => disparadores(lineas).has(t));
  for (const j of jobs) {
    if (!j.runsOn) continue;
    const texto = j.runsOnTexto;
    const usaDeploy = texto.includes('vars.CI_RUNS_ON_DEPLOY');
    const deberiaDeploy = j.environment || j.release;
    if (texto.includes('self-hosted') && !texto.includes('vars.CI_RUNS_ON_')) hallazgos.push(`${nombre}: el job ${j.nombre} fija la etiqueta self-hosted a mano: usá vars.CI_RUNS_ON_PR, CI_RUNS_ON_PESADO o CI_RUNS_ON_DEPLOY (MSF-703/704).`);
    if (texto.includes('platform-deploy')) hallazgos.push(`${nombre}: el job ${j.nombre} nombra platform-deploy a mano: la etiqueta vive en la variable CI_RUNS_ON_DEPLOY.`);
    if (deberiaDeploy && !usaDeploy) hallazgos.push(`${nombre}: el job ${j.nombre} ${j.environment ? 'usa un environment (secretos de staging/producción)' : 'publica un release'} y debe correr en el pool de deploy (vars.CI_RUNS_ON_DEPLOY), no en el de PR (MSF-704).`);
    if (!deberiaDeploy && usaDeploy) hallazgos.push(`${nombre}: el job ${j.nombre} usa el pool de deploy sin environment ni release: el pool de deploy es solo para jobs con secretos de producción.`);
    if (esPr && j.environment) hallazgos.push(`${nombre}: el job ${j.nombre} usa un environment en un workflow disparado por pull_request: el código de un PR no puede tocar secretos de entorno.`);
  }
  return hallazgos;
}

export function analizarDirectorio(directorio) {
  return readdirSync(directorio)
    .filter((f) => /\.ya?ml$/.test(f))
    .flatMap((f) => analizar(f, readFileSync(path.join(directorio, f), 'utf8')));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const hallazgos = analizarDirectorio(process.argv[2] ?? '.github/workflows');
  for (const h of hallazgos) console.error(h);
  if (hallazgos.length > 0) process.exit(1);
  console.log('Workflows: acciones pineadas por SHA, jobs con timeout-minutes y pools de runners separados (PR / deploy).');
}
