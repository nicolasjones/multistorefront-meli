#!/usr/bin/env node
// Guard de migraciones: evita la clase de falla que trabó DEV el 2026-10-23.
//
//   1. VERSIONES ÚNICAS: dos archivos con la misma versión rompen el registro.
//   2. VERSIÓN INMUTABLE: una versión que ya existía en la base NO puede cambiar de
//      contenido (se aplicó en algún entorno con ese contenido; cambiarla hace que el
//      registro y el archivo discrepen y que la migración NUNCA se aplique — pasó con
//      `20261019120000`, que quedó grabada con otro contenido y bloqueó toda la cola).
//   3. VERSIÓN NUEVA: una migración agregada debe usar una versión MAYOR que la máxima
//      de la base (no reusar un número viejo).
//   4. IDEMPOTENCIA: el DDL debe tolerar una aplicación parcial (el aplicador se detiene
//      en el primer error y reintenta): `ADD COLUMN IF NOT EXISTS`, `DROP ... IF EXISTS`,
//      `CREATE INDEX IF NOT EXISTS`.
//
// Uso:  node scripts/verificar-migraciones.mjs [--base origin/dokploy] [--solo-idempotencia]
// Sale con código 1 si hay un problema.

import { spawnSync } from 'node:child_process';
import { detectarAddColumnSinGuard } from './detectar-add-column.mjs';

const args = process.argv.slice(2);
const valorDe = (flag, def) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const base = valorDe('--base', process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/dokploy');
const soloIdempotencia = args.includes('--solo-idempotencia');
const git = (a) => spawnSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const problemas = [];
const avisos = [];

// --- Migraciones del árbol actual ---
const archivos = (git(['ls-files', 'supabase/migrations']).stdout || '')
  .split('\n').map((x) => x.trim()).filter((x) => /^supabase\/migrations\/\d+_.+\.sql$/.test(x));

const porVersion = new Map();
for (const f of archivos) {
  const v = f.split('/').pop().split('_')[0];
  if (!porVersion.has(v)) porVersion.set(v, []);
  porVersion.get(v).push(f);
}
for (const [v, fs_] of porVersion) {
  if (fs_.length > 1) problemas.push(`versión duplicada ${v}: ${fs_.join(', ')}`);
}

if (!soloIdempotencia) {
  const existeBase = git(['rev-parse', '--verify', '--quiet', base]).status === 0;
  if (!existeBase) {
    avisos.push(`no existe la base ${base}: se omite el control de versiones (sí corre el de idempotencia)`);
  } else {
    const enBase = (git(['ls-tree', '-r', '--name-only', base, 'supabase/migrations']).stdout || '')
      .split('\n').map((x) => x.trim()).filter((x) => /^supabase\/migrations\/\d+_.+\.sql$/.test(x));
    const basePorVersion = new Map();
    for (const f of enBase) basePorVersion.set(f.split('/').pop().split('_')[0], f);

    const maxBase = [...basePorVersion.keys()].sort().pop() || '0';

    for (const [v, fs_] of porVersion) {
      const previo = basePorVersion.get(v);
      if (!previo) {
        if (v <= maxBase) {
          problemas.push(`versión ${v} REUSADA: ya existe ${maxBase} o mayor en ${base}; usá una versión nueva y mayor (${fs_[0]})`);
        }
        continue;
      }
      const actual = git(['show', `:${fs_[0]}`]).stdout || '';
      const anterior = git(['show', `${base}:${previo}`]).stdout || '';
      if (actual !== anterior) {
        // Editar una versión ya publicada es peligroso en general, pero AGREGAR guards de
        // idempotencia (IF NOT EXISTS / IF EXISTS) no cambia el efecto cuando la migración
        // se aplica completa: es justamente el arreglo que destraba una aplicación parcial.
        // Se compara el contenido con los guards normalizados.
        const sinGuards = (s) => s
          .replace(/\badd\s+column\s+if\s+not\s+exists\b/gi, 'add column')
          .replace(/\bcreate\s+(unique\s+)?index\s+if\s+not\s+exists\b/gi, 'create $1index')
          .replace(/\bdrop\s+(\w+)\s+if\s+exists\b/gi, 'drop $1')
          .replace(/\bcreate\s+table\s+if\s+not\s+exists\b/gi, 'create table');
        if (sinGuards(actual) === sinGuards(anterior)) {
          avisos.push(`versión ${v}: sólo se agregaron guards de idempotencia (permitido)`);
        } else {
          problemas.push(`versión ${v} MODIFICADA: ya existe en ${base} (${previo}). Una versión aplicada es inmutable: si el contenido nunca se aplicó, renombrala a una versión libre y mayor.`);
        }
      }
    }
  }
}

// --- Idempotencia del DDL (sólo archivos NUEVOS respecto de la base) ---
const existeBase2 = git(['rev-parse', '--verify', '--quiet', base]).status === 0;
const nuevos = existeBase2
  ? archivos.filter((f) => git(['cat-file', '-e', `${base}:${f}`]).status !== 0)
  : archivos;

const revisar = (archivo) => {
  const sql = git(['show', `:${archivo}`]).stdout || '';
  // ADD COLUMN se analiza por sentencia completa (puede ir en una línea aparte de ALTER TABLE).
  for (const { linea } of detectarAddColumnSinGuard(sql)) {
    problemas.push(`${archivo}:${linea} ADD COLUMN sin IF NOT EXISTS (una aplicación parcial traba el reintento)`);
  }
  const lineas = sql.split('\n');
  lineas.forEach((linea, i) => {
    const l = linea.trim();
    if (/^--/.test(l)) return;
    const n = i + 1;
    if (/^drop\s+function\b/i.test(l) && !/if\s+exists/i.test(l)) {
      problemas.push(`${archivo}:${n} DROP FUNCTION sin IF EXISTS`);
    }
    if (/^drop\s+(table|view|index|trigger)\b/i.test(l) && !/if\s+exists/i.test(l)) {
      avisos.push(`${archivo}:${n} DROP sin IF EXISTS (revisá si puede reintentarse)`);
    }
    if (/^create\s+(unique\s+)?index\b/i.test(l) && !/if\s+not\s+exists/i.test(l)) {
      problemas.push(`${archivo}:${n} CREATE INDEX sin IF NOT EXISTS`);
    }
    if (/^create\s+table\b/i.test(l) && !/if\s+not\s+exists/i.test(l)) {
      avisos.push(`${archivo}:${n} CREATE TABLE sin IF NOT EXISTS`);
    }
  });
};
for (const f of nuevos) revisar(f);

for (const a of avisos) console.warn(`aviso: ${a}`);
if (problemas.length) {
  console.error('Migraciones: revisar antes de mergear');
  for (const p of problemas) console.error(` - ${p}`);
  process.exit(1);
}
console.log(`Migraciones OK: ${archivos.length} archivo(s), ${nuevos.length} nuevo(s) contra ${base}.`);
