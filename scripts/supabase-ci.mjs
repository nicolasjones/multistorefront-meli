import { execFileSync } from 'node:child_process';
import { connect, createServer } from 'node:net';
import { appendFile, cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Stack de Supabase propio del CI, separado de cualquier stack de desarrollo
// que corra en el mismo Docker que los runners self-hosted. Ver
// docs/deployment.md y .specify/bugs/ci-supabase-desarrollo-compartido/.
//
// S3a (FEAT-134): el stack se deriva por RANURA para que varias corridas del job `database` del mismo
// repo convivan sin pisarse. Antes había UNA sola pila + `concurrency: group: supabase-ci-<repo>`, y
// al entrar una tercer corrida GitHub *cancelaba* la pendiente (BUG-179). Cada ranura tiene su
// project_id y su rango de puertos; la reserva es un `mkdir` atómico en el volumen pnpm que ya
// comparten todas las réplicas del runner (`/pnpm/.ci-locks`). Sin ranura libre, el job ESPERA.

const root = path.resolve(import.meta.dirname, '..');
export const WORKDIR_CI = path.join(root, '.supabase-ci');
// El CLI de Supabase recorta el project_id a 40 caracteres para nombrar
// contenedores y volúmenes (supabase_db_<project_id>).
const LARGO_PROJECT_ID = 40;
const PREFIJO_CI = 'ci-';
const BASE_PUERTOS_CI = 20000;
// Separación entre ranuras: cada una usa `base + (puerto % 10000)`, con un abanico real < 10000. 6000
// las separa sin solapar y deja 5 ranuras abajo de 65535 sin tocar los puertos de desarrollo.
const PASO_RANURA = 6000;
// 5 = tope seguro: la ranura 5 empujaría puertos ~57329 (pooler de desarrollo). Lo cubren los tests.
export const NUM_RANURAS = Math.max(1, Math.min(5, Number(process.env.SUPABASE_CI_RANURAS || 5) || 5));
const DIR_LOCKS = process.env.SUPABASE_CI_LOCK_DIR || '/pnpm/.ci-locks';
const TTL_LOCK_MS = Math.max(1, Number(process.env.SUPABASE_CI_LOCK_TTL_MIN || 50) || 50) * 60_000;
const ESPERA_LOCK_MS = Math.max(0, Number(process.env.SUPABASE_CI_LOCK_MIN || 20) || 20) * 60_000;
const PUERTO = /^(\s*)([a-z_]*port)(\s*=\s*)(\d+)(.*)$/;
const SECCION = /^\s*\[([^\]]+)\]/;

const recortar = (projectId) => projectId.slice(0, LARGO_PROJECT_ID);
const normalizarRanura = (valor) => Math.max(0, Math.trunc(Number(valor) || 0));

export function leerConfigDesarrollo(texto) {
  const projectId = texto.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
  if (!projectId) throw new Error('supabase/config.toml no declara project_id.');
  let seccion = '';
  const puertos = {};
  for (const linea of texto.split(/\r?\n/)) {
    seccion = linea.match(SECCION)?.[1] ?? seccion;
    const puerto = linea.match(PUERTO);
    if (puerto) puertos[`${seccion}.${puerto[2]}`] = Number(puerto[4]);
  }
  return { projectId, puertos };
}

export function nombreRepositorio(repositorio, projectIdDesarrollo) {
  const nombre = repositorio?.split('/').pop() || projectIdDesarrollo.replace(/-supabase-dev$/, '');
  return nombre.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
}

// Cada puerto de desarrollo p se mueve a `base + p % 10000` (base = 20000 + ranura * 6000). Dos
// productos que ya conviven en desarrollo (puertos distintos) quedan también separados en CI, lejos de
// los rangos de desarrollo, y cada ranura del mismo repo tiene su propio rango.
export function derivarStackCi(desarrollo, repositorio, ranura = 0) {
  const r = normalizarRanura(ranura);
  if (r >= NUM_RANURAS) throw new Error(`La ranura ${r} excede SUPABASE_CI_RANURAS (${NUM_RANURAS}).`);
  // La ranura va ANTES del nombre del repo: si el project_id se recorta a 40, la ranura sobrevive.
  const projectId = recortar(`${PREFIJO_CI}${r ? `r${r}-` : ''}${nombreRepositorio(repositorio, desarrollo.projectId)}`);
  const base = BASE_PUERTOS_CI + r * PASO_RANURA;
  const puertos = Object.fromEntries(Object.entries(desarrollo.puertos).map(([clave, puerto]) => [clave, base + (puerto % 10000)]));
  const usados = Object.values(puertos);
  const deDesarrollo = new Set(Object.values(desarrollo.puertos));
  if (new Set(usados).size !== usados.length || usados.some((puerto) => deDesarrollo.has(puerto))) {
    throw new Error('Los puertos derivados para el CI colisionan entre sí o con los de desarrollo; revisá supabase/config.toml.');
  }
  const min = Math.min(...usados);
  const max = Math.max(...usados);
  if (max - min >= PASO_RANURA) throw new Error(`El abanico de puertos del stack del CI (${max - min}) no entra en una ranura (< ${PASO_RANURA}).`);
  if (max >= 65536) throw new Error(`Los puertos de la ranura ${r} del CI pasan de 65535; bajá SUPABASE_CI_RANURAS.`);
  if (recortar(desarrollo.projectId) === projectId) throw new Error('El project_id del CI coincide con el de desarrollo.');
  return { projectId, puertos, puertoDb: puertos['db.port'], ranura: r };
}

// Reescribe project_id y puertos; desactiva migraciones y seed del `start`
// porque las aplica db:reset:ci por host.docker.internal.
export function configCi(texto, stack) {
  let seccion = '';
  return texto.split(/(\r?\n)/).map((linea) => {
    if (/^\r?\n$/.test(linea)) return linea;
    seccion = linea.match(SECCION)?.[1] ?? seccion;
    if (/^project_id\s*=/.test(linea)) return `project_id = "${stack.projectId}"`;
    const puerto = linea.match(PUERTO);
    if (puerto) return `${puerto[1]}${puerto[2]}${puerto[3]}${stack.puertos[`${seccion}.${puerto[2]}`]}${puerto[5]}`;
    if ((seccion === 'db.migrations' || seccion === 'db.seed') && /^enabled\s*=/.test(linea)) return 'enabled = false';
    return linea;
  }).join('');
}

function contenedoresPublicando(puerto) {
  return execFileSync('docker', ['ps', '--filter', `publish=${puerto}`, '--format', '{{.Names}}'], { encoding: 'utf8' })
    .split(/\r?\n/).map((nombre) => nombre.trim()).filter(Boolean);
}

async function leerDesarrollo() {
  return leerConfigDesarrollo(await readFile(path.join(root, 'supabase/config.toml'), 'utf8'));
}

const ranuraDeEntorno = (entorno) => normalizarRanura(entorno.SUPABASE_CI_RANURA);

// Guarda: aborta salvo que el destino sea, sin ambigüedad, el stack del CI (de la ranura declarada).
export function verificarDestinoCi({ entorno = process.env, desarrollo, contenedores = contenedoresPublicando }) {
  const puerto = Number(entorno.SUPABASE_DB_PORT);
  const projectId = entorno.SUPABASE_CI_PROJECT_ID?.trim();
  if (!Number.isInteger(puerto) || puerto <= 0 || !projectId) {
    throw new Error('Faltan SUPABASE_DB_PORT o SUPABASE_CI_PROJECT_ID; corré `pnpm db:ci:preparar` antes.');
  }
  const esperado = derivarStackCi(desarrollo, entorno.GITHUB_REPOSITORY, ranuraDeEntorno(entorno));
  if (projectId !== esperado.projectId || !projectId.startsWith(PREFIJO_CI) || recortar(desarrollo.projectId) === projectId) {
    throw new Error(`El project_id ${projectId} no es el del stack del CI (${esperado.projectId}).`);
  }
  if (Object.values(desarrollo.puertos).includes(puerto) || puerto !== esperado.puertoDb) {
    throw new Error(`El puerto ${puerto} no es el de la base del CI (${esperado.puertoDb}); no se toca un stack de desarrollo.`);
  }
  const nombres = contenedores(puerto);
  const esperadoContenedor = `supabase_db_${projectId}`;
  if (nombres.length !== 1 || nombres[0] !== esperadoContenedor) {
    throw new Error(`El puerto ${puerto} lo publica [${nombres.join(', ') || 'nadie'}], no ${esperadoContenedor}.`);
  }
  return { puerto, projectId };
}

export async function verificarDestinoCiActual() {
  return verificarDestinoCi({ desarrollo: await leerDesarrollo() });
}

// Reserva ATÓMICA de ranuras: `mkdir` sin `recursive` falla con EEXIST si ya está tomada, y todas las
// réplicas del runner comparten el volumen. Función pura respecto de su `dir` → testeable con un temp dir.
export async function intentarRanuras({ dir = DIR_LOCKS, nombre, ranuras = NUM_RANURAS, ttlMs = TTL_LOCK_MS, ahora = Date.now } = {}) {
  await mkdir(dir, { recursive: true });
  for (let i = 0; i < ranuras; i++) {
    const lock = path.join(dir, `${nombre}-${i}`);
    // Dos intentos por ranura: si el `mkdir` falla y el lock quedó viejo (job muerto sin `liberar`),
    // lo recicla y reintenta la MISMA ranura antes de pasar a la siguiente.
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
        break; // tomada por un job vivo: siguiente ranura
      }
    }
  }
  return null;
}

async function nombreLock() {
  return nombreRepositorio(process.env.GITHUB_REPOSITORY, (await leerDesarrollo()).projectId);
}

async function reclamar() {
  const nombre = await nombreLock();
  const limite = Date.now() + ESPERA_LOCK_MS;
  for (;;) {
    const ranura = await intentarRanuras({ nombre });
    if (ranura !== null) {
      if (process.env.GITHUB_ENV) await appendFile(process.env.GITHUB_ENV, `SUPABASE_CI_RANURA=${ranura}\n`);
      console.log(`Ranura ${ranura}/${NUM_RANURAS} reservada para el stack del CI (${DIR_LOCKS}).`);
      return;
    }
    if (Date.now() >= limite) {
      throw new Error(`No hay ranura libre para el stack del CI (${NUM_RANURAS} en uso tras esperar ${ESPERA_LOCK_MS / 60000} min); ¿jobs colgados?`);
    }
    console.log('Sin ranura libre; reintento en 10 s…');
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

async function liberar() {
  const ranura = process.env.SUPABASE_CI_RANURA;
  if (ranura === undefined || ranura === '') return;
  const nombre = await nombreLock();
  await rm(path.join(DIR_LOCKS, `${nombre}-${normalizarRanura(ranura)}`), { recursive: true, force: true }).catch(() => {});
  console.log(`Ranura ${ranura} liberada.`);
}

async function preparar() {
  const desarrollo = await leerDesarrollo();
  const stack = derivarStackCi(desarrollo, process.env.GITHUB_REPOSITORY, process.env.SUPABASE_CI_RANURA);
  const destino = path.join(WORKDIR_CI, 'supabase');
  await rm(WORKDIR_CI, { recursive: true, force: true });
  await mkdir(WORKDIR_CI, { recursive: true });
  await cp(path.join(root, 'supabase'), destino, {
    recursive: true,
    filter: (origen) => !/[\\/](\.temp|\.branches|snippets)([\\/]|$)/.test(path.relative(root, origen)),
  });
  const texto = await readFile(path.join(root, 'supabase/config.toml'), 'utf8');
  await writeFile(path.join(destino, 'config.toml'), configCi(texto, stack));
  const variables = { SUPABASE_CI_WORKDIR: WORKDIR_CI, SUPABASE_CI_PROJECT_ID: stack.projectId, SUPABASE_DB_PORT: String(stack.puertoDb) };
  if (process.env.GITHUB_ENV) {
    await appendFile(process.env.GITHUB_ENV, Object.entries(variables).map(([clave, valor]) => `${clave}=${valor}\n`).join(''));
  }
  console.log(`Stack de CI: ${stack.projectId} (ranura ${stack.ranura}, base en el puerto ${stack.puertoDb}, workdir ${WORKDIR_CI}).`);
}

// Dentro del contenedor del runner, 127.0.0.1 es el propio contenedor, pero
// `supabase start` se conecta a 127.0.0.1:<puerto de la base> para terminar
// de inicializar el stack. El puente reenvía sólo el puerto derivado del CI
// hacia el Docker del host mientras dura el `start`.
async function puente() {
  const { puertoDb } = derivarStackCi(await leerDesarrollo(), process.env.GITHUB_REPOSITORY, process.env.SUPABASE_CI_RANURA);
  const servidor = createServer((cliente) => {
    const destino = connect(puertoDb, 'host.docker.internal');
    cliente.pipe(destino).pipe(cliente);
    const cerrar = () => { cliente.destroy(); destino.destroy(); };
    cliente.on('error', cerrar);
    destino.on('error', cerrar);
  });
  await new Promise((resolve, reject) => servidor.once('error', reject).listen(puertoDb, '127.0.0.1', resolve));
  console.log(`Puente 127.0.0.1:${puertoDb} → host.docker.internal:${puertoDb} activo.`);
}

async function main([comando]) {
  if (comando === 'reclamar') return await reclamar();
  if (comando === 'liberar') return await liberar();
  if (comando === 'preparar') return await preparar();
  if (comando === 'puente') return await puente();
  if (comando === 'verificar') {
    const { puerto, projectId } = await verificarDestinoCiActual();
    console.log(`Destino verificado: ${projectId} en el puerto ${puerto}.`);
    return;
  }
  throw new Error('Uso: node scripts/supabase-ci.mjs <reclamar|liberar|preparar|puente|verificar>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Supabase del CI: ${error.message}`);
    process.exitCode = 1;
  });
}
