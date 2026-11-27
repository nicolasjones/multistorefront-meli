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

// La red dedicada de jobs tiene que existir y ser EXACTAMENTE lo que el firewall espera: driver bridge, ICC desactivado, puente con el nombre fijo y la subred fija. Una red
// PREEXISTENTE que no coincida es un fallo (fallar cerrado): el aislamiento es lo que protege al host de código de PRs.
export async function asegurarRed({ cfg, consultar = dockerConSalida }) {
  const plantilla = '{{.Driver}}|{{index .Options "com.docker.network.bridge.enable_icc"}}|{{index .Options "com.docker.network.bridge.name"}}|{{range .IPAM.Config}}{{.Subnet}} {{end}}';
  const existente = await consultar(['network', 'inspect', '--format', plantilla, cfg.red]);
  if (existente.codigo === 0) {
    const [driver, icc, puente, subredes = ''] = existente.salida.split('|');
    const problemas = [];
    if (driver !== 'bridge') problemas.push(`driver ${driver || 'desconocido'} (se esperaba bridge)`);
    if (icc !== 'false') problemas.push('ICC activado (los jobs podrían hablar entre sí)');
    if (puente !== cfg.puente) problemas.push(`puente ${puente || 'sin nombre fijo'} (se esperaba ${cfg.puente})`);
    if (!subredes.trim().split(/\s+/).includes(cfg.subred)) problemas.push(`subred ${subredes.trim() || 'ninguna'} (se esperaba ${cfg.subred})`);
    if (problemas.length > 0) throw new Error(`La red ${cfg.red} existe pero no coincide con lo que espera el firewall: ${problemas.join('; ')}. Borrala (docker network rm) y dejá que el supervisor la cree, o ajustá RUNNER_JOBS_* y el firewall.`);
    return 'existente';
  }
  const creada = await consultar(argumentosCrearRed(cfg));
  if (creada.codigo !== 0) throw new Error(`No se pudo crear la red ${cfg.red} (${cfg.subred}): ¿la subred o el nombre de puente ya están en uso por otra red de Docker?`);
  return 'creada';
}

// Contenedores de jobs que ya NO corren (creados o muertos que quedaron de un arranque anterior). Los que SIGUEN corriendo se dejan terminar su job: matarlos cortaría
// jobs sanos de otras ranuras; terminan solos y `--rm` los elimina (la JIT es de un solo uso, así que no pueden tomar otro job).
export async function limpiarHuerfanos({ cfg, consultar = dockerConSalida }) {
  const lista = await consultar(['ps', '-aq', '--filter', 'label=platform-runner=1', '--filter', `label=platform-runner-rol=${cfg.rol}`, '--filter', 'status=created', '--filter', 'status=dead', '--filter', 'status=exited']);
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

// Bucle de UNA ranura: ciclos hasta que se pide parar. Tras 5 fallos seguidos SOLO esa ranura se corta (las demás siguen con sus jobs). `parando()` y `dormir` se inyectan.
export async function bucleRanura({ cfg, pat, ranura, parando, ejecutarCiclo = ciclo, dormir = (ms) => new Promise((r) => setTimeout(r, ms)), registrar = console.error }) {
  let fallos = 0;
  while (!parando()) {
    try {
      const duracion = await ejecutarCiclo({ cfg, pat, ranura });
      fallos = duracion < 2000 ? fallos + 1 : 0;
    } catch (error) {
      fallos += 1;
      registrar(error instanceof Error ? error.message : 'El ciclo del runner falló.');
    }
    if (fallos >= 5) { registrar(`La ranura ${ranura} falló ${fallos} veces seguidas: se corta (las demás siguen).`); return 'cortada'; }
    if (fallos > 0) await dormir(10_000);
  }
  return 'detenida';
}

// Una ranura cortada se recupera sola: espera `esperaMs` y vuelve a intentar, hasta `rondas` veces. Cada corte y cada reintento quedan en el log (sin datos sensibles: solo
// el número de ranura y de ronda). Si se agotan las rondas, la ranura queda cortada de forma definitiva y el log lo dice: hace falta mirar el supervisor.
export async function correrRanura({ cfg, pat, ranura, parando, rondas = 3, esperaMs = 300_000, ejecutarBucle = bucleRanura, dormir = (ms) => new Promise((r) => setTimeout(r, ms)), registrar = console.error }) {
  for (let ronda = 1; ronda <= rondas; ronda += 1) {
    const resultado = await ejecutarBucle({ cfg, pat, ranura, parando, registrar });
    if (resultado !== 'cortada') return 'detenida';
    if (ronda === rondas) { registrar(`AVISO: la ranura ${ranura} quedó cortada de forma definitiva tras ${rondas} rondas: revisá el supervisor (docker logs).`); return 'cortada'; }
    registrar(`AVISO: la ranura ${ranura} se cortó (ronda ${ronda} de ${rondas}); se reintenta en ${Math.round(esperaMs / 60_000)} min.`);
    await dormir(esperaMs);
    if (parando()) return 'detenida';
  }
  return 'cortada';
}

async function main() {
  const cfg = leerConfiguracionSupervisor(process.env);
  const pat = leerPat(process.env, { leer: (ruta) => readFileSync(ruta, 'utf8'), modoDe: (ruta) => statSync(ruta).mode });
  const huerfanos = await limpiarHuerfanos({ cfg });
  if (huerfanos > 0) console.log(`Se eliminaron ${huerfanos} contenedor(es) de jobs que habían quedado sin correr.`);
  await asegurarRed({ cfg });
  let parando = false;
  const detener = () => { parando = true; };
  process.once('SIGINT', detener); process.once('SIGTERM', detener);
  if (cfg.slots === 0) { console.log('RUNNER_SLOTS=0: no se levanta ningún runner.'); await new Promise((resolver) => { const t = setInterval(() => { if (parando) { clearInterval(t); resolver(); } }, 1000); }); return; }
  const resultados = await Promise.all(Array.from({ length: cfg.slots }, (_, i) => correrRanura({ cfg, pat, ranura: i + 1, parando: () => parando })));
  if (resultados.every((r) => r === 'cortada')) throw new Error('Todas las ranuras fallaron: se corta el supervisor.');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : 'El supervisor falló.'); process.exit(1); });
}
