import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { configCi, derivarStackCi, intentarRanuras, leerConfigDesarrollo, NUM_RANURAS, verificarDestinoCi } from './supabase-ci.mjs';

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

// S3a (FEAT-134): cada corrida del job `database` usa una RANURA propia (project_id + rango de puertos),
// para no compartir una sola pila con un `concurrency` que cancelaba las corridas en cola (BUG-179).
test('cada ranura tiene project_id y puertos propios (sin chocar entre sí ni con desarrollo)', () => {
  const deDesarrollo = new Set(Object.values(template.puertos));
  const vistos = new Set();
  for (let r = 0; r < NUM_RANURAS; r++) {
    const stack = derivarStackCi(template, repoProductoPropio, r);
    assert.equal(stack.ranura, r);
    assert.equal(stack.projectId, r === 0 ? 'ci-multistorefront-meli' : `ci-r${r}-multistorefront-meli`);
    for (const puerto of Object.values(stack.puertos)) {
      assert.ok(puerto < 65536, `puerto ${puerto} fuera de rango`);
      assert.ok(!deDesarrollo.has(puerto), `puerto ${puerto} choca con desarrollo`);
      assert.ok(!vistos.has(puerto), `puerto ${puerto} repetido entre ranuras`);
      vistos.add(puerto);
    }
  }
});

test('la ranura mueve la base y conserva el nombre del repo', () => {
  const stack = derivarStackCi(template, repoProductoPropio, 1);
  assert.equal(stack.projectId, 'ci-r1-multistorefront-meli');
  assert.equal(stack.puertoDb, 33634);
  assert.equal(stack.puertos['api.port'], 35300);
});

test('la ranura sobrevive al recorte a 40 del project_id', () => {
  const stack = derivarStackCi(template, 'org/un-repositorio-con-un-nombre-muy-largo-para-supabase', 3);
  assert.equal(stack.projectId.length, 40);
  assert.ok(stack.projectId.startsWith('ci-r3-'));
});

test('rechaza una ranura fuera del tope', () => {
  assert.throws(() => derivarStackCi(template, repoProductoPropio, NUM_RANURAS), /excede SUPABASE_CI_RANURAS/);
});

test('la guarda exige la ranura declarada en el entorno', () => {
  const stack = derivarStackCi(template, repoProductoPropio, 1);
  const entorno = {
    GITHUB_REPOSITORY: repoProductoPropio,
    SUPABASE_CI_RANURA: '1',
    SUPABASE_CI_PROJECT_ID: stack.projectId,
    SUPABASE_DB_PORT: String(stack.puertoDb),
  };
  const contenedores = () => [`supabase_db_${stack.projectId}`];
  assert.equal(verificarDestinoCi({ entorno, desarrollo: template, contenedores }).projectId, stack.projectId);
  // Sin la ranura en el entorno, el stack esperado es el de la ranura 0: la guarda rechaza.
  const sinRanura = { ...entorno };
  delete sinRanura.SUPABASE_CI_RANURA;
  assert.throws(() => verificarDestinoCi({ entorno: sinRanura, desarrollo: template, contenedores }), /no es el del stack del CI/);
});

// La reserva de ranuras es un `mkdir` atómico sobre el volumen pnpm compartido por las réplicas.
test('intentarRanuras reparte ranuras distintas y devuelve null cuando no queda ninguna', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ci-locks-'));
  const reservadas = [];
  for (let i = 0; i < 3; i++) reservadas.push(await intentarRanuras({ dir, nombre: 'repo', ranuras: 3 }));
  assert.deepEqual(reservadas, [0, 1, 2]);
  assert.equal(await intentarRanuras({ dir, nombre: 'repo', ranuras: 3 }), null);
});

test('intentarRanuras recicla un lock viejo (job muerto sin liberar)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ci-locks-'));
  await mkdir(path.join(dir, 'repo-0'));
  const viejo = new Date(Date.now() - 3600_000);
  await utimes(path.join(dir, 'repo-0'), viejo, viejo);
  assert.equal(await intentarRanuras({ dir, nombre: 'repo', ranuras: 1, ttlMs: 60_000 }), 0);
});
