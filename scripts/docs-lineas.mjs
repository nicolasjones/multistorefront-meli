// Parseo de líneas `- item` de front matter y YAML, en tiempo lineal. Reemplaza regex del tipo
// `^\s*-\s*(.+)$`: `\s*` y `.+` se solapan y `.` no casa con U+2028/U+2029, así que ante un ítem con
// cientos de miles de blancos seguidos de un terminador Unicode el motor probaba todas las particiones
// (cuadrático: ~40 s con 200 000 caracteres). Acá se recorre con un índice, una sola vez.
const BLANCO = /\s/;

// `clave: valor` -> { clave, valor } (valor sin blancos en los bordes); null si no es una línea clave.
// Reemplaza `^([a-zA-Z_]+):\s*(.*)$` (cuadrática: `\s*` y `.*` se solapan y `.` no casa con terminadores Unicode).
export function claveYValor(linea) {
  let i = 0;
  while (i < linea.length && /[a-zA-Z_]/.test(linea[i])) i += 1;
  return i > 0 && linea[i] === ':' ? { clave: linea.slice(0, i), valor: linea.slice(i + 1).trim() } : null;
}

// Quita un comentario `# ...` final: empieza en el primer blanco que precede a un `#`.
// Reemplaza `/\s#.*$/` (cuadrática con ` #` repetido y un terminador Unicode en el medio).
export function sinComentario(valor) {
  for (let i = 0; i + 1 < valor.length; i += 1) if (valor[i + 1] === '#' && BLANCO.test(valor[i])) return valor.slice(0, i);
  return valor;
}

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
