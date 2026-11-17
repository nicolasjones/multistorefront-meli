import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { discoverWorkers } from './descubrir-workers.mjs';

const DOMINIO = /^(\*\.)?[a-z0-9.-]+$/i;
const RED_EN_FLOW = /WORKER_NETWORK_ESPERADA="worker-egress-([a-z0-9][a-z0-9-]*)"/g;

// Redes `worker-egress-<sistema>` que declaran los flows de Kestra (las plantillas usan
// `$SISTEMA_EXTERNO`, que no coincide con el patrón y se ignora).
export function redesDeFlows(directorio) {
  const redes = new Set();
  if (!fs.existsSync(directorio)) return redes;
  for (const archivo of fs.readdirSync(directorio)) {
    if (!/\.ya?ml$/.test(archivo)) continue;
    const texto = fs.readFileSync(path.join(directorio, archivo), 'utf8');
    for (const m of texto.matchAll(RED_EN_FLOW)) redes.add(m[1]);
  }
  return redes;
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
      throw new Error(`${system}: dominios de egress invalidos o ausentes.`);
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
  if (workersDescubiertos.length > 0 && inexistentes.length > 0) {
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
  const redes = redesDeFlows(path.join('infra', 'kestra', 'flows'));
  const total = validarPolitica(policy, workers, redes);
  process.stdout.write(
    `OK: politica de egress v${policy.version} valida para ${total} red(es) y ${workers.length} worker(s) descubiertos, con destinos permitidos y denegados.\n`,
  );
}
