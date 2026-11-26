// Parseo de líneas `- item` de front matter y YAML, en tiempo lineal. Reemplaza regex del tipo
// `^\s*-\s*(.+)$`: `\s*` y `.+` se solapan y `.` no casa con U+2028/U+2029, así que ante un ítem con
// cientos de miles de blancos seguidos de un terminador Unicode el motor probaba todas las particiones
// (cuadrático: ~40 s con 200 000 caracteres). Acá se recorre con un índice, una sola vez.
const BLANCO = /\s/;

// Texto que sigue al `-` de una línea de lista (`  - x` -> ' x'), o null si la línea no es un ítem.
export function despuesDeGuion(linea) {
  let i = 0;
  while (i < linea.length && BLANCO.test(linea[i])) i += 1;
  return linea[i] === '-' ? linea.slice(i + 1) : null;
}

// `  - texto` o `-texto` -> 'texto' (sin blancos en los bordes); null si no es ítem o queda vacío.
export function itemDeLista(linea) {
  const resto = despuesDeGuion(linea);
  return resto === null ? null : resto.trim() || null;
}

// Igual que itemDeLista pero exige al menos un blanco después del `-` (`-x` no es ítem).
export function itemDeListaConEspacio(linea) {
  const resto = despuesDeGuion(linea);
  return resto === null || !BLANCO.test(resto[0] ?? '') ? null : resto.trim() || null;
}
