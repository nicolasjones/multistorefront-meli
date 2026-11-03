// MSF-551 (cierre MSF-159): las migraciones de Ventas comprobantes llevan versiones
// únicas de 14 dígitos, posteriores a la última de origin/dokploy, y la doc las cita
// con el nombre vigente (SC-008).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const raiz = path.resolve(import.meta.dirname, '..');
const dirMigraciones = path.join(raiz, 'supabase/migrations');
const ULTIMA_VERSION_DOKPLOY = '20261202130100';

const todas = readdirSync(dirMigraciones).filter((f) => /^\d+_.+\.sql$/.test(f));
const deLaEpica = todas.filter((f) => /^(20261203|20261204)\d{6}_/.test(f));

test('hay migraciones de la épica y todas tienen versión de 14 dígitos', () => {
  // MSF-631: piso, no cantidad exacta; la épica sigue sumando migraciones 20261203*/20261204*.
  assert.ok(deLaEpica.length >= 12, `solo ${deLaEpica.length} migraciones de la épica`);
  for (const f of deLaEpica) assert.match(f, /^\d{14}_/);
});

test('las versiones de la épica son posteriores a la última de origin/dokploy', () => {
  for (const f of deLaEpica) assert.ok(f.split('_')[0] > ULTIMA_VERSION_DOKPLOY, f);
});

test('ninguna versión de migración está repetida', () => {
  const versiones = todas.map((f) => f.split('_')[0]);
  assert.equal(new Set(versiones).size, versiones.length);
});

test('la doc cita solo migraciones que existen', () => {
  const doc = readFileSync(path.join(raiz, 'docs/ventas-comprobantes.md'), 'utf8');
  const citadas = [...doc.matchAll(/(2026120[34]\d{6}_[a-z_]+)/g)].map((m) => `${m[1]}.sql`);
  assert.ok(citadas.length > 0);
  for (const f of citadas) assert.ok(todas.includes(f), `la doc cita ${f} y no existe`);
});
