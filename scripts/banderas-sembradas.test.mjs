// Las banderas de plataforma NACEN APAGADAS: ninguna migración puede sembrarlas ni encenderlas. Los pgTAP no pueden comprobarlo
// (una base viva como dev tiene banderas encendidas a propósito y los tests fijan el estado que necesitan), así que se lee el SQL.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const DIR = 'supabase/migrations';
const sinComentarios = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
const migraciones = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort().map((f) => ({ f, sql: sinComentarios(readFileSync(`${DIR}/${f}`, 'utf8')) }));

// Filas ('clave', activa, ...) de cada `insert into public.banderas_plataforma (...) values ...`.
export function filasSembradas(sql) {
  const filas = [];
  for (const m of sql.matchAll(/insert\s+into\s+(?:public\.)?banderas_plataforma\s*\([^)]*\)\s*values([\s\S]*?)(?:on\s+conflict|;)/gi)) {
    for (const f of m[1].matchAll(/\(\s*'([a-z0-9_]+)'\s*,\s*(true|false)\b/gi)) filas.push({ clave: f[1], activa: f[2].toLowerCase() === 'true' });
  }
  return filas;
}

test('el parser lee las filas sembradas y distingue true de false', () => {
  assert.deepEqual(filasSembradas("insert into public.banderas_plataforma (clave, activa, descripcion) values ('a', false, 'x'), ('b', TRUE, 'y') on conflict (clave) do nothing;"),
    [{ clave: 'a', activa: false }, { clave: 'b', activa: true }]);
  assert.deepEqual(filasSembradas('-- nada'), []);
});

test('ninguna migración siembra una bandera de plataforma encendida (promociones_precio y precios_masivos incluidas)', () => {
  const todas = migraciones.flatMap((m) => filasSembradas(m.sql).map((x) => ({ ...x, f: m.f })));
  const claves = new Set(todas.map((x) => x.clave));
  assert.ok(claves.has('promociones_precio') && claves.has('precios_masivos'), 'se esperan las dos banderas de precios sembradas');
  assert.deepEqual(todas.filter((x) => x.activa), [], 'bandera sembrada ENCENDIDA: debe nacer apagada (se enciende por entorno)');
});

test('ninguna migración enciende una bandera de plataforma con un update', () => {
  const malas = migraciones.filter((m) => /update\s+(?:public\.)?banderas_plataforma\s+set\s+activa\s*=\s*true/i.test(m.sql)).map((m) => m.f);
  assert.deepEqual(malas, []);
});

test('la columna activa nace en false (default de la tabla)', () => {
  const base = migraciones.find((m) => /create\s+table\s+if\s+not\s+exists\s+public\.banderas_plataforma/i.test(m.sql));
  assert.ok(base, 'no se encontró la migración de la tabla');
  assert.match(base.sql, /activa\s+boolean\s+not\s+null\s+default\s+false/i);
});
