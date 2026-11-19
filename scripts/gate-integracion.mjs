#!/usr/bin/env node
// Estado real del gate de integración de una rama base (`dokploy`).
//
// El gate de este repo NO es «branch protection»: es un RULESET. El endpoint
// `GET /repos/{repo}/branches/<rama>/protection` devuelve 404 «Branch not
// protected» aunque el ruleset esté activo (probado el 2026-11-18). Apoyarse en
// ese 404 lleva a la conclusión equivocada —«no hay protección, se puede
// mergear aunque la rama no esté al día»— y al ciclo infinito: el merge falla
// con «head branch is not up to date», se resincroniza la rama, el CI vuelve a
// arrancar y, si la base avanza más rápido que el CI, la rama vuelve a quedar
// atrás. Este script lee el gate por la API de rulesets.
//
// Uso: node scripts/gate-integracion.mjs [--base <rama>] [--pr <n>] [--json]
//   --base <rama>  rama base cuyo gate se informa (por defecto: `dokploy`).
//   --pr <n>       compara la rama del PR con la base y da el veredicto.
//   --json         imprime el informe en JSON.
// El repo sale de `--repo` o de `GITHUB_REPOSITORY` (por defecto, el del repo).
//
// Sólo lectura: no modifica el ruleset ni hace merge. La configuración de la
// protección (activar la cola de merge) es acción de Nicolás.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_POR_DEFECTO = 'nicolasjones/multistorefront-meli';
const RAMA_POR_DEFECTO = 'dokploy';

// Gh devuelve el cuerpo del error en stdout y sale con código 1, así que el
// estado HTTP sale del propio JSON (`status`), no del código de salida.
function gh(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { ok: false, http: 0, data: null, error: r.error.message };
  let data = null;
  try {
    data = r.stdout ? JSON.parse(r.stdout) : null;
  } catch {
    data = null;
  }
  // El cuerpo del error trae el estado HTTP como texto (`"status":"404"`).
  const httpDelCuerpo = Number(data?.status);
  const http = Number.isFinite(httpDelCuerpo) && httpDelCuerpo > 0 ? httpDelCuerpo : r.status ?? 0;
  return { ok: r.status === 0, http, data, error: (r.stderr || '').trim() };
}

// Un ruleset aplica a la rama si la incluye por nombre completo. Sin
// `include`, aplica a todas las ramas menos las excluidas.
export function aplicaA(ruleset, rama) {
  if (!ruleset || ruleset.target !== 'branch') return false;
  const ref = ruleset.conditions?.ref_name;
  if (!ref) return true;
  const completo = `refs/heads/${rama}`;
  if (Array.isArray(ref.exclude) && ref.exclude.includes(completo)) return false;
  if (!Array.isArray(ref.include) || ref.include.length === 0) return true;
  return ref.include.includes(completo);
}

// Gate efectivo de una rama: las reglas activas que la cubren, unidas.
export function gateDe(rulesets, rama) {
  const reglas = [];
  for (const ruleset of rulesets || []) {
    if (ruleset.enforcement !== 'active') continue;
    if (!aplicaA(ruleset, rama)) continue;
    let ramaAlDia = false;
    let colaDeMerge = false;
    const checks = [];
    for (const regla of ruleset.rules || []) {
      if (regla.type === 'required_status_checks') {
        if (regla.parameters?.strict_required_status_checks_policy === true) ramaAlDia = true;
        for (const check of regla.parameters?.required_status_checks || []) {
          if (check?.context) checks.push(check.context);
        }
      }
      if (regla.type === 'merge_queue') colaDeMerge = true;
    }
    reglas.push({
      id: ruleset.id,
      nombre: ruleset.name,
      enforcement: ruleset.enforcement,
      ramaAlDia,
      colaDeMerge,
      checks,
      bypass: (ruleset.bypass_actors || []).map((actor) => `${actor.actor_type} ${actor.actor_id} (bypass_mode: ${actor.bypass_mode})`),
    });
  }
  return {
    rama,
    reglas,
    hayGate: reglas.length > 0,
    ramaAlDia: reglas.some((r) => r.ramaAlDia),
    colaDeMerge: reglas.some((r) => r.colaDeMerge),
    checks: [...new Set(reglas.flatMap((r) => r.checks))],
    bypass: [...new Set(reglas.flatMap((r) => r.bypass))],
  };
}

// Informe del gate y veredicto para una rama.
//
//   estado: 'sin-gate'     — no hay ni ruleset activo ni protección clásica.
//           'no-bloqueado' — el gate no exige «rama al día»: el merge no se
//                             rechaza por desfasaje.
//           'bloqueado'    — el gate exige «rama al día» y la rama está atrás:
//                             el merge va a fallar con «head branch is not up
//                             to date».
export function informe({ gate, atras = null, proteccionClasica404 = false }) {
  const lineas = [];
  lineas.push(`Gate de integración de «${gate.rama}»`);

  if (!gate.hayGate) {
    lineas.push('  No hay ruleset activo para esa rama.');
    if (proteccionClasica404) {
      lineas.push('  Aviso: /branches/<rama>/protection devuelve 404 ("Branch not protected") y ese endpoint ES la protección clásica: acá no hay gate que consultar.');
    }
    lineas.push('  Veredicto: no hay checks ni «rama al día» que exijan: el merge no se rechaza por desfasaje.');
    return { estado: 'sin-gate', lineas };
  }

  for (const regla of gate.reglas) {
    lineas.push(`  Regla: ${regla.nombre} (ruleset ${regla.id}, enforcement: ${regla.enforcement})`);
  }
  lineas.push(`  Checks requeridos: ${gate.checks.length ? gate.checks.join(', ') : 'ninguno'}`);
  lineas.push(`  Rama al día: ${gate.ramaAlDia ? 'SÍ exigida (strict_required_status_checks_policy: true)' : 'NO exigida (strict_required_status_checks_policy: false)'}`);
  lineas.push(`  Cola de merge: ${gate.colaDeMerge ? 'sí (regla merge_queue activa)' : 'no (sin regla merge_queue)'}`);
  if (gate.bypass.length) lineas.push(`  Bypass: ${gate.bypass.join(', ')}`);

  // La trampa: el endpoint de protección clásica miente cuando el gate es un ruleset.
  if (proteccionClasica404) {
    lineas.push(`  Aviso: /branches/${gate.rama}/protection devuelve 404 ("Branch not protected"): ese endpoint es la protección clásica y NO ve los rulesets.`);
    lineas.push(`  El gate real es el ruleset «${gate.reglas[0].nombre}» (id ${gate.reglas[0].id}): no concluyas que se puede mergear sin su check requerido.`);
  }

  if (atras === null) return { estado: 'no-bloqueado', lineas };

  if (gate.ramaAlDia && atras > 0) {
    lineas.push(`  La rama está ${atras} commit(s) atrás de «${gate.rama}».`);
    lineas.push('  Veredicto: BLOQUEADO — el gate exige «rama al día», así que «gh pr merge» va a fallar con "head branch is not up to date".');
    lineas.push('  Actualizar la rama reinicia el CI y, si la base sigue avanzando más rápido que el CI, el ciclo no termina. Salidas:');
    lineas.push('    (1) desactivar «rama al día» en el ruleset (strict_required_status_checks_policy: false);');
    lineas.push('    (2) activar la cola de merge (regla merge_queue) — decisión de Nicolás: cambia la semántica de protección de la base.');
    return { estado: 'bloqueado', lineas };
  }

  lineas.push(atras > 0 ? `  La rama está ${atras} commit(s) atrás de «${gate.rama}».` : '  La rama está al día con la base.');
  if (gate.ramaAlDia) {
    lineas.push('  Veredicto: el gate exige «rama al día»: si la base avanza antes de que termine el CI, el merge va a fallar con "head branch is not up to date".');
  } else {
    lineas.push('  Veredicto: el merge NO se rechaza por desfasaje: no actualices la rama, esperá el check requerido en verde y mergeá.');
  }
  return { estado: 'no-bloqueado', lineas };
}

// Lee el gate desde la API: rulesets (lista + detalle) y, sólo para detectar la
// trampa, la protección clásica de la misma rama.
function leerGate({ repo = REPO_POR_DEFECTO, rama = RAMA_POR_DEFECTO } = {}) {
  const lista = gh(['api', `repos/${repo}/rulesets`]);
  if (!lista.ok || !Array.isArray(lista.data)) {
    throw new Error(`No se pudieron leer los rulesets de ${repo}: ${lista.error || `HTTP ${lista.http}`}.`);
  }
  const detallados = [];
  for (const item of lista.data) {
    const detalle = gh(['api', `repos/${repo}/rulesets/${item.id}`]);
    if (detalle.ok && detalle.data) detallados.push(detalle.data);
  }
  const proteccion = gh(['api', `repos/${repo}/branches/${rama}/protection`]);
  return {
    gate: gateDe(detallados, rama),
    proteccionClasica404: proteccion.http === 404,
  };
}

// Commits que la rama head tiene de menos contra la base (0 si no está atrás).
function atrasDe({ repo = REPO_POR_DEFECTO, base, head }) {
  const comparacion = gh(['api', `repos/${repo}/compare/${base}...${head}`]);
  if (!comparacion.ok || !comparacion.data) {
    throw new Error(`No se pudo comparar ${base}...${head}: ${comparacion.error || `HTTP ${comparacion.http}`}.`);
  }
  return comparacion.data.behind_by ?? 0;
}

function main() {
  const args = process.argv.slice(2);
  const valorDe = (flag, def) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
  };
  const repo = valorDe('--repo', process.env.GITHUB_REPOSITORY || REPO_POR_DEFECTO);
  const base = valorDe('--base', process.env.GITHUB_BASE_REF || RAMA_POR_DEFECTO);
  const pr = valorDe('--pr', null);

  let head = null;
  if (pr) {
    const vista = gh(['pr', 'view', pr, '--repo', repo, '--json', 'headRefName']);
    if (!vista.ok || !vista.data?.headRefName) {
      console.error(`No se pudo leer el PR ${pr}: ${vista.error || 'sin datos'}.`);
      return 2;
    }
    head = vista.data.headRefName;
  }

  let gate;
  let proteccionClasica404 = false;
  try {
    ({ gate, proteccionClasica404 } = leerGate({ repo, rama: base }));
  } catch (error) {
    console.error(error.message);
    return 2;
  }

  let atras = null;
  if (head) {
    try {
      atras = atrasDe({ repo, base, head });
    } catch (error) {
      console.error(error.message);
      return 2;
    }
  }

  const { estado, lineas } = informe({ gate, atras, proteccionClasica404 });
  if (args.includes('--json')) {
    console.log(JSON.stringify({ repo, base, head, atras, estado, gate, proteccionClasica404, lineas }, null, 2));
  } else {
    for (const linea of lineas) console.log(linea);
  }
  return estado === 'bloqueado' ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`Estado del gate de integración: ${error.message}`);
    process.exitCode = 2;
  }
}
