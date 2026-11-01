// Detector de DDL sin guard de idempotencia para el guard de migraciones
// (`scripts/verificar-migraciones.mjs`).
//
// Las reglas se evalúan por SENTENCIA completa (hasta `;`), no línea por línea: `alter table t` +
// `add column x` en líneas distintas (MSF-682) o `create index` + `if not exists` en la línea
// siguiente son el mismo problema, y anclar la regla al inicio de línea los dejaba pasar.
//
// Antes de leer el SQL se enmascaran los comentarios (`--`, `/* */`), los literales ('...',
// E'...'), los identificadores entre comillas dobles ("...") y los cuerpos dollar-quoted
// (`$$...$$`, `$tag$...$tag$`): el texto enmascarado NO se ejecuta como SQL (es el cuerpo de
// una plantilla de SQL dinámico) y no debe marcar la migración.
//
// El enmascarado conserva la longitud y los saltos de línea del original, así los offsets
// siguen dando el número de línea real del hallazgo.

const enBlanco = (texto) => texto.replace(/[^\n]/g, ' ');

// Fin de un literal '...' que arranca en la comilla `inicio`. Devuelve su largo (comillas
// incluidas) o lo que resta del texto si el literal no cierra.
const largoLiteral = (sql, inicio, conBarras) => {
  let j = inicio + 1;
  while (j < sql.length) {
    const c = sql[j];
    if (conBarras && c === '\\') {
      j += 2;
      continue;
    }
    if (c === "'") {
      if (sql[j + 1] === "'") {
        j += 2;
        continue;
      }
      return j + 1 - inicio;
    }
    j += 1;
  }
  return sql.length - inicio;
};

// Fin de un identificador "..." que arranca en la comilla `inicio`.
const largoIdentificador = (sql, inicio) => {
  let j = inicio + 1;
  while (j < sql.length) {
    if (sql[j] === '"') {
      if (sql[j + 1] === '"') {
        j += 2;
        continue;
      }
      return j + 1 - inicio;
    }
    j += 1;
  }
  return sql.length - inicio;
};

// Reemplaza por espacios todo lo que no es SQL ejecutable, conservando la longitud.
export const enmascarar = (sql) => {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const resto = sql.slice(i);
    let largo = 0;
    let m;
    if ((m = /^\/\*[\s\S]*?(\*\/|$)/.exec(resto))) {
      largo = m[0].length;
    } else if ((m = /^--[^\n]*/.exec(resto))) {
      largo = m[0].length;
    } else if ((m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(resto))) {
      const etiqueta = m[0];
      const cierre = resto.indexOf(etiqueta, etiqueta.length);
      largo = cierre === -1 ? resto.length : cierre + etiqueta.length;
    } else if ((m = /^[eE]'/.exec(resto))) {
      largo = 1 + largoLiteral(sql, i + 1, true);
    } else if ((m = /^'/.exec(resto))) {
      largo = largoLiteral(sql, i, false);
    } else if ((m = /^"/.exec(resto))) {
      largo = largoIdentificador(sql, i);
    }
    if (largo > 0) {
      out += enBlanco(resto.slice(0, largo));
      i += largo;
    } else {
      out += sql[i];
      i += 1;
    }
  }
  return out;
};

// Parte el SQL (ya enmascarado) en sentencias terminadas por `;`.
const partirEnmascarado = (limpio) => {
  const sentencias = [];
  let inicio = 0;
  for (let i = 0; i < limpio.length; i += 1) {
    if (limpio[i] === ';') {
      sentencias.push({ texto: limpio.slice(inicio, i), inicio });
      inicio = i + 1;
    }
  }
  if (inicio < limpio.length) sentencias.push({ texto: limpio.slice(inicio), inicio });
  return sentencias;
};

// Parte el SQL en sentencias (texto enmascarado + desplazamiento en el original).
export const partirSentencias = (sql) => partirEnmascarado(enmascarar(sql));

const conGuard = (t, patron) => patron.test(t);
const buscar = (t, patron) => {
  const m = patron.exec(t);
  return m ? [m.index] : [];
};

// Reglas del guard. Cada una mira la SENTENCIA completa y devuelve los desplazamientos (dentro
// de la sentencia) donde empieza el problema.
const REGLAS = [
  {
    id: 'add-column',
    severidad: 'problema',
    mensaje: 'ADD COLUMN sin IF NOT EXISTS (una aplicación parcial traba el reintento)',
    offsets: (t) => {
      if (!/\balter\s+table\b/i.test(t)) return [];
      return [...t.matchAll(/\badd\s+column\b(?!\s+if\s+not\s+exists\b)/gi)].map((m) => m.index);
    },
  },
  {
    id: 'drop-function',
    severidad: 'problema',
    mensaje: 'DROP FUNCTION sin IF EXISTS',
    offsets: (t) => (conGuard(t, /\bdrop\s+function\b/i) && !conGuard(t, /\bdrop\s+function\s+if\s+exists\b/i)
      ? buscar(t, /\bdrop\s+function\b/i)
      : []),
  },
  {
    id: 'create-index',
    severidad: 'problema',
    mensaje: 'CREATE INDEX sin IF NOT EXISTS',
    offsets: (t) => (conGuard(t, /\bcreate\s+(?:unique\s+)?index\b/i)
      && !conGuard(t, /\bcreate\s+(?:unique\s+)?index\s+if\s+not\s+exists\b/i)
      ? buscar(t, /\bcreate\s+(?:unique\s+)?index\b/i)
      : []),
  },
  {
    id: 'drop',
    severidad: 'aviso',
    mensaje: 'DROP sin IF EXISTS (revisá si puede reintentarse)',
    offsets: (t) => (conGuard(t, /\bdrop\s+(?:concurrently\s+)?(?:table|view|index|trigger)\b/i)
      && !conGuard(t, /\bdrop\s+(?:concurrently\s+)?(?:table|view|index|trigger)\s+if\s+exists\b/i)
      ? buscar(t, /\bdrop\s+(?:concurrently\s+)?(?:table|view|index|trigger)\b/i)
      : []),
  },
  {
    id: 'create-table',
    severidad: 'aviso',
    mensaje: 'CREATE TABLE sin IF NOT EXISTS',
    offsets: (t) => (conGuard(t, /\bcreate\s+table\b/i) && !conGuard(t, /\bcreate\s+table\s+if\s+not\s+exists\b/i)
      ? buscar(t, /\bcreate\s+table\b/i)
      : []),
  },
];

// Devuelve [{ regla, severidad, linea, mensaje }] por cada regla violada.
export const revisarDdl = (sql) => {
  const limpio = enmascarar(sql);
  const hallazgos = [];
  for (const sentencia of partirEnmascarado(limpio)) {
    for (const regla of REGLAS) {
      for (const offset of regla.offsets(sentencia.texto)) {
        const absoluto = sentencia.inicio + offset;
        hallazgos.push({
          regla: regla.id,
          severidad: regla.severidad,
          linea: limpio.slice(0, absoluto).split('\n').length,
          mensaje: regla.mensaje,
        });
      }
    }
  }
  return hallazgos;
};

// Atajo para la regla ADD COLUMN: [{ linea }] por cada `add column` sin `if not exists`
// dentro de un `alter table`.
export const detectarAddColumnSinGuard = (sql) => revisarDdl(sql)
  .filter((h) => h.regla === 'add-column')
  .map((h) => ({ linea: h.linea }));
