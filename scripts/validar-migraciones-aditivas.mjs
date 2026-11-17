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
const DESTRUCTIVE = /\bDROP\s+(?:TABLE|COLUMN|SCHEMA|FUNCTION)\b|\bTRUNCATE\b/i;
const DELETE_SIN_WHERE = /\bDELETE\s+FROM\b(?:(?!;)[^])*?(?:;|$)/gi;
// El marcador debe estar en un COMENTARIO (no vale la palabra «reversible» suelta en el SQL ni en un
// identificador): `-- Reversión: ...` o `/* Reversión ... */`.
const MARKER = /(?:--[^\n]*|\/\*[^]*?)revers/i;

function sinComentarios(sql) {
  return sql.replace(/\/\*[^]*?\*\//g, '').replace(/--.*$/gm, '');
}

export function esDestructiva(sql) {
  const ejecutable = sinComentarios(sql);
  if (DESTRUCTIVE.test(ejecutable)) return true;
  return (ejecutable.match(DELETE_SIN_WHERE) ?? []).some((sentencia) => !/\bWHERE\b/i.test(sentencia));
}

export function tieneReversion(sql) {
  return MARKER.test(sql);
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
