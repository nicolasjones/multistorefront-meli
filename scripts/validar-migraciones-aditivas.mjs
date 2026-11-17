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
// COLUMN; `UPDATE` sin `WHERE`; `REVOKE`. El camino de reversión se acepta si algún comentario tiene una
// línea que nombra la «reversión» (la palabra completa, no «reversible») y no está negada («sin reversión»,
// «no hay reversión»); las 750 migraciones históricas usan formatos muy distintos («Camino de reversión»,
// «Reversión (en migración posterior)», …), por eso no se exige que la línea EMPIECE con «Reversión:».
// No se valida que haya pasos ni que sean correctos.
const DESTRUCTIVE = /\bDROP\s+(?:TABLE|COLUMN|SCHEMA|FUNCTION)\b|\bTRUNCATE\b/i;
const DELETE_SIN_WHERE = /\bDELETE\s+FROM\b[^;]*(?:;|$)/gi;
const MARKER_LINEA = /\brevers(?:ión|ion)(?![\p{L}\d_])/iu;
const MARKER_NEGADO = /\b(?:sin|no\s+hay|ninguna?)\s+(?:camino\s+de\s+)?revers/iu;

// Tokenizador mínimo: separa el SQL ejecutable de los comentarios (`--` y `/* */`) respetando los
// literales '...' (con '' como escape) y los identificadores "...": un `--` dentro de un literal no
// es un comentario. Los literales quedan vacíos en `ejecutable`.
export function separar(sql) {
  let ejecutable = '';
  const comentarios = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const dos = sql.slice(i, i + 2);
    if (dos === '--') {
      const fin = sql.indexOf('\n', i);
      const hasta = fin === -1 ? sql.length : fin;
      comentarios.push(sql.slice(i, hasta));
      i = hasta;
    } else if (dos === '/*') {
      const fin = sql.indexOf('*/', i + 2);
      const hasta = fin === -1 ? sql.length : fin + 2;
      comentarios.push(...sql.slice(i, hasta).split('\n'));
      ejecutable += ' ';
      i = hasta;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === c) {
          if (sql[j + 1] === c) { j += 2; continue; }
          break;
        }
        j += 1;
      }
      ejecutable += `${c}${c}`;
      i = j + 1;
    } else {
      ejecutable += c;
      i += 1;
    }
  }
  return { ejecutable, comentarios };
}

export function esDestructiva(sql) {
  const { ejecutable } = separar(sql);
  if (DESTRUCTIVE.test(ejecutable)) return true;
  return (ejecutable.match(DELETE_SIN_WHERE) ?? []).some((sentencia) => !/\bWHERE\b/i.test(sentencia));
}

export function tieneReversion(sql) {
  return separar(sql).comentarios.some((linea) => MARKER_LINEA.test(linea) && !MARKER_NEGADO.test(linea));
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
