// Regla única de los runners de evidencia (MSF-907).
//
// Los tres consumidores del runner (el manifiesto de cobertura, el ensamblador de videos
// y el reporte de cobertura por épica) leían el texto del ítem cada uno por su cuenta y
// con su propia regla: el ensamblador exigía el código de historia AL PRINCIPIO del texto,
// el reporte por épica no lo calculaba en el working tree y el manifiesto sólo aceptaba un
// formato de encabezado de historia. Un ítem con descripción pobre no fallaba: degradaba en
// silencio (evidencia sin criterios, ítem agrupado por tarea en vez de por historia o
// clasificado como «sólo base de datos», con lo cual nadie escribe el test).
//
// Acá la regla es una sola y lo que no se puede derivar queda explícito, con su motivo:
// hace falta TEXTO (para describir el ítem) y CÓDIGO DE HISTORIA (para unirlo a sus
// escenarios de aceptación).
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
// Línea de tarea: la MISMA regex que usa el gate de cierre de tareas (MSF-914): id en negrita
// (`**T001**`), tareas indentadas y viñeta `*`. Una sola fuente del formato de la línea.
import { TAREA } from './consolidar-marcas-tasks.mjs';

/** Marca de las tareas de cierre de una spec (`[CIERRE]`). */
const MARCA_CIERRE = /\[CIERRE\]/i;
/** Código de historia `F-XXX-NN` (en corchetes, en cualquier posición del texto). */
const CODIGO_HISTORIA = /\[(F-[A-Z0-9]+-\d+)\]/;

/** El texto del ítem sin las etiquetas estructurales (`[P]`, `[F-XXX-NN]`, `[US1]`…). */
export function textoSinEtiquetas(texto) {
  return String(texto ?? '')
    .replace(/\[([^\]]*)\]/g, ' ')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Código de historia del ítem (`''` si no lo tiene). */
export function codigoHistoria(texto) {
  return String(texto ?? '').match(CODIGO_HISTORIA)?.[1] ?? '';
}

/**
 * Por qué la descripción del ítem no alcanza, o `''` si el runner puede derivar de ella
 * los criterios: hace falta texto (para describirlo) y código de historia (para unirlo a
 * sus escenarios de aceptación).
 */
export function motivoDescripcion(texto) {
  if (!textoSinEtiquetas(texto)) return 'sin texto';
  if (!codigoHistoria(texto)) return 'sin historia';
  return '';
}

/**
 * ¿Hay que exigirle descripción a este ítem? No: a los hechos (ya no hay nada que escribir) ni
 * a las tareas de cierre sin código de historia (no tienen escenarios a los que unirse).
 * Misma regla en JS y en Python (el reporte por épica la lee de acá).
 */
export function requiereDescripcion({ hecho, texto, motivo }) {
  if (!motivo || hecho) return false;
  return !(MARCA_CIERRE.test(texto) && !codigoHistoria(texto));
}

/**
 * Ítems de un `tasks.md` con su texto COMPLETO: las líneas indentadas que siguen al
 * ítem son parte de él (notas, desvíos, un enunciado partido en dos) y sin ellas el texto
 * se cortaba en la primera línea.
 */
export function leerItemsDesdeTexto(contenido) {
  const lineas = String(contenido ?? '').split('\n');
  const items = [];
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(TAREA);
    if (!m) continue;
    const partes = [m[7].trim()];
    let j = i + 1;
    while (j < lineas.length) {
      const linea = lineas[j];
      if (!linea.trim()) {
        j++;
        continue;
      }
      if (!/^\s/.test(linea)) break; // sin sangría ya no es del ítem
      if (TAREA.test(linea)) break; // una subtarea sangrada es su propio ítem: no se la traga el padre
      partes.push(linea.trim());
      j++;
    }
    i = j - 1;
    const texto = partes.join(' ').trim();
    items.push({
      id: m[5].toUpperCase(),
      hecho: m[2].toLowerCase() === 'x',
      texto,
      historia: codigoHistoria(texto),
      motivo: motivoDescripcion(texto),
    });
  }
  return items;
}

/** Ítems de un `tasks.md` del disco (misma regla que `leerItemsDesdeTexto`). */
export function leerItems(rutaTasks) {
  if (!existsSync(rutaTasks)) return [];
  return leerItemsDesdeTexto(readFileSync(rutaTasks, 'utf8'));
}

// Modo CLI: imprime los ítems en JSON. Lo usa el reporte de cobertura por épica (Python)
// para no tener su propia copia de la regla.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const desdeStdin = args.includes('--stdin');
  const ruta = args[args.indexOf('--tasks') + 1];
  if (!desdeStdin && !ruta) {
    console.error('Uso: node scripts/historia-item.mjs --tasks <tasks.md> | --stdin');
    process.exit(2);
  }
  const contenido = desdeStdin ? readFileSync(0, 'utf8') : readFileSync(ruta, 'utf8');
  const items = leerItemsDesdeTexto(contenido).map((i) => ({ ...i, requiereDescripcion: requiereDescripcion(i) }));
  console.log(JSON.stringify(items));
}
