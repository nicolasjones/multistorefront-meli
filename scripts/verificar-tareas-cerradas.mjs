#!/usr/bin/env node
// Gate de cierre de tareas (MSF-914): ninguna `tasks.md` puede quedar con una tarea `[ ]` que la
// historia ya cerró.
//
// POR QUÉ EXISTE: la regla del repo ("ninguna tarea `[ ]` queda sin hacer") no era verificable:
// nadie comprobaba el `tasks.md`, así que los specs de épicas entregadas acumulaban cientos de
// tareas abiertas y el manifiesto de cobertura E2E reportaba como no entregada historia ya
// terminada. Este gate es el eslabón que faltaba: el side-car `specs/<slug>/tasks/<HISTORIA>.md`
// es el aviso de que una historia se cerró; este gate exige que el `tasks.md` refleje ese aviso.
//
// REGLAS (por cada tarea `[ ]` de un `tasks.md`):
//   1. Si un side-car la marca `[x]` → FALLA: la proyección quedó desactualizada (corré
//      `pnpm tareas:consolidar`).
//   2. Si la línea tiene una nota `Desvío:` → FALLA: la deuda trazada se cierra como `[x]` (con
//      su nota y el seguimiento), nunca se deja abierta.
//   3. Si la historia que la posee (la etiqueta con side-car homónimo, p. ej. `[F-XXX-NN]`,
//      `[F-1]`, `[US-A]`, `[CIERRE]`, `[MSF-NNN]`) tiene un side-car y esa historia no la marcó
//      → FALLA: la historia se cerró y la tarea quedó atrás.
//   4. En cualquier otro caso → pasa: la historia todavía no se cerró, la tarea está en curso.
//
// Uso:
//   node scripts/verificar-tareas-cerradas.mjs [--specs <dir>]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerTareas, marcasDeSideCars, sideCarsDe } from './consolidar-marcas-tasks.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));

// Código de historia que puede tener un side-car homónimo.
const HISTORIA = /^(?:F-[A-Z0-9]+(?:-\d+)?|CIERRE|MSF-\d+|US-[A-Z0-9]+)$/;
// Etiquetas de historia que menciona la línea de la tarea. Si se conocen los side-car de la spec,
// manda el archivo real: cualquier etiqueta con side-car homónimo es una historia (cubre las
// convenciones en vuelo `[F-1]`, `[US-A]`, `[US-B1]`, `[US-1]`).
export function historiaDe(linea, sideCars = null) {
  const etiquetas = [...linea.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
  if (sideCars) {
    const conSideCar = etiquetas.find((etiqueta) => sideCars.has(etiqueta));
    if (conSideCar) return conSideCar;
  }
  return etiquetas.find((etiqueta) => HISTORIA.test(etiqueta)) ?? null;
}

/**
 * Una tarea está trazada como deuda si su entrada menciona `Desvío:` FUERA de un fragmento de
 * código: dentro de las tareas la palabra aparece citada (p. ej. «cerrar con `Desvío: <motivo>`»)
 * y no es una nota de desvío.
 */
export function tieneDesvio(entrada) {
  return /Desvío:/.test(entrada.replace(/`[^`]*`/g, ''));
}

/**
 * Revisa un spec: devuelve las tareas abiertas que NO deberían estar abiertas.
 * @returns {{slug: string, faltantes: {id: string, motivo: string, accion: string}[], abiertas: number}}
 */
export function revisarSpec(dirSpec) {
  const tasksMd = join(dirSpec, 'tasks.md');
  const slug = basename(dirSpec);
  if (!existsSync(tasksMd)) return { slug, faltantes: [], abiertas: 0 };
  const marcas = marcasDeSideCars(join(dirSpec, 'tasks'));
  const sideCars = new Set(sideCarsDe(join(dirSpec, 'tasks')).map((n) => n.replace(/\.md$/, '')));
  const faltantes = [];
  let abiertas = 0;
  for (const tarea of leerTareas(readFileSync(tasksMd, 'utf8'))) {
    if (tarea.hecha) continue;
    abiertas += 1;
    if (marcas.has(tarea.id)) {
      faltantes.push({
        id: tarea.id,
        motivo: `la historia ya la marcó [x] en \`tasks/${marcas.get(tarea.id)[0]}\`: falta consolidar`,
        accion: 'Corré `pnpm tareas:consolidar` y commiteá el `tasks.md`.',
      });
      continue;
    }
    if (tieneDesvio(tarea.entrada)) {
      faltantes.push({
        id: tarea.id,
        motivo: 'tiene una nota `Desvío:` pero sigue `[ ]`: la deuda trazada se cierra, no se deja abierta',
        accion: 'Cambiá la casilla a `[x]` y citá en el `Desvío:` el seguimiento trazado.',
      });
      continue;
    }
    const historia = historiaDe(tarea.linea, sideCars);
    if (historia && sideCars.has(historia)) {
      faltantes.push({
        id: tarea.id,
        motivo: `la historia ${historia} se cerró (hay \`tasks/${historia}.md\`) y esta tarea quedó sin marcar`,
        accion: `Cerrá la tarea en \`tasks.md\` como \`[x]\` con su evidencia, o \`[x]\` + \`Desvío: <motivo>\` + seguimiento trazado.`,
      });
    }
  }
  return { slug, faltantes, abiertas };
}

/** Revisa todos los specs de `dirSpecs`. */
export function revisarTodo(dirSpecs) {
  const specs = [];
  for (const nombre of readdirSync(dirSpecs).sort()) {
    const dirSpec = join(dirSpecs, nombre);
    if (!existsSync(join(dirSpec, 'tasks.md'))) continue;
    specs.push(revisarSpec(dirSpec));
  }
  return specs;
}

const esEjecucionDirecta = process.argv[1] != null && resolve(process.argv[1]).endsWith('verificar-tareas-cerradas.mjs');
if (esEjecucionDirecta) {
  const args = process.argv.slice(2);
  const indice = args.indexOf('--specs');
  const dirSpecs = indice === -1 ? join(RAIZ, 'specs') : resolve(args[indice + 1]);
  const specs = revisarTodo(dirSpecs);
  const conFaltantes = specs.filter((spec) => spec.faltantes.length > 0);
  const abiertas = specs.reduce((total, spec) => total + spec.abiertas, 0);
  for (const spec of conFaltantes) {
    console.log(`${spec.slug}:`);
    for (const falta of spec.faltantes) console.log(`  - ${falta.id}: ${falta.motivo}\n    → ${falta.accion}`);
  }
  if (conFaltantes.length > 0) {
    console.error(
      `\nFallo de cierre de tareas: ${conFaltantes.reduce((t, s) => t + s.faltantes.length, 0)} tareas de ${conFaltantes.length} specs. Seguí la acción indicada en cada una.`,
    );
    process.exit(1);
  }
  console.log(`Cierre de tareas: OK (${abiertas} tareas abiertas de historias en curso, 0 sin cerrar).`);
}
