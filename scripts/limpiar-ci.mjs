import { execFileSync } from 'node:child_process';
import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { DIR_CARRILES } from './ci-lane.mjs';

// Janitor del CI: limpia lo que quedó colgado (locks/carriles de jobs muertos,
// stacks de Supabase del CI abandonados y navegadores huérfanos dentro de los
// runners) para que la admisión no se trabe. Por defecto es DRY-RUN: sólo
// lista; `--aplicar` ejecuta.
//
// No toca stacks de desarrollo ni de staging/producción: sólo nombres con el
// prefijo del CI (`ci-`), igual que supabase-ci.mjs. Tampoco toca navegadores
// de jobs en curso: sólo los que llevan más de `CI_RUNNER_BROWSERS_TTL_MIN`
// minutos vivos (por defecto 45, por encima del timeout de 30 min de los jobs).

const DIR_LOCKS_SUPABASE = process.env.SUPABASE_CI_LOCK_DIR || '/pnpm/.ci-locks';
const TTL_MS = Math.max(1, Number(process.env.CI_JANITOR_TTL_MIN || 90) || 90) * 60_000;
const TTL_NAVEGADORES_S = Math.max(1, Number(process.env.CI_RUNNER_BROWSERS_TTL_MIN || 45) || 45) * 60;
const MAX_NAVEGADORES = Math.max(0, Number(process.env.CI_RUNNER_BROWSERS_MAX || 5) || 5);
const MAX_ZOMBIS = Math.max(0, Number(process.env.CI_RUNNER_ZOMBIS_MAX || 20) || 20);

// Procesos de Chromium/Playwright. La barra inicial de `ms-playwright` evita
// matar un `pnpm exec playwright` del propio job; igual la edad es el filtro
// principal.
export const PATRON_NAVEGADOR = /(?:^|\/)(?:chrome-headless|chromium|headless_shell)(?:\s|$|\/)|(?:^|\/)ms-playwright\//i;

// Pura: navegador que ya no puede pertenecer a un job en curso.
export function esNavegador(cmd = '') {
  return PATRON_NAVEGADOR.test(cmd);
}

// Pura: nombres de locks vencidos (de un job muerto sin `liberar`).
export function locksVencidos({ entradas = [], ahora = Date.now(), ttlMs = TTL_MS } = {}) {
  return entradas.filter((entrada) => ahora - entrada.mtimeMs > ttlMs).map((entrada) => entrada.nombre);
}

// Pura: de la salida `docker ps -a --format '{{.Names}}|{{.Status}}'`, los contenedores
// del stack de Supabase del CI (`supabase_*_ci-*`) **detenidos** (Exited/Created/Dead).
// Nunca incluye los que están `Up`: podrían ser un job `database` en curso.
export function contenedoresCi({ lineas = [] } = {}) {
  return lineas
    .map((linea) => {
      const [nombre, ...resto] = linea.split('|');
      return { nombre: nombre?.trim(), estado: resto.join('|').trim() };
    })
    .filter(({ nombre, estado }) => nombre?.startsWith('supabase_') && nombre.includes('_ci-') && !estado.startsWith('Up'))
    .map(({ nombre }) => nombre);
}

// Pura: parsea la salida de `leerProcesos` (pid|ppid|edad_s|estado|cmd) y
// descarta líneas incompletas o procesos del kernel (sin cmdline).
export function parsearProcesos({ salida = '' } = {}) {
  return salida
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter(Boolean)
    .map((linea) => {
      const [pid, ppid, edad, estado, ...cmd] = linea.split('|');
      return { pid: Number(pid), ppid: Number(ppid), edad: Number(edad), estado, cmd: cmd.join('|').trim() };
    })
    .filter((proceso) => Number.isInteger(proceso.pid) && proceso.pid > 1 && Number.isInteger(proceso.edad));
}

// Pura: navegadores vivos con más edad que el TTL. No incluye zombies (no se
// pueden matar: los tiene que cosechar el PID 1 del contenedor) ni procesos
// recientes (podrían ser de un job en curso).
export function navegadoresHuerfanos({ procesos = [], ttlS = TTL_NAVEGADORES_S } = {}) {
  return procesos.filter((proceso) => proceso.estado !== 'Z' && proceso.edad >= ttlS && esNavegador(proceso.cmd));
}

// Pura: cuenta zombies del contenedor (evidencia para el reporte; no se matan).
export function contarZombis(procesos = []) {
  return procesos.filter((proceso) => proceso.estado === 'Z').length;
}

// Pura: ¿la foto después de limpiar sigue fuera de los umbrales?
export function excedeUmbral({ navegadores = 0, zombis = 0, maxNavegadores = MAX_NAVEGADORES, maxZombis = MAX_ZOMBIS } = {}) {
  return { navegadores: navegadores > maxNavegadores, zombis: zombis > maxZombis };
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

function docker(args, opciones = {}) {
  try {
    return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opciones });
  } catch (error) {
    if (error?.stdout) return String(error.stdout);
    return '';
  }
}

// Proyecto Compose del contenedor donde corre el janitor. Se usa para limpiar
// todas las réplicas de ESTE pool sin tocar runners de otros productos.
export function proyectoComposePropio({ inspeccionar = (host) => docker(['inspect', host], { stdio: ['ignore', 'pipe', 'ignore'] }) } = {}) {
  let host;
  try {
    host = execFileSync('hostname', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
  if (!host) return null;
  const salida = inspeccionar(host);
  if (!salida) return null;
  try {
    const datos = JSON.parse(salida);
    const labels = datos?.[0]?.Config?.Labels || {};
    return labels['com.docker.compose.project'] || null;
  } catch {
    return null;
  }
}

// Pura: de la salida de `docker ps --format '{{.Names}}'`, nombres únicos.
export function nombresDeContenedores({ salida = '' } = {}) {
  return [...new Set(salida.split(/\r?\n/).map((nombre) => nombre.trim()).filter(Boolean))];
}

const SCRIPT_LISTAR = `
now=$(awk '{print int($1)}' /proc/uptime)
hz=$(getconf CLK_TCK 2>/dev/null || echo 100)
for d in /proc/[0-9]*; do
  pid=\${d#/proc/}
  [ "$pid" = "$$" ] && continue
  [ -r "$d/stat" ] || continue
  stat=$(cat "$d/stat" 2>/dev/null) || continue
  resto=\${stat##*) }
  estado=$(printf '%s' "$resto" | awk '{print $1}')
  ppid=$(printf '%s' "$resto" | awk '{print $2}')
  start=$(printf '%s' "$resto" | awk '{print $20}')
  [ -n "$start" ] || continue
  edad=$(( now - start / hz ))
  [ "$edad" -lt 0 ] && edad=0
  cmd=$(tr '\\0' ' ' < "$d/cmdline" 2>/dev/null)
  printf '%s|%s|%s|%s|%s\\n' "$pid" "$ppid" "$edad" "$estado" "$cmd"
done
`;

function leerProcesos(contenedor) {
  return parsearProcesos({ salida: docker(['exec', contenedor, 'sh', '-c', SCRIPT_LISTAR]) });
}

function matarProcesos(contenedor, pids) {
  if (pids.length === 0) return;
  docker(['exec', contenedor, 'sh', '-c', 'for pid in "$@"; do kill -9 "$pid" 2>/dev/null || true; done', 'sh', ...pids.map(String)]);
}

function limpiarNavegadores({ aplicar }) {
  const proyecto = proyectoComposePropio();
  const reporte = { proyecto, contenedores: [], omitido: null };
  if (!proyecto) {
    reporte.omitido = 'no se pudo identificar el proyecto Compose (¿fuera de un runner?)';
    return reporte;
  }
  const nombres = nombresDeContenedores({
    salida: docker([
      'ps',
      '--filter', `label=com.docker.compose.project=${proyecto}`,
      '--filter', 'label=com.docker.compose.service=runner',
      '--format', '{{.Names}}',
    ]),
  });
  for (const contenedor of nombres) {
    const antes = leerProcesos(contenedor);
    const antesNavegadores = antes.filter((proceso) => esNavegador(proceso.cmd)).length;
    const antesZombis = contarZombis(antes);
    const huerfanos = navegadoresHuerfanos({ procesos: antes });
    if (aplicar) matarProcesos(contenedor, huerfanos.map((proceso) => proceso.pid));
    const despues = aplicar ? leerProcesos(contenedor) : antes;
    const despuesNavegadores = despues.filter((proceso) => esNavegador(proceso.cmd)).length;
    const despuesZombis = contarZombis(despues);
    reporte.contenedores.push({
      nombre: contenedor,
      antes: { navegadores: antesNavegadores, zombis: antesZombis },
      huerfanos: huerfanos.map((proceso) => ({ pid: proceso.pid, ppid: proceso.ppid, edad: proceso.edad, cmd: proceso.cmd })),
      despues: { navegadores: despuesNavegadores, zombis: despuesZombis },
    });
  }
  return reporte;
}

function imprimirNavegadores(reporte, aplicar) {
  if (reporte.omitido) {
    console.log(`  Navegadores: sin datos (${reporte.omitido})`);
    return;
  }
  console.log(`  Navegadores (proyecto ${reporte.proyecto}):`);
  for (const contenedor of reporte.contenedores) {
    console.log(`    - ${contenedor.nombre}: navegadores ${contenedor.antes.navegadores} → ${contenedor.despues.navegadores}, zombis ${contenedor.antes.zombis} → ${contenedor.despues.zombis}, huérfanos ${contenedor.huerfanos.length}`);
    for (const proceso of contenedor.huerfanos) console.log(`        pid ${proceso.pid} (ppid ${proceso.ppid}, ${proceso.edad}s): ${proceso.cmd}`);
  }
  if (!aplicar) console.log('    (dry-run: no se mata nada; usá --aplicar)');
}

async function main(argv) {
  const aplicar = argv.includes('--aplicar');
  const verificar = argv.includes('--verificar');
  const reporte = { locks: [], carriles: [], contenedores: [], aplicar, verificar };

  if (verificar) {
    const navegadores = limpiarNavegadores({ aplicar: false });
    console.log('Verificando navegadores huérfanos de los runners (sin matar nada):');
    imprimirNavegadores(navegadores, false);
    const conFuga = (navegadores.contenedores || []).filter((contenedor) => contenedor.huerfanos.length > MAX_NAVEGADORES);
    if (navegadores.omitido) {
      console.error(`No se pudo verificar: ${navegadores.omitido}.`);
      process.exitCode = 1;
    } else if (conFuga.length > 0) {
      console.error(`Fuga de navegadores: ${conFuga.map((contenedor) => `${contenedor.nombre} (${contenedor.huerfanos.length})`).join(', ')} supera ${MAX_NAVEGADORES} huérfanos.`);
      process.exitCode = 1;
    } else {
      console.log(`OK: ningún runner supera ${MAX_NAVEGADORES} navegadores huérfanos.`);
    }
    return;
  }

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

  const navegadores = limpiarNavegadores({ aplicar });

  console.log(`${aplicar ? 'Limpiando' : 'Dry-run (usá --aplicar para ejecutar)'}:`);
  console.log(`  Locks vencidos: ${reporte.locks.length}`);
  console.log(`  Carriles vencidos: ${reporte.carriles.length}`);
  console.log(`  Contenedores CI abandonados: ${reporte.contenedores.length}`);
  for (const lista of [reporte.locks, reporte.carriles, reporte.contenedores]) {
    for (const item of lista) console.log(`    - ${item}`);
  }
  imprimirNavegadores(navegadores, aplicar);

  if (!aplicar || navegadores.omitido) return;
  const fuera = navegadores.contenedores.map((contenedor) => ({
    nombre: contenedor.nombre,
    ...excedeUmbral({ navegadores: contenedor.despues.navegadores, zombis: contenedor.despues.zombis }),
  }));
  const conNavegadores = fuera.filter((item) => item.navegadores);
  if (conNavegadores.length > 0) {
    console.error(`Fuga de navegadores: ${conNavegadores.map((item) => item.nombre).join(', ')} supera ${MAX_NAVEGADORES} navegadores después de limpiar.`);
    process.exitCode = 1;
  } else if (fuera.some((item) => item.zombis)) {
    console.warn(`Zombies por encima de ${MAX_ZOMBIS} en ${fuera.filter((item) => item.zombis).map((item) => item.nombre).join(', ')}: recrear los runners con el compose actual (init: true) para que el PID 1 los coseche.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Janitor del CI: ${error.message}`);
    process.exitCode = 1;
  });
}
