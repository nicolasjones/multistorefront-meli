#!/usr/bin/env node
// MSF-900: inventario de las migraciones HISTÓRICAS sin camino de reversión documentado (inmutables: no se reescriben).
// Uso:  node scripts/inventariar-migraciones-sin-reversion.mjs [--dir supabase/migrations] [--json]
// Lista las que no pasan `tieneReversion` y marca cuáles son destructivas (`esDestructiva`).
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { esDestructiva, tieneReversion } from './migraciones-reversion.mjs';

const args = process.argv.slice(2);
const i = args.indexOf('--dir');
const dir = i >= 0 && args[i + 1] ? args[i + 1] : 'supabase/migrations';
const archivos = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
const sin = [];
for (const f of archivos) {
  const sql = await readFile(path.join(dir, f), 'utf8');
  if (!tieneReversion(sql)) sin.push({ archivo: f, destructiva: esDestructiva(sql) });
}
if (args.includes('--json')) {
  console.log(JSON.stringify({ total: archivos.length, sinReversion: sin }, null, 2));
} else {
  for (const m of sin) console.log(`${m.destructiva ? 'DESTRUCTIVA' : 'no destructiva'}\t${m.archivo}`);
  console.log(`\n${sin.length} de ${archivos.length} migraciones sin reversión documentada; ${sin.filter((m) => m.destructiva).length} destructivas.`);
}
