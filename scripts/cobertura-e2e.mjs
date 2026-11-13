// Manifiesto de cobertura E2E por historia (spec 022).
//
// Cruza tres fuentes y emite un JSON:
//   1. reporte JSON de Playwright (`--reporter=json`): títulos con `[EPICA:TASK,...]` y/o con
//      criterios de aceptación `[F-XXX-NN#1-5,8]` (escenarios numerados de la historia en spec.md)
//   2. `specs/*/tasks.md` de las épicas citadas (resueltas por `**Jira Epic**:` en spec.md)
//   3. videos `.webm` en `test-results/` (attachments del reporte)
//
// Uso:
//   node scripts/cobertura-e2e.mjs --report <playwright.json> --results <test-results>
//     --specs <specs> --out <cobertura-e2e.json> --run-id <id> --modo <on|retain>
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { argumentValue } from './operaciones.mjs';

const ETIQUETA = /\[([A-Z]+-\d+)\s*:\s*([\w,\s]+)\]/g;
// Criterios de aceptación: `[F-STK-02#1-5,8]` = escenarios 1 a 5 y 8 de la historia F-STK-02 del spec.
const ETIQUETA_CRITERIOS = /\[(F-[A-Z]+-\d+)\s*#\s*([\d,\s-]+)\]/g;
const ITEM_TAREA = /^-\s*\[(x| )\]\s*(T\d+)\b\s*(.*)$/i;
const JIRA_EPIC = /\*\*Jira Epic\*\*:\s*([A-Z]+-\d+)/;
const COMPONENTE = /\*\*Componente\*\*:\s*(.+)/;
const SIN_COMPONENTE = 'Sin clasificar';

export function extraerEtiquetas(titulo) {
  const etiquetas = [];
  for (const m of titulo.matchAll(ETIQUETA)) {
    const items = m[2].split(',').map((s) => s.trim()).filter(Boolean);
    if (items.length > 0) etiquetas.push({ epica: m[1], items });
  }
  return etiquetas;
}

/** `1-3,5` → [1,2,3,5]. */
export function expandirRangos(texto) {
  const ns = new Set();
  for (const parte of texto.split(',').map((x) => x.trim()).filter(Boolean)) {
    const [a, b] = parte.split('-').map(Number);
    if (Number.isNaN(a)) continue;
    for (let n = a; n <= (Number.isNaN(b) || b === undefined ? a : b); n++) ns.add(n);
  }
  return [...ns].sort((x, y) => x - y);
}

export function extraerCriterios(titulo) {
  return [...titulo.matchAll(ETIQUETA_CRITERIOS)].map((m) => ({ historia: m[1], numeros: expandirRangos(m[2]) }));
}

/** Escenarios de aceptación por historia de un spec.md: Map<'F-STK-02', [{n, texto}]>. */
export function leerCriterios(rutaSpec) {
  const mapa = new Map();
  if (!existsSync(rutaSpec)) return mapa;
  let actual = null;
  for (const linea of readFileSync(rutaSpec, 'utf8').split('\n')) {
    const h = linea.match(/^###\s+User Story\s+\d+\s*-\s*(.*?)\s*\((F-[A-Z]+-\d+)\b/);
    if (h) {
      actual = h[2];
      mapa.set(actual, Object.assign([], { titulo: h[1] }));
      continue;
    }
    if (/^##\s/.test(linea) || /^###\s/.test(linea)) actual = null;
    const e = actual && linea.match(/^(\d+)\.\s+(.*)$/);
    if (e) mapa.get(actual).push({ n: Number(e[1]), texto: e[2].replace(/\*\*/g, '').trim() });
  }
  return mapa;
}

function recorrerSuites(suites, padres, acc) {
  for (const suite of suites ?? []) {
    const titulos = [...padres, suite.title ?? ''].filter(Boolean);
    for (const spec of suite.specs ?? []) {
      const titulo = [...titulos, spec.title ?? ''].filter(Boolean).join(' ');
      for (const test of spec.tests ?? []) {
        const tituloTest = `${titulo} ${test.title ?? ''}`.trim();
        acc.push({ titulo: tituloTest, archivo: spec.file ?? '', resultados: test.results ?? [] });
      }
    }
    recorrerSuites(suite.suites, titulos, acc);
  }
  return acc;
}

export function leerReporte(rutaReporte) {
  const datos = JSON.parse(readFileSync(rutaReporte, 'utf8'));
  return recorrerSuites(datos.suites, [], []);
}

function videoDe(resultados, dirResults) {
  for (const r of resultados) {
    const adjunto = (r.attachments ?? []).find(
      (a) => a.contentType === 'video/webm' || a.name === 'video',
    );
    if (adjunto?.path) {
      const abs = resolve(adjunto.path);
      const base = resolve(dirResults);
      return abs.startsWith(base) ? relative(base, abs) : adjunto.path;
    }
  }
  return null;
}

export function mapaEpicaSpec(dirSpecs) {
  const mapa = new Map();
  for (const entrada of readdirSync(dirSpecs, { withFileTypes: true })) {
    if (!entrada.isDirectory()) continue;
    const dir = join(dirSpecs, entrada.name);
    const specMd = join(dir, 'spec.md');
    if (!existsSync(specMd)) continue;
    const contenido = readFileSync(specMd, 'utf8');
    const m = contenido.match(JIRA_EPIC);
    if (!m) continue;
    const titulo = (contenido.match(/^#\s+(.+)$/m)?.[1] ?? entrada.name).replace(/^Feature Specification:\s*/i, '').trim();
    const componente = (contenido.match(COMPONENTE)?.[1] ?? SIN_COMPONENTE).trim();
    // Nombre legible: la línea trae «<clave> — <épica> · <historia> (spec …)».
    // Para la tarjeta sirve la historia (lo último tras «·»), no el código.
    const completa = (contenido.match(/^\*\*Jira Epic\*\*:\s*(.+)$/m)?.[1] ?? '')
      .replace(/\s*\(spec[^)]*\)\s*$/, '')
      .trim();
    const nombre = (completa.split(' · ').pop() || '').replace(/^[A-Z]+-\d+\s*[—–-]\s*/, '').trim() || m[1];
    if (!mapa.has(m[1])) mapa.set(m[1], { nombre, specs: [] });
    mapa.get(m[1]).specs.push({ dir, titulo, componente });
  }
  return mapa;
}

export function leerItems(rutaTasks) {
  if (!existsSync(rutaTasks)) return [];
  return readFileSync(rutaTasks, 'utf8')
    .split('\n')
    .map((linea) => linea.match(ITEM_TAREA))
    .filter(Boolean)
    .map((m) => ({ id: m[2].toUpperCase(), hecho: m[1].toLowerCase() === 'x', texto: m[3].trim() }));
}

export function generarManifiesto({ reporte, dirResults, dirSpecs, runId, modo }) {
  const tests = leerReporte(reporte);
  const epicas = mapaEpicaSpec(dirSpecs);
  const evidencias = [];
  const huerfanos = [];
  const citados = new Map(); // `${epica}:${item}` -> spec dir

  const criteriosPorSpec = new Map(); // spec dir -> Map<historia, [{n, texto}]>
  const criteriosDe = (dir) => {
    if (!criteriosPorSpec.has(dir)) criteriosPorSpec.set(dir, leerCriterios(join(dir, 'spec.md')));
    return criteriosPorSpec.get(dir);
  };
  const citadosCriterios = new Set(); // `${spec}|${historia}#${n}`

  for (const t of tests) {
    const etiquetas = extraerEtiquetas(t.titulo);
    const porCriterios = extraerCriterios(t.titulo);
    if (etiquetas.length === 0 && porCriterios.length === 0) {
      huerfanos.push({ test: t.titulo, motivo: 'sin etiqueta [EPICA:TASK] ni criterios [F-XXX-NN#n]' });
      continue;
    }
    const resultados = t.resultados;
    // Un test SIN resultados (nunca se ejecutó: omitido/skipped en el reporte) NO es 'pasado': se
    // marcaba como 'pasado' y después el ensamblador pedía un video que nunca existió (fallaba todo).
    const estado = resultados.length === 0
      ? 'omitido'
      : resultados.every((r) => r.status === 'skipped')
        ? 'omitido'
        : resultados.some((r) => r.status !== 'passed' && r.status !== 'skipped')
          ? 'fallido'
          : 'pasado';
    for (const { historia, numeros } of porCriterios) {
      let ubicada = null;
      for (const [epica, entrada] of epicas) {
        const spec = entrada.specs.find((sp) => criteriosDe(sp.dir).has(historia));
        if (spec) ubicada = { epica, entrada, spec };
        if (ubicada) break;
      }
      if (!ubicada) {
        huerfanos.push({ test: t.titulo, motivo: `historia ${historia} inexistente en los specs` });
        continue;
      }
      const todos = criteriosDe(ubicada.spec.dir).get(historia);
      const criterios = numeros.map((n) => todos.find((c) => c.n === n)).filter(Boolean);
      for (const n of numeros) if (!todos.some((c) => c.n === n)) huerfanos.push({ test: t.titulo, motivo: `escenario ${n} inexistente en ${historia}` });
      for (const c of criterios) citadosCriterios.add(`${ubicada.spec.dir}|${historia}#${c.n}`);
      if (criterios.length === 0) continue;
      evidencias.push({
        epica: ubicada.epica,
        epicaNombre: ubicada.entrada.nombre,
        componente: ubicada.spec.componente,
        spec: ubicada.spec.dir,
        specTitulo: ubicada.spec.titulo,
        historia,
        historiaTitulo: todos.titulo,
        criterios,
        items: [],
        test: t.titulo,
        archivo: t.archivo,
        estado,
        video: videoDe(t.resultados, dirResults),
      });
    }
    for (const { epica, items } of etiquetas) {
      const entrada = epicas.get(epica);
      const specs = entrada?.specs ?? [];
      if (specs.length === 0) {
        huerfanos.push({ test: t.titulo, motivo: `épica desconocida ${epica}` });
        continue;
      }
      const resueltos = [];
      for (const item of items) {
        const clave = item.toUpperCase();
        let hallado = null;
        for (const spec of specs) {
          const tasks = leerItems(join(spec.dir, 'tasks.md'));
          const coincidencia = tasks.find((x) => x.id === clave);
          if (coincidencia) {
            if (hallado) hallado.ambiguo = true;
            else hallado = { ...coincidencia, spec: spec.dir, specTitulo: spec.titulo, componente: spec.componente };
          }
        }
        if (hallado) {
          resueltos.push(hallado);
          citados.set(`${epica}:${clave}`, hallado.spec);
        } else {
          huerfanos.push({ test: t.titulo, motivo: `ítem ${clave} inexistente en ${epica}` });
        }
      }
      if (resueltos.length > 0) {
        evidencias.push({
          epica,
          epicaNombre: entrada.nombre,
          componente: resueltos[0].componente,
          spec: resueltos[0].spec,
          specTitulo: resueltos[0].specTitulo,
          items: resueltos.map(({ id, hecho, texto, ambiguo }) => ({ id, hecho, texto, ambiguo: !!ambiguo })),
          test: t.titulo,
          archivo: t.archivo,
          estado,
          video: videoDe(t.resultados, dirResults),
        });
      }
    }
  }

  // Ítems nunca citados por ningún test (por spec involucrada; la clave incluye
  // la épica para no confundir Txxx repetidos entre specs de épicas distintas).
  const specsInvolucradas = new Set([...citados.values()]);
  const tituloDe = new Map();
  const epicaDe = new Map();
  const componenteDe = new Map();
  for (const [epica, { specs }] of epicas) {
    for (const s of specs) {
      tituloDe.set(s.dir, s.titulo);
      componenteDe.set(s.dir, s.componente);
      if (!epicaDe.has(s.dir)) epicaDe.set(s.dir, epica);
    }
  }
  const sinCubrir = [];
  for (const spec of specsInvolucradas) {
    for (const item of leerItems(join(spec, 'tasks.md'))) {
      const citado = citados.has(`${epicaDe.get(spec)}:${item.id}`);
      if (!citado) sinCubrir.push({ spec, specTitulo: tituloDe.get(spec) ?? spec, componente: componenteDe.get(spec) ?? 'Sin clasificar', ...item });
    }
  }

  // Escenarios de aceptación de las historias tocadas por algún test y que ningún test cita.
  const historiasTocadas = new Set(evidencias.filter((e) => e.historia).map((e) => `${e.spec}|${e.historia}`));
  const criteriosSinCubrir = [];
  for (const clave of historiasTocadas) {
    const [dir, historia] = clave.split('|');
    for (const c of criteriosDe(dir).get(historia) ?? []) {
      if (!citadosCriterios.has(`${dir}|${historia}#${c.n}`)) criteriosSinCubrir.push({ spec: dir, historia, ...c });
    }
  }

  return { run_id: runId, fecha: new Date().toISOString(), modo, evidencias, huerfanos, sin_cubrir: sinCubrir, criterios_sin_cubrir: criteriosSinCubrir };
}

const esEjecucionDirecta = process.argv[1] != null && resolve(process.argv[1]).endsWith('cobertura-e2e.mjs');
if (esEjecucionDirecta) {
  const args = process.argv.slice(2);
  const reporte = argumentValue(args, '--report');
  const dirResults = argumentValue(args, '--results');
  const dirSpecs = argumentValue(args, '--specs');
  const salida = argumentValue(args, '--out');
  const runId = argumentValue(args, '--run-id', `local-${Date.now()}`);
  const modo = argumentValue(args, '--modo', 'retain');
  if (!reporte || !dirResults || !dirSpecs || !salida) {
    throw new Error('Uso: node scripts/cobertura-e2e.mjs --report <playwright.json> --results <test-results> --specs <specs> --out <cobertura.json> [--run-id <id>] [--modo <on|retain>]');
  }
  if (!existsSync(reporte)) {
    // El paso de CI corre con if: always(): si el E2E no llegó a correr, no hay manifiesto.
    console.log(`sin reporte ${reporte}: se omite el manifiesto de cobertura.`);
    process.exit(0);
  }
  const manifiesto = generarManifiesto({ reporte, dirResults, dirSpecs, runId, modo });
  mkdirSync(dirname(resolve(salida)), { recursive: true });
  writeFileSync(salida, `${JSON.stringify(manifiesto, null, 2)}\n`);
  console.log(`evidencias: ${manifiesto.evidencias.length}, huérfanos: ${manifiesto.huerfanos.length}, sin cubrir: ${manifiesto.sin_cubrir.length} -> ${salida}`);
}
