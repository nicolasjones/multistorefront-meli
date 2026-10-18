import { execFileSync } from 'node:child_process';
import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { DIR_CARRILES } from './ci-lane.mjs';

// Janitor del CI: limpia lo que quedó colgado (locks/carriles de jobs muertos y
// stacks de Supabase del CI abandonados) para que la admisión no se trabe. Por
// defecto es DRY-RUN: sólo lista; `--aplicar` ejecuta.
//
// No toca stacks de desarrollo ni de staging/producción: sólo nombres con el
// prefijo del CI (`ci-`), igual que supabase-ci.mjs.

const DIR_LOCKS_SUPABASE = process.env.SUPABASE_CI_LOCK_DIR || '/pnpm/.ci-locks';
const TTL_MS = Math.max(1, Number(process.env.CI_JANITOR_TTL_MIN || 90) || 90) * 60_000;

// Pura: nombres de locks vencidos (de un job muerto sin `liberar`).
export function locksVencidos({ entradas = [], ahora = Date.now(), ttlMs = TTL_MS } = {}) {
  return entradas.filter((entrada) => ahora - entrada.mtimeMs > ttlMs).map((entrada) => entrada.nombre);
}

// Pura: de la salida `docker ps -a --format '{{.Names}}|{{.Status}}'`, los contenedores
// del stack de Supabase del CI (`supabase_*_ci-*`), que son descartables.
export function contenedoresCi({ lineas = [] } = {}) {
  return lineas
    .map((linea) => linea.split('|')[0]?.trim())
    .filter((nombre) => nombre?.startsWith('supabase_') && nombre.includes('_ci-'));
}

async function leerEntradas(dir) {
  const nombres = await readdir(dir).catch(() => []);
  const entradas = [];
  for (const nombre of nombres) {
    const info = await stat(path.join(dir, nombre)).catch(() => null);
    if (info) entradas.push({ nombre, mtimeMs: info.mtimeMs });
  }
  return entradas;
}

function contenedoresDocker() {
  try {
    return execFileSync('docker', ['ps', '-a', '--format', '{{.Names}}|{{.Status}}'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

async function main(argv) {
  const aplicar = argv.includes('--aplicar');
  const reporte = { locks: [], carriles: [], contenedores: [], aplicar };

  for (const dir of [DIR_LOCKS_SUPABASE, DIR_CARRILES]) {
    const vencidos = locksVencidos({ entradas: await leerEntradas(dir) });
    for (const nombre of vencidos) {
      const destino = path.join(dir, nombre);
      reporte[dir === DIR_CARRILES ? 'carriles' : 'locks'].push(destino);
      if (aplicar) await rm(destino, { recursive: true, force: true }).catch(() => {});
    }
  }

  for (const nombre of contenedoresCi({ lineas: contenedoresDocker() })) {
    reporte.contenedores.push(nombre);
    if (aplicar) execFileSync('docker', ['rm', '-f', nombre], { stdio: 'ignore' });
  }

  console.log(`${aplicar ? 'Limpiando' : 'Dry-run (usá --aplicar para ejecutar)'}:`);
  console.log(`  Locks vencidos: ${reporte.locks.length}`);
  console.log(`  Carriles vencidos: ${reporte.carriles.length}`);
  console.log(`  Contenedores CI abandonados: ${reporte.contenedores.length}`);
  for (const lista of [reporte.locks, reporte.carriles, reporte.contenedores]) {
    for (const item of lista) console.log(`    - ${item}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Janitor del CI: ${error.message}`);
    process.exitCode = 1;
  });
}
