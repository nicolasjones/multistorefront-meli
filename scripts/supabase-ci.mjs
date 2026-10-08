import { execFileSync } from 'node:child_process';
import { connect, createServer } from 'node:net';
import { appendFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Stack de Supabase propio del CI, separado de cualquier stack de desarrollo
// que corra en el mismo Docker que los runners self-hosted. Ver
// docs/deployment.md y .specify/bugs/ci-supabase-desarrollo-compartido/.

const root = path.resolve(import.meta.dirname, '..');
export const WORKDIR_CI = path.join(root, '.supabase-ci');
// El CLI de Supabase recorta el project_id a 40 caracteres para nombrar
// contenedores y volúmenes (supabase_db_<project_id>).
const LARGO_PROJECT_ID = 40;
const PREFIJO_CI = 'ci-';
const BASE_PUERTOS_CI = 20000;
const PUERTO = /^(\s*)([a-z_]*port)(\s*=\s*)(\d+)(.*)$/;
const SECCION = /^\s*\[([^\]]+)\]/;

const recortar = (projectId) => projectId.slice(0, LARGO_PROJECT_ID);

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

// Cada puerto de desarrollo p se mueve a 20000 + p % 10000. Dos productos que
// ya conviven en desarrollo (puertos distintos) quedan también separados en
// CI, y lejos de los rangos que usan los stacks de desarrollo.
export function derivarStackCi(desarrollo, repositorio) {
  const projectId = recortar(`${PREFIJO_CI}${nombreRepositorio(repositorio, desarrollo.projectId)}`);
  const puertos = Object.fromEntries(Object.entries(desarrollo.puertos).map(([clave, puerto]) => [clave, BASE_PUERTOS_CI + (puerto % 10000)]));
  const usados = Object.values(puertos);
  const deDesarrollo = new Set(Object.values(desarrollo.puertos));
  if (new Set(usados).size !== usados.length || usados.some((puerto) => deDesarrollo.has(puerto))) {
    throw new Error('Los puertos derivados para el CI colisionan entre sí o con los de desarrollo; revisá supabase/config.toml.');
  }
  if (recortar(desarrollo.projectId) === projectId) throw new Error('El project_id del CI coincide con el de desarrollo.');
  return { projectId, puertos, puertoDb: puertos['db.port'] };
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

// Guarda: aborta salvo que el destino sea, sin ambigüedad, el stack del CI.
export function verificarDestinoCi({ entorno = process.env, desarrollo, contenedores = contenedoresPublicando }) {
  const puerto = Number(entorno.SUPABASE_DB_PORT);
  const projectId = entorno.SUPABASE_CI_PROJECT_ID?.trim();
  if (!Number.isInteger(puerto) || puerto <= 0 || !projectId) {
    throw new Error('Faltan SUPABASE_DB_PORT o SUPABASE_CI_PROJECT_ID; corré `pnpm db:ci:preparar` antes.');
  }
  const esperado = derivarStackCi(desarrollo, entorno.GITHUB_REPOSITORY);
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

async function preparar() {
  const desarrollo = await leerDesarrollo();
  const stack = derivarStackCi(desarrollo, process.env.GITHUB_REPOSITORY);
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
  console.log(`Stack de CI: ${stack.projectId} (base en el puerto ${stack.puertoDb}, workdir ${WORKDIR_CI}).`);
}

// Dentro del contenedor del runner, 127.0.0.1 es el propio contenedor, pero
// `supabase start` se conecta a 127.0.0.1:<puerto de la base> para terminar
// de inicializar el stack. El puente reenvía sólo el puerto derivado del CI
// hacia el Docker del host mientras dura el `start`.
async function puente() {
  const { puertoDb } = derivarStackCi(await leerDesarrollo(), process.env.GITHUB_REPOSITORY);
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
  if (comando === 'preparar') return await preparar();
  if (comando === 'puente') return await puente();
  if (comando === 'verificar') {
    const { puerto, projectId } = await verificarDestinoCiActual();
    console.log(`Destino verificado: ${projectId} en el puerto ${puerto}.`);
    return;
  }
  throw new Error('Uso: node scripts/supabase-ci.mjs <preparar|puente|verificar>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Supabase del CI: ${error.message}`);
    process.exitCode = 1;
  });
}
