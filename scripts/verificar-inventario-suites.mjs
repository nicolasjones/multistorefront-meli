// Inventario de suites de prueba frente al CI (MSF-679). Falla si una suite `test:*` de package.json o un archivo de test
// existe y NINGÚN workflow la corre, salvo que figure en EXCLUIDAS con su motivo. También falla si una exclusión quedó
// vieja (la suite ya corre, o ya no existe) o si docs/control-ci.md no nombra cada exclusión. Sin esto, las suites nuevas
// se acumulan sin que nadie las corra (así pasó con el test roto de MSF-631).
// «Corre en el CI» = alcanzable desde el texto de los workflows siguiendo `pnpm <script>` de package.json.
// Uso: node scripts/verificar-inventario-suites.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Suites `test:*` que el CI NO corre, cada una con el motivo. Tiene que coincidir con «Qué tests corre el CI» de docs/control-ci.md.
export const EXCLUIDAS = {
  'test:e2e': 'Playwright con sesión: corre en los jobs e2e de validate.yml con `playwright test` directo, no por este script',
  'test:e2e:evidencia': 'corre con navegador visible para capturar evidencia: herramienta manual',
  'test:e2e:headed': 'navegador visible: depuración local',
  'test:e2e:report': 'abre el reporte HTML y queda esperando: depuración local',
  'test:e2e:trace': 'abre el visor de trazas: depuración local',
  'test:e2e:codegen': 'graba acciones en un navegador abierto: depuración local',
  'test:e2e:storage': 'graba el estado de sesión en auth.json: depuración local',
  'test:e2e:ui': 'abre la interfaz interactiva de Playwright: depuración local',
  'test:e2e:record': 'graba video y traza para revisar a mano: herramienta manual',
  'test:web': 'agregado local: la suite web corre en los jobs `web` (vitest shardeado) y cada test:edge:* se corre aparte',
  'test:db': 'pgTAP contra Supabase local: corre en el job `database` de validate.yml con pg_prove, no por este script',
  'test:historia:item': 'ya corre dentro de test:tooling (mismo archivo)',
  'test:tracker:duplicados': 'ya corre dentro de test:tooling (mismo archivo)',
  'test:afectados': 'selector que corre otros tests según el diff, no es una suite propia',
  'test:auth:hook-bloqueo:e2e': 'necesita Supabase local levantado',
  'test:acceso:e2e': 'necesita Supabase local levantado',
  'test:kestra:secretos:e2e': 'necesita Kestra levantado',
  'test:kestra:evidencia:e2e': 'necesita Kestra levantado',
  'test:kestra:reintentos:e2e': 'necesita Kestra levantado',
  'test:kestra:conexion-trabada:e2e': 'necesita Kestra y Supabase levantados',
  'test:superset:embebido': 'exige un Superset vivo y credenciales',
  'test:superset:aislamiento-tokens': 'exige un Superset vivo y credenciales',
  'test:ia:aprovisionamiento': 'usa docker, que el job `chequeos` no tiene',
};

// Archivos de test que ningún script alcanzable corre y por qué (solo lo que exige docker, servicios o credenciales).
export const ARCHIVOS_EXCLUIDOS = {
  'infra/ia/aprovisionar-proveedores.test.mjs': 'usa docker (suite test:ia:aprovisionamiento)',
};

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Nombres de script que invoca un texto: `pnpm test:x`, `pnpm -s test:x`, `pnpm run test:x`.
export function scriptsInvocados(texto) {
  const nombres = [];
  const palabras = String(texto).split(/[\s"'&|;()]+/);
  for (let i = 0; i < palabras.length; i += 1) {
    if (palabras[i] !== 'pnpm') continue;
    let j = i + 1;
    while (palabras[j] === '-s' || palabras[j] === 'run') j += 1;
    if (palabras[j]) nombres.push(palabras[j]);
  }
  return nombres;
}

// Conjunto de scripts alcanzables desde los workflows.
export function alcanzables(scripts, textoWorkflows) {
  const vistos = new Set();
  const pendientes = scriptsInvocados(textoWorkflows);
  while (pendientes.length > 0) {
    const nombre = pendientes.pop();
    if (vistos.has(nombre)) continue;
    vistos.add(nombre);
    if (scripts[nombre]) pendientes.push(...scriptsInvocados(scripts[nombre]));
  }
  return vistos;
}

// `*` de un argumento de `node --test` (glob de un nivel de segmento: no cruza `/`).
export function globACoincide(glob, ruta) {
  const partes = glob.split('*');
  if (partes.length === 1) return glob === ruta;
  if (!ruta.startsWith(partes[0])) return false;
  let resto = ruta.slice(partes[0].length);
  for (let i = 1; i < partes.length; i += 1) {
    const ultima = i === partes.length - 1;
    if (ultima) return resto.endsWith(partes[i]) && !resto.slice(0, resto.length - partes[i].length).includes('/');
    const k = resto.indexOf(partes[i]);
    if (k < 0 || resto.slice(0, k).includes('/')) return false;
    resto = resto.slice(k + partes[i].length);
  }
  return false;
}

// ¿Algún script alcanzable corre este archivo de test? Por ruta literal, por glob de `node --test` o, en un paquete de
// workspace (packages/*, workers/*), por `pnpm --filter <nombre|./carpeta|./carpeta/*>`.
export function correArchivo(archivo, textoAlcanzable, nombrePaquete) {
  const palabras = textoAlcanzable.split(/[\s"'&|;()]+/).filter(Boolean);
  if (palabras.some((p) => p === archivo || (p.includes('*') && globACoincide(p, archivo)))) return true;
  const carpeta = archivo.split('/').slice(0, 2).join('/');
  if (carpeta.startsWith('packages/') || carpeta.startsWith('workers/')) {
    return palabras.some((p) => (nombrePaquete && p === nombrePaquete) || p === `./${carpeta}` || p === `./${carpeta.split('/')[0]}/*`);
  }
  return false;
}

export function inventario({ scripts, textoWorkflows, archivosTest, nombresPaquete = {}, textoDocs = '', excluidas = EXCLUIDAS, archivosExcluidos = ARCHIVOS_EXCLUIDOS }) {
  const alcanzados = alcanzables(scripts, textoWorkflows);
  // `--filter` de pnpm también cuenta como «corre»: se evalúa sobre el texto de los scripts alcanzables y de los workflows.
  const textoAlcanzable = [textoWorkflows, ...[...alcanzados].map((n) => scripts[n] ?? '')].join('\n');
  const errores = [];
  const esSuite = (n) => n === 'test' || n.startsWith('test:');
  for (const nombre of Object.keys(scripts).filter(esSuite)) {
    if (nombre === 'test') continue; // agregado manual de todo: no es una suite propia ni lo corre el CI
    if (!alcanzados.has(nombre) && !(nombre in excluidas)) errores.push(`suite «${nombre}»: ningún workflow la corre. Sumarla a test:ci:scripts o test:ci:suites-baratas, o declararla en EXCLUIDAS con el motivo.`);
  }
  for (const nombre of Object.keys(excluidas)) {
    if (!(nombre in scripts)) errores.push(`exclusión «${nombre}»: ya no existe en package.json; quitarla de EXCLUIDAS.`);
    else if (alcanzados.has(nombre)) errores.push(`exclusión «${nombre}»: el CI ya la corre; quitarla de EXCLUIDAS y de docs/control-ci.md.`);
    if (textoDocs && !textoDocs.includes(nombre)) errores.push(`exclusión «${nombre}»: docs/control-ci.md no la nombra («Qué tests corre el CI y cuáles deja fuera»).`);
  }
  for (const archivo of archivosTest) {
    if (archivo in archivosExcluidos) continue;
    if (!correArchivo(archivo, textoAlcanzable, nombresPaquete[archivo.split('/').slice(0, 2).join('/')])) errores.push(`archivo de test «${archivo}»: ningún script que corre el CI lo ejecuta.`);
  }
  return errores;
}

const ES_TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;
const ES_TEST_PY = /\.test\.py$/;

function main() {
  const scripts = JSON.parse(readFileSync(path.join(RAIZ, 'package.json'), 'utf8')).scripts;
  const dirWf = path.join(RAIZ, '.github/workflows');
  const textoWorkflows = readdirSync(dirWf).map((f) => readFileSync(path.join(dirWf, f), 'utf8')).join('\n');
  // Solo archivos versionados, en las áreas que no son la app web (esa corre con su propio vitest shardeado).
  const listado = execFileSync('git', ['ls-files', '-z', 'scripts', 'supabase/functions', 'infra', 'workers', 'packages'], { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const archivosTest = listado.split('\0').filter((f) => f && (ES_TEST.test(f) || ES_TEST_PY.test(f)));
  const nombresPaquete = {};
  for (const f of archivosTest) {
    const carpeta = f.split('/').slice(0, 2).join('/');
    if (!(carpeta in nombresPaquete) && (carpeta.startsWith('packages/') || carpeta.startsWith('workers/'))) {
      try { nombresPaquete[carpeta] = JSON.parse(readFileSync(path.join(RAIZ, carpeta, 'package.json'), 'utf8')).name; } catch { nombresPaquete[carpeta] = undefined; }
    }
  }
  const textoDocs = readFileSync(path.join(RAIZ, 'docs/control-ci.md'), 'utf8');
  const errores = inventario({ scripts, textoWorkflows, archivosTest, nombresPaquete, textoDocs });
  if (errores.length > 0) {
    console.error(`Inventario de suites: ${errores.length} problema(s).`);
    for (const e of errores) console.error(`- ${e}`);
    process.exit(1);
  }
  console.log(`Inventario de suites OK: ${archivosTest.length} archivos de test y ${Object.keys(scripts).filter((n) => n.startsWith('test:')).length} suites, todo corre en el CI o está excluido con motivo.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
