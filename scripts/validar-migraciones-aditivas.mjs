import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { argumentValue } from './operaciones.mjs';

// FR-012 (spec 20261003-105444-cicd-staging-produccion): rechaza antes de
// producción cualquier migración destructiva de datos (DROP TABLE, DROP
// COLUMN, TRUNCATE) que no documente su camino de reversión. Sigue la
// convención ya vigente en supabase/migrations/ (ver p. ej.
// 20260914150000_orquestacion_multi_organizacion.sql): un comentario de
// encabezado con la palabra "Reversión" seguido de los pasos para
// deshacerla — no un marcador nuevo inventado por este script. Las
// instrucciones de reversión viven típicamente como DROP comentados
// (`--   drop table ...;`), por eso el chequeo de "es destructiva" ignora
// las líneas de comentario: solo mira SQL que realmente se ejecutaría.
//
// Deliberadamente NO flaguea `ALTER TABLE ... DROP CONSTRAINT/DEFAULT/NOT
// NULL` — redefinir un constraint o default es un patrón común y seguro
// (no destruye filas ni columnas); encontrado como falso positivo real al
// correr esto contra 20261003183000_esperando_aprobacion_ia.sql, que solo
// recrea un check constraint.

const args = process.argv.slice(2);
const dir = argumentValue(args, '--dir', 'supabase/migrations');

// MSF-688: además de DROP TABLE/COLUMN y TRUNCATE se detectan DROP SCHEMA, DROP FUNCTION y
// DELETE FROM sin WHERE (borrado masivo). Sigue sin flaguearse DROP CONSTRAINT (ver arriba).
//
// LÍMITES (a propósito, es un gate barato y no un parser de SQL). NO detecta: SQL dinámico con `execute`;
// `DROP TYPE/VIEW/POLICY/INDEX/TRIGGER/ROLE/EXTENSION/OWNED`; `ALTER TABLE t DROP c` sin la palabra
// COLUMN; `UPDATE` sin `WHERE`; `REVOKE`; tampoco modela `standard_conforming_strings = off` (con ese ajuste `'\\'`
// escapa la comilla en literales comunes y el tokenizador los leería mal); un `$tag$` mal cerrado se lee como texto común; un cuerpo `$$…$$` que
// es solo texto (no SQL) con la palabra `drop table` cuenta como destructivo (falso positivo, conservador). El camino de reversión se acepta si algún comentario tiene una
// línea que nombra la «reversión» (la palabra completa, no «reversible») y no está negada («sin reversión»,
// «no hay reversión»; el filtro es CONSERVADOR: `-- Reversión: no hay reversión automática` también se rechaza
// aunque declare un camino manual, hay que reescribirlo, p. ej. `-- Reversión: restaurar desde el backup`); un valor vacío
// o «ninguna» / «n/a» / «no aplica» tras `Reversión:` tampoco vale; las 750 migraciones históricas usan formatos muy distintos («Camino de reversión»,
// «Reversión (en migración posterior)», …), por eso no se exige que la línea EMPIECE con «Reversión:».
// No se valida que haya pasos ni que sean correctos.
const DESTRUCTIVE = /\bDROP\s+(?:TABLE|COLUMN|SCHEMA|FUNCTION)\b|\bTRUNCATE\b/i;
const DELETE_SIN_WHERE = /\bDELETE\s+FROM\b[^;]*(?:;|$)/gi;
const MARKER_LINEA = /\brevers(?:ión|ion)(?![\p{L}\d_])/iu;
const MARKER_NEGADO = /\b(?:sin|no\s+hay|ninguna?)\s+(?:camino\s+de\s+)?revers/iu;
// `-- Reversión: ninguna` / `n/a` / `no aplica` / vacío declaran que NO hay reversión: no cuentan.
const MARKER_VACIO = /\brevers(?:ión|ion)\s*:\s*(?:ninguna?|none|nothing|nil|n\.?\/?a\.?|no\s+aplica|no\s+hay|nada|-+|\.+|tbd|todo)\s*\.?\s*$/iu;
// `Reversión:` sin nada más en la línea es válido solo si la línea de comentario siguiente trae contenido (los pasos).
const SOLO_MARCADOR = /\brevers(?:ión|ion)\s*:?\s*$/iu;
const limpiar = (linea) => linea.replace(/^\s*(?:--+|\/\*+|\*+)\s*/, '').replace(/\*\/\s*$/, '').trim();

// Tokenizador mínimo: separa el SQL ejecutable de los comentarios respetando:
//  - `--` hasta fin de línea y `/* */` ANIDADOS (Postgres los anida; el `drop` dentro de un comentario no cuenta);
//  - literales '...' (con '' como escape) y E'...' (con \' y \\ como escapes) e identificadores "...";
//  - dollar-quoting `$tag$ … $tag$`: el cuerpo se tokeniza recursivamente como SQL (un `DO $$ … drop table … $$`
//    o el cuerpo de una función SÍ ejecuta DDL), de modo que un apóstrofe o un `--` dentro de `$$…$$` no
//    esconde ni inventa comentarios del resto del archivo.
// Los literales quedan vacíos en `ejecutable`.
function esCaracterDeIdentificador(c) {
  return c !== undefined && /[A-Za-z0-9_$\u0080-\uffff]/.test(c);
}

// Tag de dollar-quote: `$$` o `$tag$` con letras Unicode (como Postgres: `$é$`), dígitos y `_` (sin dígito inicial).
const TAG_DOLLAR = /\$(?:[\p{L}_][\p{L}\p{N}_]*)?\$/uy;
const TAGS_GLOBAL = /(?=(\$(?:[\p{L}_][\p{L}\p{N}_]*)?\$))/gu;

// Posiciones de cada `$tag$` del texto COMPLETO, calculadas UNA sola vez (lineal) y compartidas por toda la
// recursión: recalcularlas por nivel era cuadrático con entrada hostil (`'$a$ $b$ '.repeat(n)`).
function indexarTags(sql) {
  const mapa = new Map();
  for (const m of sql.matchAll(TAGS_GLOBAL)) {
    const lista = mapa.get(m[1]);
    if (lista) lista.push(m.index); else mapa.set(m[1], [m.index]);
  }
  return mapa;
}

// Primera posición >= `desde` donde aparece `tag` (búsqueda binaria), o -1.
function siguienteTag(mapa, tag, desde) {
  const lista = mapa.get(tag) ?? [];
  let lo = 0;
  let hi = lista.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lista[mid] < desde) lo = mid + 1; else hi = mid;
  }
  return lo < lista.length ? lista[lo] : -1;
}

// Profundidad máxima de dollar-quotes anidados que se analizan como SQL; más allá el interior se trata como
// código plano (conservador: sus `drop` cuentan) para no agotar la pila con entrada hostil.
const PROFUNDIDAD_MAXIMA = 100;

export function separar(sql) {
  const salida = { ejecutable: [], comentarios: [] };
  recorrer(sql, 0, sql.length, indexarTags(sql), salida, 0);
  return { ejecutable: salida.ejecutable.join(''), comentarios: salida.comentarios };
}

// Tokeniza `sql[desde, hasta)`; los offsets son del texto completo, así el índice de tags se comparte.
function recorrer(sql, desde, hasta, mapa, salida, profundidad) {
  const { ejecutable, comentarios } = salida;
  let i = desde;
  while (i < hasta) {
    const c = sql[i];
    const dos = sql.slice(i, i + 2);
    if (dos === '--') {
      const fin = sql.indexOf('\n', i);
      const h = fin === -1 || fin > hasta ? hasta : fin;
      comentarios.push(sql.slice(i, h));
      i = h;
    } else if (dos === '/*') {
      let nivel = 1;
      let j = i + 2;
      while (j < hasta && nivel > 0) {
        if (sql.startsWith('/*', j)) { nivel += 1; j += 2; }
        else if (sql.startsWith('*/', j)) { nivel -= 1; j += 2; }
        else j += 1;
      }
      j = Math.min(j, hasta);
      for (const linea of sql.slice(i, j).split('\n')) comentarios.push(linea);
      ejecutable.push(' ');
      i = j;
    } else if (c === "'" || c === '"') {
      const conEscapes = c === "'" && /^[eE]$/.test(sql[i - 1] ?? '') && !esCaracterDeIdentificador(sql[i - 2]);
      let j = i + 1;
      while (j < hasta) {
        if (conEscapes && sql[j] === '\\') { j += 2; continue; }
        if (sql[j] === c) {
          if (sql[j + 1] === c) { j += 2; continue; }
          break;
        }
        j += 1;
      }
      ejecutable.push(`${c}${c}`);
      i = j + 1;
    } else if (c === '$' && !esCaracterDeIdentificador(sql[i - 1])) {
      TAG_DOLLAR.lastIndex = i;
      const abre = TAG_DOLLAR.exec(sql);
      const cierre = abre && i + abre[0].length <= hasta ? siguienteTag(mapa, abre[0], i + abre[0].length) : -1;
      if (abre && cierre !== -1 && cierre + abre[0].length <= hasta) {
        const ini = i + abre[0].length;
        ejecutable.push(' ');
        if (profundidad >= PROFUNDIDAD_MAXIMA) ejecutable.push(sql.slice(ini, cierre));
        else recorrer(sql, ini, cierre, mapa, salida, profundidad + 1);
        ejecutable.push(' ');
        i = cierre + abre[0].length;
      } else {
        ejecutable.push(c);
        i += 1;
      }
    } else {
      ejecutable.push(c);
      i += 1;
    }
  }
}

export function esDestructiva(sql) {
  const { ejecutable } = separar(sql);
  if (DESTRUCTIVE.test(ejecutable)) return true;
  return (ejecutable.match(DELETE_SIN_WHERE) ?? []).some((sentencia) => !/\bWHERE\b/i.test(sentencia));
}

export function tieneReversion(sql) {
  const { comentarios } = separar(sql);
  return comentarios.some((linea, indice) => {
    if (!MARKER_LINEA.test(linea) || MARKER_NEGADO.test(linea)) return false;
    const texto = limpiar(linea);
    if (MARKER_VACIO.test(texto)) return false;
    if (SOLO_MARCADOR.test(texto)) return limpiar(comentarios[indice + 1] ?? '') !== '';
    return true;
  });
}

const files = (await readdir(dir)).filter((file) => file.endsWith('.sql'));
const sinReversion = [];
for (const file of files) {
  const content = await readFile(path.join(dir, file), 'utf8');
  if (esDestructiva(content) && !tieneReversion(content)) sinReversion.push(file);
}

if (sinReversion.length > 0) {
  throw new Error(`Migraciones destructivas sin camino de reversión documentado (agregar un comentario con "Reversión" y los pasos para deshacerla, en el propio archivo): ${sinReversion.join(', ')}`);
}
console.log(`${files.length} migraciones verificadas en ${dir}: ninguna destructiva sin camino de reversión documentado.`);
