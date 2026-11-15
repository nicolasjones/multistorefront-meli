// MSF-948 (cierre MSF-265): las dos migraciones del resumen semanal llevan versiones
// únicas de 14 dígitos, posteriores a la última de la base real (origin/dokploy), y todo
// lo que las cita (el SQL de la otra migración y la guía) apunta a archivos que existen:
// una cita con una versión que ya no está deja al operador sin ruta de reversión.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const raiz = path.resolve(import.meta.dirname, '..');
const dirMigraciones = path.join(raiz, 'supabase/migrations');
const ULTIMA_VERSION_BASE = '20270334000002';
const DEL_RESUMEN = /^(\d{14})_resumen_semanal_(tabla|funciones)\.sql$/;

const todas = readdirSync(dirMigraciones).filter((f) => /^\d+_.+\.sql$/.test(f));
const delResumen = todas.filter((f) => DEL_RESUMEN.test(f));
// En una línea que no lleva la épica no hay nada que verificar.
const sinResumen = delResumen.length === 0 ? 'esta línea no lleva las migraciones del resumen semanal' : false;

test('las migraciones del resumen semanal existen con versión de 14 dígitos', { skip: sinResumen }, () => {
  assert.equal(delResumen.length, 2);
  for (const f of delResumen) assert.match(f, /^\d{14}_/);
});

test('las versiones del resumen semanal son posteriores a la última de la base real', { skip: sinResumen }, () => {
  for (const f of delResumen) assert.ok(f.split('_')[0] > ULTIMA_VERSION_BASE, f);
});

test('ninguna versión de migración está repetida', () => {
  const versiones = todas.map((f) => f.split('_')[0]);
  assert.equal(new Set(versiones).size, versiones.length);
});

test('el SQL del resumen semanal sólo cita migraciones que existen', { skip: sinResumen }, () => {
  const versiones = new Set(todas.map((f) => f.split('_')[0]));
  for (const f of delResumen) {
    const sql = readFileSync(path.join(dirMigraciones, f), 'utf8');
    for (const m of sql.matchAll(/\b(\d{14})\b/g)) {
      assert.ok(versiones.has(m[1]), `${f} cita ${m[1]} y no existe`);
    }
  }
});

test('la guía del resumen semanal sólo cita migraciones que existen', { skip: sinResumen }, () => {
  const doc = readFileSync(path.join(raiz, 'docs/resumen-semanal-correo.md'), 'utf8');
  const citadas = [...doc.matchAll(/(\d{14}_[a-z_]+\.sql)/g)].map((m) => m[1]);
  assert.ok(citadas.length > 0);
  for (const f of citadas) assert.ok(todas.includes(f), `la guía cita ${f} y no existe`);
});
