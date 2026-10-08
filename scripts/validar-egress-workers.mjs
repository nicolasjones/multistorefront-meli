import fs from 'node:fs';
import path from 'node:path';

const policyPath = path.join('workers', 'egress-allowlists.json');
const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));

if (
  policy.version !== 1 ||
  !policy.common?.supabase ||
  !policy.common?.vault ||
  !Array.isArray(policy.common?.blocked_examples) ||
  policy.common.blocked_examples.length === 0
) {
  throw new Error('La politica de egress debe declarar version, Supabase y Vault.');
}

// No hay una lista fija de sistemas: cada producto derivado declara sus
// propios workers bajo `workers.<nombre>`. Se valida cualquier entrada que
// exista — si todavía no hay ningún worker real, no hay nada que validar.
const systems = Object.keys(policy.workers ?? {});
for (const system of systems) {
  const entry = policy.workers[system];
  if (!entry?.network || entry.network !== `worker-egress-${system}`) {
    throw new Error(`${system}: red de egress invalida o ausente.`);
  }
  if (!Array.isArray(entry.domains) || entry.domains.length === 0 || entry.domains.some((domain) => !/^(\*\.)?[a-z0-9.-]+$/i.test(domain))) {
    throw new Error(`${system}: dominios de egress invalidos o ausentes.`);
  }
  if (entry.domains.some((domain) => policy.common.blocked_examples.includes(domain))) {
    throw new Error(`${system}: la allowlist contiene un destino denegado.`);
  }
}

process.stdout.write(`OK: politica de egress v${policy.version} valida para ${systems.length} worker(s), con destinos permitidos y denegados.\n`);
