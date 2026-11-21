#!/usr/bin/env node
// Consolida en el `tasks.md` de cada spec las marcas `[x]` que ya viven en los side-car
// `specs/<slug>/tasks/<HISTORIA>.md` (MSF-914).
//
// POR QUÉ EXISTE: el orquestador escribe las marcas de una historia en su side-car (por diseño no
// edita el `tasks.md`, que es la spec compartida entre historias). Nadie volcaba esas marcas al
// `tasks.md`, así que los specs de épicas ya entregadas quedaron con cientos de tareas `[ ]`: el
// archivo que leen los consumidores (manifiesto de cobertura E2E, cobertura de épicas) decía "no
// entregado" para trabajo ya revisado y entregado.
//
// QUÉ HACE: vuelca al `tasks.md` SOLO las tareas ya marcadas `[x]` en algún side-car. No inventa
// marcas, nunca vuelve `[x]` a `[ ]`, deja intacto el texto de la línea y es idempotente. Las
// tareas sin respaldo (historias que todavía no se cerraron) quedan `[ ]`: son trabajo en curso, no
// deuda consolidable, y el gate `pnpm tareas:check` las distingue de las que sí quedaron atrás.
//
// Uso:
//   node scripts/consolidar-marcas-tasks.mjs [--specs <dir>] [--dry-run]
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));

// Una línea de tarea: `- [ ] T001 [P] [F-X-01][US1] texto`.
export const TAREA = /^(\s*[-*]\s*\[)([ xX])(\]\s*)(T\d+)(.*)$/;
// Marca de provenance que deja el volcado (permite auditar de dónde salió cada `[x]`).
export const EVIDENCIA = /Evidencia: marca de cierre en `tasks\/[^`]+`\./;

/**
 * Tareas de un `tasks.md` o de un side-car: id, marca, línea original y entrada completa.
 * La entrada incluye las líneas de continuación (sangradas) de la tarea: la nota de desvío a
 * veces queda en la línea siguiente y no en la de la tarea.
 */
export function leerTareas(contenido) {
  const lineas = contenido.split('\n');
  const tareas = [];
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(TAREA);
    if (!m) continue;
    let fin = i;
    while (fin + 1 < lineas.length && /^[ \t]/.test(lineas[fin + 1]) && !lineas[fin + 1].match(TAREA)) fin += 1;
    tareas.push({
      id: m[4].toUpperCase(),
      hecha: m[2].toLowerCase() === 'x',
      linea: lineas[i],
      entrada: lineas.slice(i, fin + 1).join('\n'),
    });
    i = fin;
  }
  return tareas;
}

/**
 * Marcas de cierre por id de tarea, con el side-car que las aportó.
 * @returns {Map<string, string[]>} id -> nombres de archivo (ordenados).
 */
export function marcasDeSideCars(dirTasks) {
  const marcas = new Map();
  if (!existsSync(dirTasks)) return marcas;
  for (const nombre of readdirSync(dirTasks).sort()) {
    if (!nombre.endsWith('.md')) continue;
    for (const tarea of leerTareas(readFileSync(join(dirTasks, nombre), 'utf8'))) {
      if (!tarea.hecha) continue;
      if (!marcas.has(tarea.id)) marcas.set(tarea.id, []);
      marcas.get(tarea.id).push(nombre);
    }
  }
  return marcas;
}

/**
 * Vuelca al contenido del `tasks.md` las marcas respaldadas por un side-car.
 * @returns {{contenido: string, cerradas: {id: string, origen: string}[], sinRespaldo: string[]}}
 */
export function consolidarContenido(contenido, marcas) {
  const lineas = contenido.split('\n');
  const cerradas = [];
  const sinRespaldo = [];
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(TAREA);
    if (!m) continue;
    const [, pre, marca, sep, id, resto] = m;
    if (marca.toLowerCase() === 'x') continue; // ya cerrada: nunca se toca
    const origen = marcas.get(id.toUpperCase());
    if (!origen) {
      sinRespaldo.push(id.toUpperCase());
      continue;
    }
    const linea = `${pre}x${sep}${id}${resto}`;
    lineas[i] = EVIDENCIA.test(linea) ? linea : `${linea} Evidencia: marca de cierre en \`tasks/${origen[0]}\`.`;
    cerradas.push({ id: id.toUpperCase(), origen: `tasks/${origen[0]}` });
  }
  return { contenido: lineas.join('\n'), cerradas, sinRespaldo };
}

/** Consolida un spec. `escribir=false` deja el archivo intacto (dry-run). */
export function consolidarSpec(dirSpec, { escribir = true } = {}) {
  const tasksMd = join(dirSpec, 'tasks.md');
  if (!existsSync(tasksMd)) return null;
  const marcas = marcasDeSideCars(join(dirSpec, 'tasks'));
  const original = readFileSync(tasksMd, 'utf8');
  const { contenido, cerradas, sinRespaldo } = consolidarContenido(original, marcas);
  if (escribir && contenido !== original) writeFileSync(tasksMd, contenido);
  return { slug: basename(dirSpec), cerradas, sinRespaldo, cambio: contenido !== original };
}

/** Consolida todos los specs de `dirSpecs`. */
export function consolidarTodo(dirSpecs, { escribir = true } = {}) {
  const specs = [];
  for (const nombre of readdirSync(dirSpecs).sort()) {
    const dirSpec = join(dirSpecs, nombre);
    if (!existsSync(join(dirSpec, 'tasks.md'))) continue;
    const resultado = consolidarSpec(dirSpec, { escribir });
    if (resultado) specs.push(resultado);
  }
  return specs;
}

const esEjecucionDirecta = process.argv[1] != null && resolve(process.argv[1]).endsWith('consolidar-marcas-tasks.mjs');
if (esEjecucionDirecta) {
  const args = process.argv.slice(2);
  const indice = args.indexOf('--specs');
  const dirSpecs = indice === -1 ? join(RAIZ, 'specs') : resolve(args[indice + 1]);
  const dryRun = args.includes('--dry-run');
  const specs = consolidarTodo(dirSpecs, { escribir: !dryRun });
  let cerradas = 0;
  let pendientes = 0;
  for (const spec of specs) {
    if (spec.cerradas.length === 0 && spec.sinRespaldo.length === 0) continue;
    cerradas += spec.cerradas.length;
    pendientes += spec.sinRespaldo.length;
    console.log(
      `${spec.slug}: ${spec.cerradas.length} cerradas${spec.sinRespaldo.length ? ` · ${spec.sinRespaldo.length} sin respaldo (${spec.sinRespaldo.join(', ')})` : ''}`,
    );
  }
  console.log(
    `\n${dryRun ? 'Consolidación (simulada)' : 'Consolidación'}: ${cerradas} tareas cerradas en ${specs.filter((s) => s.cerradas.length > 0).length} specs · ${pendientes} sin respaldo (historias abiertas).`,
  );
}
