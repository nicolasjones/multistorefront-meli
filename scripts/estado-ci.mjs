import { execFileSync } from 'node:child_process';
import { cpus, loadavg } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { CARRILES, carrilesEnUso } from './ci-lane.mjs';

// Observabilidad del CI: una foto de qué tan ocupado está el sistema para
// decidir si conviene escalar runners o si algo quedó colgado. No cambia nada.

// Pura: arma el texto del reporte (testeable sin tocar el host).
export function resumir({ carriles = 0, enUso = 0, load = 0, nucleos = 1, runners = null } = {}) {
  const lineas = [];
  lineas.push(`Carriles CI: ${enUso}/${carriles} en uso${carriles === 0 ? ' (admisión desactivada)' : ''}`);
  lineas.push(`Host: load ${Number(load).toFixed(2)} sobre ${nucleos} núcleo(s)${load > nucleos ? ' — saturado' : ''}`);
  if (Array.isArray(runners)) {
    const ocupados = runners.filter((runner) => runner.busy).length;
    lineas.push(`Runners: ${ocupados}/${runners.length} ocupados`);
    for (const runner of runners) {
      lineas.push(`  - ${runner.name} ${runner.busy ? 'ocupado' : 'libre'}`);
    }
  } else {
    lineas.push('Runners: sin datos (gh no disponible o sin token).');
  }
  return lineas.join('\n');
}

function runnersDeGh() {
  try {
    const repo = process.env.GITHUB_REPOSITORY || 'nicolasjones/multistorefront-meli';
    const salida = execFileSync('gh', ['api', `repos/${repo}/actions/runners`, '--jq', '.runners[] | "\(.name) \(.busy)"'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return salida
      .split(/\r?\n/)
      .map((linea) => linea.trim())
      .filter(Boolean)
      .map((linea) => {
        const [name, busy] = linea.split(/\s+/);
        return { name, busy: busy === 'true' };
      });
  } catch {
    return null;
  }
}

async function main() {
  const enUso = await carrilesEnUso();
  const linea = resumir({ carriles: CARRILES, enUso, load: loadavg()[0], nucleos: cpus().length, runners: runnersDeGh() });
  console.log(linea);
  const json = Boolean(process.env.CI_ESTADO_JSON);
  if (json) {
    console.log(JSON.stringify({ carriles: CARRILES, enUso, load: Number(loadavg()[0].toFixed(2)), nucleos: cpus().length, runners: runnersDeGh() }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Estado del CI: ${error.message}`);
    process.exitCode = 1;
  });
}
