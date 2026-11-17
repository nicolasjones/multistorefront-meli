import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { discoverWorkers } from './descubrir-workers.mjs';

// Dominio permitido: nombre completo o comodín `*.` sobre un dominio con al menos DOS etiquetas
// (`*.proveedor.com` sí; `*.com` o `*` no, abrirían todo un TLD).
const DOMINIO = /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
const RED_CONVENCIONAL = /worker-egress-([a-z0-9][a-z0-9-]*)/gi;
// `--network x`, `--network=x`, `--net x`, `--net=x` (alias de docker) y `network_mode: x` / `networkMode: x`.
const NETWORK_LITERAL = /(?:--net(?:work)?(?:=\s*|\s+)|network_?mode["']?\s*[:=]\s*)["']?([^"'\s,}]+)/gi;
// `none` = sin red (más estricto que cualquier allowlist). Una variable se lee hasta el primer espacio, por eso no se exige el `}`.
function redValida(valor) {
  if (/^worker-egress-[a-z0-9][a-z0-9-]*$/i.test(valor) || /^none$/i.test(valor)) return true;
  if (/^\$[A-Za-z_]\w*$/.test(valor)) return true;
  const exp = /^\$\{[A-Za-z_]\w*(?::?([-=+?])(.*?))?\}?$/.exec(valor);
  if (!exp) return false;
  // `${VAR:-host}`: un valor por defecto literal debe ser una red válida (o ninguno). `:?msg` y `${VAR}` valen.
  return exp[1] === undefined || exp[1] === '?' || exp[2] === '' || /^(?:worker-egress-[a-z0-9][a-z0-9-]*|none|\$[A-Za-z_]\w*)$/i.test(exp[2]);
}

// LÍMITES: este validador comprueba ESTRUCTURA y consistencia (workers, redes de flows y allowlist). NO
// detecta que un worker ya listado agregue un `fetch` a un tercero nuevo: la allowlist real se aplica fuera
// de Docker (firewall/proxy del servidor) y un destino nuevo exige declarar `domains` a mano en la revisión.
// Tampoco cubre `networks:` de un compose ni un `--network` en archivos que no sean YAML de `infra/kestra/flows`
// (scripts, Dockerfiles, otros directorios): solo se leen los `*.yml`/`*.yaml` de ese árbol.

function archivosYaml(directorio) {
  const salida = [];
  if (!fs.existsSync(directorio)) return salida;
  for (const entrada of fs.readdirSync(directorio, { withFileTypes: true })) {
    const ruta = path.join(directorio, entrada.name);
    if (entrada.isDirectory()) salida.push(...archivosYaml(ruta));
    else if (/\.ya?ml$/.test(entrada.name)) salida.push(ruta);
  }
  return salida;
}

// Redes `worker-egress-<sistema>` que nombran los flows de Kestra, con cualquier sintaxis (comillas simples o
// dobles, `WORKER_NETWORK_ESPERADA=…`, `--network=…`, `--network …`) y en subdirectorios. Las plantillas usan
// `worker-egress-$SISTEMA_EXTERNO`, que no coincide con el patrón y se ignora.
export function redesDeFlows(directorio) {
  const redes = new Set();
  for (const archivo of archivosYaml(directorio)) {
    const texto = fs.readFileSync(archivo, 'utf8');
    for (const m of texto.matchAll(RED_CONVENCIONAL)) redes.add(m[1].toLowerCase());
  }
  return redes;
}

// Red fijada con otra sintaxis (`--net`, `network_mode`, `host`, `$(…)`) que no sigue la convención
// `worker-egress-<sistema>`. Se permiten solo las variables `$VAR` / `${VAR…}`. Las continuaciones de línea
// (`\` + salto) se unen antes de leer, así `--network \` + nombre en la línea siguiente también se detecta.
export function redesFueraDeConvencion(directorio) {
  const invalidas = [];
  for (const archivo of archivosYaml(directorio)) {
    const texto = fs.readFileSync(archivo, 'utf8').replace(/\\\r?\n\s*/g, ' ');
    for (const m of texto.matchAll(NETWORK_LITERAL)) {
      if (!redValida(m[1])) invalidas.push(`${archivo}: red ${m[1]}`);
    }
  }
  return invalidas;
}

// Valida la política. `workersDescubiertos` son los ids de `workers/*`; `redesFlows` los sistemas que
// referencian los flows. Cada worker debe figurar en `workers.<sistema>.workers` y cada red de un flow
// debe tener su entrada: así el gate no pasa en vacío (MSF-684). Una entrada sin destinos externos
// declara `solo_supabase: true` (el host de Supabase y Vault ya van en `common`).
export function validarPolitica(policy, workersDescubiertos = [], redesFlows = new Set()) {
  if (
    policy.version !== 1 ||
    !policy.common?.supabase ||
    !policy.common?.vault ||
    !Array.isArray(policy.common?.blocked_examples) ||
    policy.common.blocked_examples.length === 0
  ) {
    throw new Error('La politica de egress debe declarar version, Supabase y Vault.');
  }

  const systems = Object.keys(policy.workers ?? {});
  const cubiertos = new Set();
  for (const system of systems) {
    const entry = policy.workers[system];
    if (!entry?.network || entry.network !== `worker-egress-${system}`) {
      throw new Error(`${system}: red de egress invalida o ausente.`);
    }
    const domains = entry.domains ?? [];
    if (!Array.isArray(domains) || domains.some((domain) => !DOMINIO.test(domain))) {
      throw new Error(`${system}: dominios de egress invalidos o ausentes (sin comodines de TLD como *.com).`);
    }
    if (entry.solo_supabase === true && domains.length > 0) {
      throw new Error(`${system}: solo_supabase=true es incoherente con domains no vacio.`);
    }
    if (domains.length === 0 && entry.solo_supabase !== true) {
      throw new Error(`${system}: dominios de egress invalidos o ausentes.`);
    }
    if (domains.some((domain) => policy.common.blocked_examples.includes(domain))) {
      throw new Error(`${system}: la allowlist contiene un destino denegado.`);
    }
    if (!Array.isArray(entry.workers) || entry.workers.length === 0) {
      throw new Error(`${system}: debe listar los workers que usan la red en "workers".`);
    }
    for (const id of entry.workers) cubiertos.add(id);
  }

  const sinEntrada = workersDescubiertos.filter((id) => !cubiertos.has(id));
  if (sinEntrada.length > 0) {
    throw new Error(`Workers sin allowlist de egress en workers/egress-allowlists.json: ${sinEntrada.join(', ')}.`);
  }
  const inexistentes = [...cubiertos].filter((id) => !workersDescubiertos.includes(id));
  if (inexistentes.length > 0) {
    throw new Error(`La politica de egress nombra workers que no existen: ${inexistentes.join(', ')}.`);
  }
  const redesSinEntrada = [...redesFlows].filter((sistema) => !systems.includes(sistema));
  if (redesSinEntrada.length > 0) {
    throw new Error(`Redes de flows sin allowlist: ${redesSinEntrada.map((s) => `worker-egress-${s}`).join(', ')}.`);
  }
  return systems.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const policy = JSON.parse(fs.readFileSync(path.join('workers', 'egress-allowlists.json'), 'utf8'));
  const workers = discoverWorkers(path.resolve('workers')).map((w) => w.id);
  const dirFlows = path.join('infra', 'kestra', 'flows');
  const fuera = redesFueraDeConvencion(dirFlows);
  if (fuera.length > 0) throw new Error(`Redes de flows fuera de la convencion worker-egress-<sistema>: ${fuera.join('; ')}.`);
  const redes = redesDeFlows(dirFlows);
  const total = validarPolitica(policy, workers, redes);
  process.stdout.write(
    `OK: politica de egress v${policy.version} valida para ${total} red(es) y ${workers.length} worker(s) descubiertos, con destinos permitidos y denegados.\n`,
  );
}
