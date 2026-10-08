import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { configCi, derivarStackCi, leerConfigDesarrollo, verificarDestinoCi } from './supabase-ci.mjs';

const texto = await readFile(path.resolve(import.meta.dirname, '../supabase/config.toml'), 'utf8');
const template = leerConfigDesarrollo(texto);
// Puertos de desarrollo reales del otro producto (estudio-contable-automation),
// el stack de CI de cada producto no debe chocar con el del otro ni con desarrollo.
const producto = leerConfigDesarrollo(texto
  .replace(/^project_id = .*$/m, 'project_id = "estudio-contable-automation-supabase-dev"')
  .replace(/^(\s*(?:[a-z_]*port)\s*=\s*)(\d+)/gm, (_, clave, puerto) => `${clave}${({ 9300: 9100, 7634: 6434, 7633: 6433, 57329: 55329, 4301: 4101, 4302: 4102, 8084: 9083, 57327: 55327 })[puerto] ?? puerto}`));

const repoProductoPropio = 'nicolasjones/multistorefront-meli';
const repoProducto = 'nicolasjones/estudio-contable-automation';

test('el stack del CI tiene project_id y puertos propios, distintos de desarrollo', () => {
  const stack = derivarStackCi(template, repoProductoPropio);
  assert.equal(stack.projectId, 'ci-multistorefront-meli');
  assert.equal(stack.puertoDb, 27634);
  assert.equal(stack.puertos['api.port'], 29300);
  const desarrollo = new Set(Object.values(template.puertos));
  assert.ok(Object.values(stack.puertos).every((puerto) => !desarrollo.has(puerto) && puerto < 65536));
});

test('los stacks de CI de este producto y del otro no chocan entre sí ni con desarrollo', () => {
  const ciPropio = derivarStackCi(template, repoProductoPropio);
  const ciProducto = derivarStackCi(producto, repoProducto);
  assert.equal(ciProducto.projectId, 'ci-estudio-contable-automation');
  assert.equal(ciProducto.puertoDb, 26434);
  const todos = [ciPropio, ciProducto].flatMap((stack) => Object.values(stack.puertos))
    .concat(Object.values(template.puertos), Object.values(producto.puertos));
  assert.equal(new Set(todos).size, todos.length);
});

test('sin GITHUB_REPOSITORY el nombre sale del project_id de desarrollo', () => {
  assert.equal(derivarStackCi(producto, undefined).projectId, 'ci-estudio-contable-automation');
});

test('el project_id del CI respeta el recorte a 40 caracteres del CLI', () => {
  const stack = derivarStackCi(template, 'org/un-repositorio-con-un-nombre-muy-largo-para-supabase');
  assert.equal(stack.projectId.length, 40);
  assert.ok(stack.projectId.startsWith('ci-'));
});

test('configCi reescribe project_id y puertos y desactiva migraciones y seed del start', () => {
  const stack = derivarStackCi(template, repoProductoPropio);
  const salida = configCi(texto, stack);
  const leido = leerConfigDesarrollo(salida);
  assert.equal(leido.projectId, 'ci-multistorefront-meli');
  assert.deepEqual(leido.puertos, stack.puertos);
  assert.match(salida, /\[db\.migrations\][^[]*enabled = false/);
  assert.match(salida, /\[db\.seed\][^[]*enabled = false/);
  assert.doesNotMatch(salida, /= 5434\b/);
});

const entornoCi = { SUPABASE_DB_PORT: '27634', SUPABASE_CI_PROJECT_ID: 'ci-multistorefront-meli', GITHUB_REPOSITORY: repoProductoPropio };
const soloCi = () => ['supabase_db_ci-multistorefront-meli'];

test('la guarda acepta sólo el stack del CI', () => {
  assert.deepEqual(verificarDestinoCi({ entorno: entornoCi, desarrollo: template, contenedores: soloCi }), { puerto: 27634, projectId: 'ci-multistorefront-meli' });
});

test('la guarda rechaza el puerto y el project_id de desarrollo', () => {
  const desarrollo = () => ['supabase_db_multistorefront-meli-supabase-de'];
  assert.throws(() => verificarDestinoCi({ entorno: { ...entornoCi, SUPABASE_DB_PORT: '7634' }, desarrollo: template, contenedores: desarrollo }), /no es el de la base del CI/);
  assert.throws(() => verificarDestinoCi({ entorno: { ...entornoCi, SUPABASE_CI_PROJECT_ID: 'multistorefront-meli-supabase-de' }, desarrollo: template, contenedores: soloCi }), /no es el del stack del CI/);
});

test('la guarda rechaza el puerto de desarrollo de otro producto', () => {
  assert.throws(() => verificarDestinoCi({ entorno: { ...entornoCi, SUPABASE_DB_PORT: '6434' }, desarrollo: template, contenedores: () => ['supabase_db_estudio-contable-automation-supabase-dev'] }), /no es el de la base del CI/);
});

test('la guarda rechaza si el puerto lo publica otro contenedor o nadie', () => {
  assert.throws(() => verificarDestinoCi({ entorno: entornoCi, desarrollo: template, contenedores: () => ['otro'] }), /lo publica \[otro\]/);
  assert.throws(() => verificarDestinoCi({ entorno: entornoCi, desarrollo: template, contenedores: () => [] }), /lo publica \[nadie\]/);
});

test('la guarda exige las variables del stack del CI', () => {
  assert.throws(() => verificarDestinoCi({ entorno: { GITHUB_REPOSITORY: repoProductoPropio }, desarrollo: template, contenedores: soloCi }), /Faltan SUPABASE_DB_PORT/);
});
