// Supervisor de runners (MSF-703/704, revisión C+S del lote 99: A1 y A2). Corre en su propio contenedor, lee el PAT del archivo de secretos,
// pide a GitHub una configuración JIT por job y lanza UN contenedor nuevo por job (`docker run --rm`). No ejecuta código de ningún job.
// El PAT no entra nunca al contenedor del job. Ver config-runner.mjs para la arquitectura completa.
import { readFileSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { argumentosCrearRed, argumentosDockerRun, cuerpoJit, entornoDockerRun, leerConfiguracionSupervisor, leerPat, nombreDeContenedor } from './config-runner.mjs';

const API = 'https://api.github.com';

// { id, jit } de un runner efímero nuevo. `fetchFn` se inyecta en las pruebas.
export async function crearRunnerJit({ cfg, pat, nombre, fetchFn = fetch }) {
  const respuesta = await fetchFn(`${API}/repos/${cfg.repo}/actions/runners/generate-jitconfig`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pat}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpoJit(cfg, nombre)),
  });
  if (!respuesta.ok) throw new Error(`GitHub no emitió la configuración JIT (HTTP ${respuesta.status}).`);
  const datos = await respuesta.json();
  if (!datos?.encoded_jit_config || !datos?.runner?.id) throw new Error('GitHub devolvió una respuesta sin configuración JIT.');
  return { id: datos.runner.id, jit: datos.encoded_jit_config };
}

// Borra el runner de GitHub (si el contenedor murió antes de tomar un job queda registrado hasta que vence). Un 404 es lo normal: el JIT se borra solo.
export async function borrarRunner({ cfg, pat, id, fetchFn = fetch }) {
  try {
    await fetchFn(`${API}/repos/${cfg.repo}/actions/runners/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${pat}`, Accept: 'application/vnd.github+json' } });
  } catch { /* La limpieza nunca bloquea el ciclo. */ }
}

// Lanza `docker` con stdio heredado (el job). `env` permite pasar la configuración JIT fuera del argv.
function docker(args, env = process.env) {
  return new Promise((resolve) => {
    const proceso = spawn('docker', args, { stdio: 'inherit', env });
    proceso.on('error', () => resolve(127));
    proceso.on('close', (codigo) => resolve(codigo ?? 1));
  });
}

// Lanza `docker` y captura la salida (consultas cortas: network inspect, ps).
function dockerConSalida(args) {
  return new Promise((resolve) => {
    const proceso = spawn('docker', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let salida = '';
    proceso.stdout.on('data', (trozo) => { salida += trozo; });
    proceso.on('error', () => resolve({ codigo: 127, salida: '' }));
    proceso.on('close', (codigo) => resolve({ codigo: codigo ?? 1, salida: salida.trim() }));
  });
}

// La red dedicada de jobs tiene que existir con la subred FIJA esperada: el firewall la trata distinta de docker0. Si existe con otra subred, se corta.
export async function asegurarRed({ cfg, consultar = dockerConSalida }) {
  const existente = await consultar(['network', 'inspect', '--format', '{{range .IPAM.Config}}{{.Subnet}} {{end}}', cfg.red]);
  if (existente.codigo === 0) {
    if (!existente.salida.split(/\s+/).includes(cfg.subred)) throw new Error(`La red ${cfg.red} existe con otra subred (${existente.salida || 'ninguna'}): se esperaba ${cfg.subred}. Borrala (docker network rm) o ajustá RUNNER_JOBS_SUBNET y el firewall.`);
    return 'existente';
  }
  const creada = await consultar(argumentosCrearRed(cfg));
  if (creada.codigo !== 0) throw new Error(`No se pudo crear la red ${cfg.red} (${cfg.subred}): ¿la subred ya está en uso por otra red de Docker?`);
  return 'creada';
}

// Si el supervisor murió o se reinició, los `docker run` de jobs anteriores siguen vivos hasta terminar su job: al arrancar se eliminan los de ESTE rol.
export async function limpiarHuerfanos({ cfg, consultar = dockerConSalida }) {
  const lista = await consultar(['ps', '-aq', '--filter', 'label=platform-runner=1', '--filter', `label=platform-runner-rol=${cfg.rol}`]);
  const ids = lista.salida.split(/\s+/).filter((id) => /^[0-9a-f]{6,64}$/.test(id));
  if (ids.length > 0) await consultar(['rm', '-f', ...ids]);
  return ids.length;
}

// Un ciclo = un contenedor = un job. Devuelve cuánto duró.
export async function ciclo({ cfg, pat, ranura, ejecutarDocker = docker, fetchFn = fetch, sufijo = randomBytes(4).toString('hex') }) {
  const inicio = Date.now();
  const nombre = nombreDeContenedor(cfg, ranura, sufijo);
  const { id, jit } = await crearRunnerJit({ cfg, pat, nombre, fetchFn });
  try {
    await ejecutarDocker(argumentosDockerRun(cfg, { nombre, jit }), entornoDockerRun(jit));
  } finally {
    await borrarRunner({ cfg, pat, id, fetchFn });
  }
  return Date.now() - inicio;
}

async function main() {
  const cfg = leerConfiguracionSupervisor(process.env);
  const pat = leerPat(process.env, { leer: (ruta) => readFileSync(ruta, 'utf8'), modoDe: (ruta) => statSync(ruta).mode });
  const huerfanos = await limpiarHuerfanos({ cfg });
  if (huerfanos > 0) console.log(`Se eliminaron ${huerfanos} contenedor(es) de jobs huérfanos de un arranque anterior.`);
  await asegurarRed({ cfg });
  let parando = false;
  const detener = () => { parando = true; };
  process.once('SIGINT', detener); process.once('SIGTERM', detener);
  if (cfg.slots === 0) { console.log('RUNNER_SLOTS=0: no se levanta ningún runner.'); await new Promise((resolver) => { const t = setInterval(() => { if (parando) { clearInterval(t); resolver(); } }, 1000); }); return; }
  const ranuras = Array.from({ length: cfg.slots }, (_, i) => i + 1);
  await Promise.all(ranuras.map(async (ranura) => {
    let fallos = 0;
    while (!parando) {
      try {
        const duracion = await ciclo({ cfg, pat, ranura });
        fallos = duracion < 2000 ? fallos + 1 : 0;
      } catch (error) {
        fallos += 1;
        console.error(error instanceof Error ? error.message : 'El ciclo del runner falló.');
      }
      if (fallos >= 5) throw new Error(`La ranura ${ranura} falló ${fallos} veces seguidas: se corta para no girar en vacío.`);
      if (fallos > 0) await new Promise((resolver) => setTimeout(resolver, 10_000));
    }
  }));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : 'El supervisor falló.'); process.exit(1); });
}
