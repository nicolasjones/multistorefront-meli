import { appendFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { cpus, loadavg } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Admisión del CI (control de concurrencia). Mientras un PR corre lo pesado
// "tiene" un carril; los demás PRs ESPERAN en vez de oversuscribir los runners.
// Reusa el patrón de ranuras de `supabase-ci.mjs`: la reserva es un `mkdir`
// atómico en el volumen que comparten todas las réplicas (`/pnpm/.ci-lanes`),
// con TTL para reciclar el carril de un job que murió sin liberar.
//
// Además, un CORTACIRCUITOS por carga del host: si `load` supera los núcleos por
// el factor `CI_LOAD_MAX`, no arranca trabajo pesado (espera). Con
// `CI_LOAD_MAX=0` (default) el cortacircuitos queda apagado.
//
// Fail-open: agotado `CI_LANE_WAIT_MIN` sin carril (o con el host cargado), el
// job sigue SIN admisión y avisa, en vez de poner el PR en rojo.
//
// Variables:
//   CI_LANES        carriles totales (0/vacío = admisión desactivada, no-op).
//   CI_LANE_DIR     directorio de carriles (default /pnpm/.ci-lanes).
//   CI_LANE_TTL_MIN TTL del carril en minutos (default 50).
//   CI_LANE_WAIT_MIN espera máxima por un carril en minutos (default 15).
//   CI_LOAD_MAX     factor de carga del cortacircuitos (default 0 = apagado).

export const DIR_CARRILES = process.env.CI_LANE_DIR || '/pnpm/.ci-lanes';
export const CARRILES = Math.max(0, Math.trunc(Number(process.env.CI_LANES || 0) || 0));
export const TTL_MS = Math.max(1, Number(process.env.CI_LANE_TTL_MIN || 50) || 50) * 60_000;
export const ESPERA_MS = Math.max(0, Number(process.env.CI_LANE_WAIT_MIN || 15) || 15) * 60_000;
export const FACTOR_CARGA = Math.max(0, Number(process.env.CI_LOAD_MAX || 0) || 0);
const NOMBRE = process.env.CI_LANE_NAME || 'ci';

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Pura respecto de `dir`/`ahora`/`ttlMs` → testeable con un temp dir. Devuelve el
// índice del carril tomado, o `null` si no hay ninguno libre.
export async function intentarCarriles({ dir = DIR_CARRILES, nombre = NOMBRE, carriles = CARRILES, ttlMs = TTL_MS, ahora = Date.now } = {}) {
  if (carriles <= 0) return null;
  await mkdir(dir, { recursive: true });
  for (let i = 0; i < carriles; i++) {
    const lock = path.join(dir, `${nombre}-${i}`);
    // Dos intentos por carril: si el `mkdir` falla y el lock quedó viejo (job
    // muerto), lo recicla y reintenta la MISMA ranura antes de pasar a la otra.
    for (let intento = 0; intento < 2; intento++) {
      try {
        await mkdir(lock);
        return i;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const info = intento === 0 ? await stat(lock).catch(() => null) : null;
        if (info && ahora() - info.mtimeMs > ttlMs) {
          await rm(lock, { recursive: true, force: true }).catch(() => {});
          continue;
        }
        break;
      }
    }
  }
  return null;
}

export function carrilesEnUso({ dir = DIR_CARRILES, nombre = NOMBRE } = {}) {
  return readdir(dir).then((entradas) => entradas.filter((entrada) => entrada.startsWith(`${nombre}-`)).length).catch(() => 0);
}

// Pura: ¿el host está demasiado cargado para arrancar otro job pesado?
export function cargaExcedida({ load = loadavg()[0], nucleos = cpus().length, factor = FACTOR_CARGA } = {}) {
  return factor > 0 && nucleos > 0 && load > nucleos * factor;
}

async function publicar(carril) {
  if (process.env.GITHUB_ENV) await appendFile(process.env.GITHUB_ENV, `CI_LANE=${carril}\n`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `lane=${carril}\n`);
}

async function reclamar() {
  if (CARRILES <= 0) {
    console.log('CI_LANES sin definir (o 0): admisión del CI desactivada.');
    return await publicar('');
  }
  const limite = Date.now() + ESPERA_MS;
  for (;;) {
    if (!cargaExcedida()) {
      const carril = await intentarCarriles({ nombre: NOMBRE });
      if (carril !== null) {
        console.log(`Carril ${carril + 1}/${CARRILES} reservado (${DIR_CARRILES}).`);
        return await publicar(String(carril));
      }
    } else {
      console.log(`Host cargado (load ${loadavg()[0].toFixed(1)}/${cpus().length}, factor ${FACTOR_CARGA}).`);
    }
    if (Date.now() >= limite) {
      // Fail-open: agotado el plazo seguimos SIN carril (con aviso) en vez de
      // poner el PR en rojo. La admisión protege el caso normal; bajo una
      // avalancha sostenida degrada, pero no bloquea la entrega. Si querés que
      // falle, corré el janitor y subí la espera.
      console.log(`Sin carril o host cargado tras ${ESPERA_MS / 60000} min: sigo SIN admisión (fail-open).`);
      return await publicar('');
    }
    console.log('Espero 10 s por un carril…');
    await esperar(10_000);
  }
}

async function liberar() {
  const carril = process.env.CI_LANE;
  if (carril === undefined || carril === '') {
    console.log('Sin carril que liberar.');
    return;
  }
  await rm(path.join(DIR_CARRILES, `${NOMBRE}-${Math.max(0, Math.trunc(Number(carril) || 0))}`), { recursive: true, force: true }).catch(() => {});
  console.log(`Carril ${Number(carril) + 1} liberado.`);
}

async function estado() {
  const [enUso] = await Promise.all([carrilesEnUso()]);
  const datos = { carriles: CARRILES, enUso, libres: Math.max(0, CARRILES - enUso), load: Number(loadavg()[0].toFixed(2)), nucleos: cpus().length, cargaExcedida: cargaExcedida() };
  console.log(JSON.stringify(datos, null, 2));
}

async function main([comando]) {
  if (comando === 'reclamar') return await reclamar();
  if (comando === 'liberar') return await liberar();
  if (comando === 'estado') return await estado();
  throw new Error('Uso: node scripts/ci-lane.mjs <reclamar|liberar|estado>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Carriles del CI: ${error.message}`);
    process.exitCode = 1;
  });
}
