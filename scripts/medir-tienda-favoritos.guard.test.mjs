// Prueba del guard de entorno de `scripts/medir-tienda-favoritos.sql` (MSF-176 H-6).
// Necesita una base descartable con todas las migraciones aplicadas y psql, y se omite sin estas variables de entorno:
//   MEDIR_PSQL           comando psql hacia la base descartable (superusuario), cuyo nombre tiene `descartable`, `test` o `local` como palabra delimitada por `_` o `-`,
//                        p. ej. `psql -U postgres -h localhost -d medicion_descartable` (o `docker exec -i <contenedor> psql -U postgres -d medicion_descartable`)
//   MEDIR_PSQL_OTRA_BASE comando psql hacia una base con todas las migraciones cuyo nombre NO cumple eso (p. ej. `postgres`)
// La prueba escribe (organizaciones de prueba, un rol y una base vacía): por eso comprueba el nombre de la base ANTES de cualquier escritura y falla si no es descartable.
// No corre en el CI: el job `database` usa la base `postgres` del stack de Supabase, que tiene conexiones de los servicios y no se puede clonar como plantilla, y su nombre no cumple
// el guard; la prueba corre local con las variables.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const guion = readFileSync(new URL('./medir-tienda-favoritos.sql', import.meta.url), 'utf8');
const psql = process.env.MEDIR_PSQL;
const otraBase = process.env.MEDIR_PSQL_OTRA_BASE;
const omitir = psql && otraBase ? false : 'sin MEDIR_PSQL y MEDIR_PSQL_OTRA_BASE (base descartable)';
const NOMBRE_DESCARTABLE = /(^|[_-])(descartable|test|local)([_-]|$)/i;

const ejecutar = (comando, extra, input) =>
  spawnSync('sh', ['-c', `${comando} -X -q -A -t ${extra}`], { input, encoding: 'utf8' });
const correr = (comando, variables, antes = '') => ejecutar(comando, `-v ON_ERROR_STOP=0 ${variables} -f -`, antes + guion);
const consulta = (comando, sql) => {
  const r = ejecutar(comando, '-v ON_ERROR_STOP=1 -f -', sql);
  assert.equal(r.status, 0, `falló la consulta de apoyo: ${r.stderr}`);
  return r.stdout.trim();
};
const salida = (r) => r.stdout + r.stderr;

// Antes de cualquier escritura: la base a la que apunta MEDIR_PSQL tiene que ser descartable.
if (!omitir) {
  const r = ejecutar(psql, '-v ON_ERROR_STOP=1 -f -', 'select current_database();');
  const nombre = r.stdout.trim();
  if (r.status !== 0 || !NOMBRE_DESCARTABLE.test(nombre)) {
    throw new Error(`MEDIR_PSQL apunta a «${nombre}», que no es una base descartable (nombre con descartable, test o local): no se escribe nada. ${r.stderr}`);
  }
}

test('el guard aborta sin la variable', { skip: omitir }, () => {
  const r = correr(psql, '-v N=5');
  assert.match(salida(r), /ABORTADO: falta -v BASE_DESCARTABLE=si/);
  assert.doesNotMatch(salida(r), /guardar ok/);
});

test('el guard aborta con BASE_DESCARTABLE distinto de si', { skip: omitir }, () => {
  const r = correr(psql, '-v N=5 -v BASE_DESCARTABLE=no');
  assert.match(salida(r), /ABORTADO: BASE_DESCARTABLE debe valer si/);
  assert.doesNotMatch(salida(r), /guardar ok/);
});

test('el guard aborta en una base cuyo nombre no es descartable', { skip: omitir }, () => {
  const r = correr(otraBase, '-v N=5 -v BASE_DESCARTABLE=si');
  assert.match(salida(r), /ABORTADO: el nombre de la base/);
  assert.doesNotMatch(salida(r), /guardar ok/);
});

test('el guard aborta con un nombre que solo contiene la palabra como subcadena (latest)', { skip: omitir }, () => {
  try {
    consulta(psql, 'create database guardlatest template template0;');
    const r = correr(psql, '-v N=5 -v BASE_DESCARTABLE=si', '\\connect guardlatest\n');
    assert.match(salida(r), /ABORTADO: el nombre de la base/);
    assert.doesNotMatch(salida(r), /guardar ok/);
  } finally {
    consulta(psql, 'drop database if exists guardlatest;');
  }
});

test('el guard aborta con una sesión que no es superusuario', { skip: omitir }, () => {
  try {
    consulta(psql, 'create role guard_test_nosuper login;');
    const r = correr(psql, '-v N=5 -v BASE_DESCARTABLE=si', 'set session authorization guard_test_nosuper;\n');
    assert.match(salida(r), /ABORTADO: la sesión no es superusuario/);
    assert.doesNotMatch(salida(r), /guardar ok/);
  } finally {
    consulta(psql, 'drop role if exists guard_test_nosuper;');
  }
});

test('el guard aborta con más de 5 organizaciones y no deja datos', { skip: omitir }, () => {
  try {
    consulta(psql, "insert into public.organizaciones (nombre) select 'guard-test-' || g from generate_series(1, 6) g;");
    const r = correr(psql, '-v N=5 -v BASE_DESCARTABLE=si');
    assert.match(salida(r), /ABORTADO: la base tiene más de 5 organizaciones/);
    assert.doesNotMatch(salida(r), /guardar ok/);
  } finally {
    consulta(psql, "delete from public.organizaciones where nombre like 'guard-test-%';");
  }
});

test('con las condiciones cumplidas corre y hace rollback', { skip: omitir }, () => {
  const r = correr(psql, '-v N=5 -v BASE_DESCARTABLE=si');
  assert.match(salida(r), /guardar ok/);
  assert.equal(consulta(psql, "select count(*) from public.organizaciones where nombre = 'Medicion';"), '0');
});
