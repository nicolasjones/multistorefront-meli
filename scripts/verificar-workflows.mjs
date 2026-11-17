// Guardas estáticas de los workflows de GitHub Actions (auditoría MSF-647):
//   - MSF-925: toda acción de terceros (`uses: owner/repo@ref`) va pineada por SHA COMPLETO de commit (40 hex) con un comentario
//     con el tag que resolvió (`# v4`). Un tag mutable (`@v4`) deja que el dueño de la acción cambie lo que corre en nuestros
//     runners self-hosted sin que nadie lo revise. Las acciones locales (`./...`) y los workflows reutilizables locales no aplican.
//   - MSF-926: todo job que corre pasos (`runs-on`) declara `timeout-minutes`: el default de GitHub son 360 min y un job colgado
//     ocuparía un runner self-hosted horas. Los jobs que solo llaman a un workflow reutilizable (`uses:` a nivel de job) no lo admiten.
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
      if (m) { job = { nombre: m[1], timeout: false, runsOn: false, usa: false }; jobs.push(job); continue; }
      if (!job) continue;
      if (/^ {4}timeout-minutes:/.test(linea)) job.timeout = true;
      if (/^ {4}runs-on:/.test(linea)) job.runsOn = true;
      if (/^ {4}uses:/.test(linea)) job.usa = true;
    }
    for (const j of jobs) if (j.runsOn && !j.usa && !j.timeout) hallazgos.push(`${nombre}: el job ${j.nombre} no declara timeout-minutes.`);
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
  console.log('Workflows: todas las acciones pineadas por SHA y todos los jobs con timeout-minutes.');
}
