// Prueba del guard de entorno de `scripts/medir-tienda-favoritos.sql` (MSF-176 H-6).
// Necesita una base descartable (nombre con «descartable», «test» o «local») con todas las migraciones aplicadas y psql. Sin las variables de entorno se omite:
//   MEDIR_PSQL           comando psql hacia la base descartable, p. ej. `psql -U postgres -h localhost -d medicion_descartable` (o `docker exec -i <contenedor> psql -U postgres -d medicion_descartable`)
//   MEDIR_PSQL_OTRA_BASE comando psql hacia una base cuyo nombre NO contiene esas palabras (p. ej. `postgres`)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const guion = readFileSync(new URL('./medir-tienda-favoritos.sql', import.meta.url), 'utf8');
const psql = process.env.MEDIR_PSQL;
const otraBase = process.env.MEDIR_PSQL_OTRA_BASE;
const omitir = psql && otraBase ? false : 'sin MEDIR_PSQL y MEDIR_PSQL_OTRA_BASE (base descartable)';

const correr = (comando, variables, sql = guion) =>
  spawnSync('sh', ['-c', `${comando} -X -q -v ON_ERROR_STOP=0 ${variables} -f -`], { input: sql, encoding: 'utf8' });
const consulta = (comando, sql) => spawnSync('sh', ['-c', `${comando} -X -q -A -t -c "${sql}"`], { encoding: 'utf8' }).stdout.trim();

test('el guard aborta sin la variable', { skip: omitir }, () => {
  const r = correr(psql, '-v N=5');
  assert.match(r.stdout + r.stderr, /ABORTADO: falta -v BASE_DESCARTABLE=si/);
  assert.doesNotMatch(r.stdout + r.stderr, /guardar ok/);
});

test('el guard aborta con BASE_DESCARTABLE distinto de si', { skip: omitir }, () => {
  const r = correr(psql, '-v N=5 -v BASE_DESCARTABLE=no');
  assert.match(r.stdout + r.stderr, /ABORTADO: BASE_DESCARTABLE debe valer si/);
  assert.doesNotMatch(r.stdout + r.stderr, /guardar ok/);
});

test('el guard aborta en una base cuyo nombre no es descartable', { skip: omitir }, () => {
  const r = correr(otraBase, '-v N=5 -v BASE_DESCARTABLE=si');
  assert.match(r.stdout + r.stderr, /ABORTADO: el nombre de la base/);
  assert.doesNotMatch(r.stdout + r.stderr, /guardar ok/);
});

test('el guard aborta con más de 5 organizaciones y no deja datos', { skip: omitir }, () => {
  consulta(psql, "insert into public.organizaciones (nombre) select 'guard-test-' || g from generate_series(1, 6) g");
  try {
    const r = correr(psql, '-v N=5 -v BASE_DESCARTABLE=si');
    assert.match(r.stdout + r.stderr, /ABORTADO: la base tiene más de 5 organizaciones/);
    assert.doesNotMatch(r.stdout + r.stderr, /guardar ok/);
  } finally {
    consulta(psql, "delete from public.organizaciones where nombre like 'guard-test-%'");
  }
});

test('con las condiciones cumplidas corre y hace rollback', { skip: omitir }, () => {
  const r = correr(psql, '-v N=5 -v BASE_DESCARTABLE=si');
  assert.match(r.stdout + r.stderr, /guardar ok/);
  assert.equal(consulta(psql, "select count(*) from public.organizaciones where nombre = 'Medicion'"), '0');
});
