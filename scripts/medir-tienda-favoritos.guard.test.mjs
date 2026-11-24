// Prueba del guard de entorno de `scripts/medir-tienda-favoritos.sql` (MSF-176 H-6).
// Se omite sin estas variables de entorno:
//   MEDIR_PSQL           comando psql (superusuario) hacia una base descartable: su nombre tiene `descartable`, `test` o `local` como palabra delimitada por `_` o `-`,
//                        p. ej. `psql -U postgres -h localhost -d medicion_descartable` (o `docker exec -i <contenedor> psql -U postgres -d medicion_descartable`)
//   MEDIR_PSQL_OTRA_BASE comando psql hacia una base cuyo nombre NO cumple eso y que no tiene tablas de usuario (p. ej. `guardotrabase`, creada vacía)
//   MEDIR_SIN_ESQUEMA=1  (opcional) las bases están vacías, sin migraciones: se omiten los dos casos que leen `organizaciones` (más de 5 organizaciones y condiciones cumplidas)
// La prueba escribe (organizaciones de prueba, un rol y una base vacía): comprueba las dos bases ANTES de cualquier escritura y falla si no son las esperadas.
// En el CI la corre el paso «Prueba del guard de medición» del job `database` (`scripts/probar-guard-medicion.sh`) con bases vacías y `MEDIR_SIN_ESQUEMA=1`;
// local, con el esquema completo, corren los 7 casos.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const guion = readFileSync(new URL('./medir-tienda-favoritos.sql', import.meta.url), 'utf8');
const psql = process.env.MEDIR_PSQL;
const otraBase = process.env.MEDIR_PSQL_OTRA_BASE;
const omitir = psql && otraBase ? false : 'sin MEDIR_PSQL y MEDIR_PSQL_OTRA_BASE (base descartable)';
const omitirEsquema = omitir || (process.env.MEDIR_SIN_ESQUEMA === '1' ? 'MEDIR_SIN_ESQUEMA=1 (bases sin esquema)' : false);
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

// Antes de cualquier escritura: MEDIR_PSQL tiene que ser una base descartable y MEDIR_PSQL_OTRA_BASE una base NO descartable y vacía (sin tablas de usuario), para que no
// pueda ser una base real ni el script pueda escribir en ella.
if (!omitir) {
  const nombre = consulta(psql, 'select current_database();');
  if (!NOMBRE_DESCARTABLE.test(nombre)) {
    throw new Error(`MEDIR_PSQL apunta a «${nombre}», que no es una base descartable (nombre con descartable, test o local): no se escribe nada.`);
  }
  const otra = consulta(otraBase, 'select current_database();');
  if (NOMBRE_DESCARTABLE.test(otra)) {
    throw new Error(`MEDIR_PSQL_OTRA_BASE apunta a «${otra}», cuyo nombre cumple el guard: tiene que ser una base con otro nombre.`);
  }
  const tablas = consulta(otraBase, "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r', 'p') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%';");
  if (tablas !== '0') {
    throw new Error(`MEDIR_PSQL_OTRA_BASE apunta a «${otra}», que tiene ${tablas} tablas de usuario: tiene que ser una base vacía, no una real.`);
  }
}

// Crea un objeto de prueba y devuelve la función que lo borra: falla si ya existía (puede ser ajeno) y solo borra lo que ESTA corrida creó.
const crearTemporal = (existeSql, crearSql, borrarSql, nombre) => {
  if (consulta(psql, existeSql) !== '0') throw new Error(`ya existe ${nombre}: no se toca (podría ser ajeno); borralo a mano si es un resto de una corrida anterior.`);
  consulta(psql, crearSql);
  return () => consulta(psql, borrarSql);
};

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
  const borrar = crearTemporal("select count(*) from pg_database where datname = 'guardlatest';", 'create database guardlatest template template0;', 'drop database if exists guardlatest;', 'la base guardlatest');
  try {
    const r = correr(psql, '-v N=5 -v BASE_DESCARTABLE=si', '\\connect guardlatest\n');
    assert.match(salida(r), /ABORTADO: el nombre de la base/);
    assert.doesNotMatch(salida(r), /guardar ok/);
  } finally {
    borrar();
  }
});

test('el guard aborta con una sesión que no es superusuario', { skip: omitir }, () => {
  const borrar = crearTemporal("select count(*) from pg_roles where rolname = 'guard_test_nosuper';", 'create role guard_test_nosuper nologin;', 'drop role if exists guard_test_nosuper;', 'el rol guard_test_nosuper');
  try {
    const r = correr(psql, '-v N=5 -v BASE_DESCARTABLE=si', 'set session authorization guard_test_nosuper;\n');
    assert.match(salida(r), /ABORTADO: la sesión no es superusuario/);
    assert.doesNotMatch(salida(r), /guardar ok/);
  } finally {
    borrar();
  }
});

test('el guard aborta con más de 5 organizaciones y no deja datos', { skip: omitirEsquema }, () => {
  try {
    consulta(psql, "insert into public.organizaciones (nombre) select 'guard-test-' || g from generate_series(1, 6) g;");
    const r = correr(psql, '-v N=5 -v BASE_DESCARTABLE=si');
    assert.match(salida(r), /ABORTADO: la base tiene más de 5 organizaciones/);
    assert.doesNotMatch(salida(r), /guardar ok/);
  } finally {
    consulta(psql, "delete from public.organizaciones where nombre like 'guard-test-%';");
  }
});

test('con las condiciones cumplidas corre y hace rollback', { skip: omitirEsquema }, () => {
  const r = correr(psql, '-v N=5 -v BASE_DESCARTABLE=si');
  assert.match(salida(r), /guardar ok/);
  assert.equal(consulta(psql, "select count(*) from public.organizaciones where nombre = 'Medicion';"), '0');
});
