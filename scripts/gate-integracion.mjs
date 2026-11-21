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
// Uso: node scripts/gate-integracion.mjs [--repo <owner/nombre>] [--base <rama>] [--pr <n>] [--json]
//   --repo <owner/nombre>  repo donde se lee el gate (por defecto: `GITHUB_REPOSITORY` o el del repo).
//   --base <rama>  rama base cuyo gate se informa (por defecto: `dokploy`, la rama de integración).
//   --pr <n>       compara la rama del PR con la base y da el veredicto.
//   --json         imprime el informe en JSON.
//
// La base por defecto es SIEMPRE `dokploy`: `GITHUB_BASE_REF` no se usa a
// propósito, porque en un job de CI de un PR a `main` apuntaría al gate de
// `main` (que no tiene ruleset) en vez del de integración.
//
// Sólo lectura: no modifica el ruleset ni hace merge. La configuración de la
// protección (activar la cola de merge) es acción de Nicolás.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_POR_DEFECTO = 'nicolasjones/multistorefront-meli';
const RAMA_POR_DEFECTO = 'dokploy';
// Un `gh` colgado (red lenta, prompt de login) no puede dejar el script
// esperando para siempre.
const TIMEOUT_MS = 60 * 1000;

// Gh sale con 1 y el cuerpo del error en stdout cuando la API falla; ese
// cuerpo trae el estado HTTP como texto (`"status":"404"`). Salida 0 = 200.
export function estadoDeGh(codigo, cuerpo) {
  if (codigo === 0) return { ok: true, http: 200 };
  const httpDelCuerpo = Number(cuerpo?.status);
  return { ok: false, http: Number.isFinite(httpDelCuerpo) && httpDelCuerpo > 0 ? httpDelCuerpo : 0 };
}

// Gh devuelve el cuerpo del error en stdout y sale con código 1, así que el
// estado HTTP sale del propio JSON (`status`), no del código de salida.
function gh(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: TIMEOUT_MS, killSignal: 'SIGTERM' });
  if (r.error) return { ok: false, http: 0, data: null, error: `${r.error.message}${r.signal ? ` (terminado por ${r.signal})` : ''}` };
  let data = null;
  try {
    data = r.stdout ? JSON.parse(r.stdout) : null;
  } catch {
    data = null;
  }
  const { ok, http } = estadoDeGh(r.status, data);
  return { ok, http, data, error: (r.stderr || '').trim() };
}

// fnmatch de GitHub para los patrones de `conditions.ref_name`: la API de
// rulesets usa `File.fnmatch` de Ruby con `File::FNM_PATHNAME`, así que `*` no
// cruza `/`, `?` matchea un carácter (que nunca es `/`), `[]` es un juego de
// caracteres (que tampoco matchea `/`), `**/` matchea cero o más niveles de
// directorio y un `**` que NO va seguido de `/` equivale a `*`. Un patrón que
// no se puede interpretar falla en voz alta: ignorar el ruleset daría un «no
// hay gate» falso.
function regexDePatron(patron) {
  let fuente = '';
  for (let i = 0; i < patron.length; i += 1) {
    const c = patron[i];
    if (c === '*' && patron[i + 1] === '*' && patron[i + 2] === '/') {
      // `**/`: cero o más niveles de directorio.
      fuente += '(?:[^/]*/)*';
      i += 2;
      continue;
    }
    if (c === '*') {
      fuente += '[^/]*';
      continue;
    }
    if (c === '?') {
      fuente += '[^/]';
      continue;
    }
    if (c === '[') {
      let j = i + 1;
      let negado = false;
      if (patron[j] === '!' || patron[j] === '^') {
        negado = true;
        j += 1;
      }
      let contenido = '';
      if (patron[j] === ']') {
        contenido += '\\]';
        j += 1;
      }
      while (j < patron.length && patron[j] !== ']') {
        if (patron[j] === '\\') {
          if (j + 1 >= patron.length) throw new Error(`Patrón inválido «${patron}»: escape sin carácter.`);
          contenido += `\\${patron[j + 1]}`;
          j += 2;
        } else {
          contenido += patron[j] === '[' ? '\\[' : patron[j];
          j += 1;
        }
      }
      if (j >= patron.length) throw new Error(`Patrón inválido «${patron}»: falta cerrar «]».`);
      // El lookahead es el `ISEND` de Ruby: con `FNM_PATHNAME` un comodín
      // (ni siquiera una clase de caracteres) matchea una `/`.
      fuente += `(?!/)[${negado ? '^' : ''}${contenido}]`;
      i = j;
      continue;
    }
    fuente += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${fuente}$`);
}

// Un patrón del ruleset se prueba contra el ref completo (`refs/heads/<rama>`)
// y contra el nombre de la rama: GitHub acepta las dos formas y un include
// exacto no cubre los rulesets que apuntan por patrón.
function coincidePatron(patron, rama, ramaPorDefecto = null) {
  if (patron === '~ALL') return true;
  if (patron === '~DEFAULT_BRANCH') {
    if (!ramaPorDefecto) throw new Error(`El ruleset usa «~DEFAULT_BRANCH» y no se pudo resolver la rama por defecto de «${rama}».`);
    return rama === ramaPorDefecto;
  }
  const re = regexDePatron(patron);
  return re.test(`refs/heads/${rama}`) || re.test(rama);
}

// Un ruleset aplica a la rama si la incluye por patrón. Sin `include`, aplica a
// todas las ramas menos las excluidas.
export function aplicaA(ruleset, rama, ramaPorDefecto = null) {
  if (!ruleset || ruleset.target !== 'branch') return false;
  const ref = ruleset.conditions?.ref_name;
  if (!ref) return true;
  if (Array.isArray(ref.exclude) && ref.exclude.some((patron) => coincidePatron(patron, rama, ramaPorDefecto))) return false;
  if (!Array.isArray(ref.include) || ref.include.length === 0) return true;
  return ref.include.some((patron) => coincidePatron(patron, rama, ramaPorDefecto));
}

// Gate efectivo de una rama: las reglas activas que la cubren, unidas.
export function gateDe(rulesets, rama, ramaPorDefecto = null) {
  const reglas = [];
  for (const ruleset of rulesets || []) {
    if (ruleset.enforcement !== 'active') continue;
    if (!aplicaA(ruleset, rama, ramaPorDefecto)) continue;
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
      tipo: 'ruleset',
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

// La protección clásica (branch protection) también es un gate: según GitHub,
// las reglas de protección y los rulesets se acumulan y todos los gates
// aplicables se exigen. Un 200 en `/branches/<rama>/protection` NO es «sin
// protección».
function reglaDeProteccionClasica(proteccion) {
  const checks = proteccion?.required_status_checks
    ? [
        ...(proteccion.required_status_checks.contexts || []),
        ...(proteccion.required_status_checks.checks || []).map((check) => check.context).filter(Boolean),
      ]
    : [];
  return {
    id: 'proteccion-clasica',
    nombre: 'protección clásica de la rama',
    tipo: 'clasica',
    enforcement: 'active',
    ramaAlDia: proteccion?.required_status_checks?.strict === true,
    colaDeMerge: false,
    checks,
    bypass: [],
  };
}

// Gate efectivo con la protección clásica sumada a los rulesets.
function agregaProteccionClasica(gate, proteccion) {
  if (!proteccion) return gate;
  const regla = reglaDeProteccionClasica(proteccion);
  return {
    ...gate,
    reglas: [...gate.reglas, regla],
    hayGate: true,
    ramaAlDia: gate.ramaAlDia || regla.ramaAlDia,
    checks: [...new Set([...gate.checks, ...regla.checks])],
  };
}

// Gate efectivo a partir de las respuestas crudas de la API. Es pura (sin
// red): recibe la lista de rulesets, el detalle de cada uno y la respuesta de
// la protección clásica.
//
// Falla ruidosamente si un detalle no se pudo leer: descartar ese ruleset en
// silencio convertiría el informe en un «no hay gate» falso, que es el peor
// resultado posible (el diagnóstico se usaría para decir «no hay protección»).
export function gateDesdeRespuestas({ lista, detalles, proteccionClasica, rama, ramaPorDefecto = null }) {
  const fallidos = [];
  const payloads = [];
  for (const item of lista || []) {
    const detalle = detalles?.get?.(item.id);
    if (!detalle || !detalle.ok || !detalle.data) {
      fallidos.push(`${item.name ?? item.id} (${detalle ? `HTTP ${detalle.http}` : 'sin detalle'})`);
      continue;
    }
    payloads.push(detalle.data);
  }
  if (fallidos.length) {
    throw new Error(`No se pudo leer el detalle de ${fallidos.length} ruleset(s): ${fallidos.join(', ')}. Sin ese dato no se puede afirmar que no hay gate.`);
  }

  const http = proteccionClasica?.http ?? 0;
  if (http !== 200 && http !== 404) {
    throw new Error(`No se pudo leer la protección clásica de «${rama}» (HTTP ${http}): sin ese dato no se puede afirmar que no hay gate.`);
  }
  if (http === 200 && !proteccionClasica.data) {
    throw new Error(`La protección clásica de «${rama}» respondió 200 sin cuerpo: sin ese dato no se puede afirmar que no hay gate.`);
  }

  const gate = agregaProteccionClasica(gateDe(payloads, rama, ramaPorDefecto), http === 200 ? proteccionClasica.data : null);
  return { gate, proteccionClasica404: http === 404 };
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
    lineas.push('  No hay ruleset activo ni protección clásica para esa rama.');
    if (proteccionClasica404) {
      lineas.push('  Aviso: /branches/<rama>/protection devuelve 404 ("Branch not protected") y ese endpoint ES la protección clásica: acá no hay gate que consultar.');
    }
    lineas.push('  Veredicto: no hay checks ni «rama al día» que exijan: el merge no se rechaza por desfasaje.');
    return { estado: 'sin-gate', lineas };
  }

  for (const regla of gate.reglas) {
    const origen = regla.tipo === 'clasica' ? 'branch protection, no es un ruleset' : `ruleset ${regla.id}, enforcement: ${regla.enforcement}`;
    lineas.push(`  Regla: ${regla.nombre} (${origen})`);
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

  if (atras === null) {
    if (gate.ramaAlDia) {
      lineas.push('  Veredicto: el gate exige «rama al día»: si la rama del PR está atrás, «gh pr merge» falla con "head branch is not up to date" y actualizar la rama reinicia el CI (el ciclo no termina si la base avanza más rápido que el CI).');
      lineas.push('    Para saber si esa rama está atrás: pnpm ci:gate -- --pr <n>.');
    } else {
      lineas.push('  Veredicto: el merge NO se rechaza por desfasaje: no actualices la rama, esperá el check requerido en verde y mergeá.');
    }
    return { estado: 'no-bloqueado', lineas };
  }

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

// Lee el gate desde la API: rulesets (lista + detalle), la protección clásica
// de la misma rama y, sólo si algún ruleset lo pide, la rama por defecto del
// repo (para el token `~DEFAULT_BRANCH`).
function leerGate({ repo = REPO_POR_DEFECTO, rama = RAMA_POR_DEFECTO } = {}) {
  const lista = gh(['api', `repos/${repo}/rulesets`]);
  if (!lista.ok || !Array.isArray(lista.data)) {
    throw new Error(`No se pudieron leer los rulesets de ${repo}: ${lista.error || `HTTP ${lista.http}`}.`);
  }
  const detalles = new Map();
  for (const item of lista.data) {
    detalles.set(item.id, gh(['api', `repos/${repo}/rulesets/${item.id}`]));
  }
  const proteccion = gh(['api', `repos/${repo}/branches/${rama}/protection`]);
  const ramaPorDefecto = ramaPorDefectoDe({ repo, detalles });
  return gateDesdeRespuestas({
    lista: lista.data,
    detalles,
    proteccionClasica: { http: proteccion.http, data: proteccion.data },
    rama,
    ramaPorDefecto,
  });
}

// El token `~DEFAULT_BRANCH` puede estar en `include` o en `exclude`; en los
// dos casos hace falta resolver la rama por defecto antes de evaluar.
export function necesitaRamaPorDefecto(detalles) {
  return [...(detalles?.values?.() || [])].some((detalle) => {
    const ref = detalle?.data?.conditions?.ref_name;
    return [...(ref?.include || []), ...(ref?.exclude || [])].includes('~DEFAULT_BRANCH');
  });
}

// La rama por defecto del repo, sólo si algún ruleset usa `~DEFAULT_BRANCH`.
function ramaPorDefectoDe({ repo, detalles }) {
  if (!necesitaRamaPorDefecto(detalles)) return null;
  const r = gh(['repo', 'view', repo, '--json', 'defaultBranchRef']);
  const nombre = r.data?.defaultBranchRef?.name;
  if (!r.ok || !nombre) {
    throw new Error(`No se pudo leer la rama por defecto de ${repo}: ${r.error || `HTTP ${r.http}`}.`);
  }
  return nombre;
}

// Commits que la rama head tiene de menos contra la base (0 si no está atrás).
function atrasDe({ repo = REPO_POR_DEFECTO, base, head }) {
  const comparacion = gh(['api', `repos/${repo}/compare/${base}...${head}`]);
  if (!comparacion.ok || !comparacion.data) {
    throw new Error(`No se pudo comparar ${base}...${head}: ${comparacion.error || `HTTP ${comparacion.http}`}.`);
  }
  return comparacion.data.behind_by ?? 0;
}

// `--repo` y `--base` se interpolan en la ruta de la API: se validan para que
// no puedan apuntar la consulta a otra ruta.
const REPO_VALIDO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const RAMA_VALIDA = /^[A-Za-z0-9._/-]+$/;

export function esRepoValido(repo) {
  return typeof repo === 'string' && REPO_VALIDO.test(repo);
}

export function esRamaValida(rama) {
  return (
    typeof rama === 'string' &&
    rama.length > 0 &&
    RAMA_VALIDA.test(rama) &&
    !rama.includes('..') &&
    !rama.startsWith('/') &&
    !rama.endsWith('/') &&
    !rama.startsWith('-')
  );
}

function main() {
  const args = process.argv.slice(2);
  const valorDe = (flag, def) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
  };
  const repo = valorDe('--repo', process.env.GITHUB_REPOSITORY || REPO_POR_DEFECTO);
  const base = valorDe('--base', RAMA_POR_DEFECTO);
  const pr = valorDe('--pr', null);

  if (!esRepoValido(repo)) {
    console.error(`--repo inválido: «${repo}». Se espera owner/nombre.`);
    return 2;
  }
  if (!esRamaValida(base)) {
    console.error(`--base inválido: «${base}». Se espera un nombre de rama.`);
    return 2;
  }

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
