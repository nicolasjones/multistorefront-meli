// Pruebas del supervisor (A1/A2): el PAT solo se usa contra la API de GitHub; el contenedor del job recibe solo la configuración JIT y se
// crea uno nuevo por ciclo. fetch y docker se inyectan: no se toca la red ni Docker.
import assert from 'node:assert/strict';
import test from 'node:test';
import { leerConfiguracionSupervisor } from './config-runner.mjs';
import { borrarRunner, ciclo, crearRunnerJit } from './supervisor.mjs';

const cfg = leerConfiguracionSupervisor({ RUNNER_ROLE: 'pr', RUNNER_REPO: 'org/repo', RUNNER_LABELS: 'self-hosted,platform-local,platform-pr', RUNNER_IMAGE: 'img:local' });
const PAT = 'ghp_PAT_SECRETO_DE_PRUEBA';

function githubFalso({ jit = 'JITCFG', id = 77, estadoJit = 201 } = {}) {
  const llamadas = [];
  const fetchFn = async (url, opciones) => {
    llamadas.push({ url, metodo: opciones.method, auth: opciones.headers?.Authorization, cuerpo: opciones.body ? JSON.parse(opciones.body) : undefined });
    if (url.endsWith('/generate-jitconfig')) return { ok: estadoJit < 300, status: estadoJit, json: async () => ({ encoded_jit_config: jit, runner: { id } }) };
    return { ok: true, status: 204, json: async () => ({}) };
  };
  return { llamadas, fetchFn };
}

test('crearRunnerJit: pide un runner efímero con las etiquetas y devuelve id y JIT', async () => {
  const { llamadas, fetchFn } = githubFalso();
  const r = await crearRunnerJit({ cfg, pat: PAT, nombre: 'n-1', fetchFn });
  assert.deepEqual(r, { id: 77, jit: 'JITCFG' });
  assert.equal(llamadas[0].url, 'https://api.github.com/repos/org/repo/actions/runners/generate-jitconfig');
  assert.equal(llamadas[0].metodo, 'POST');
  assert.equal(llamadas[0].auth, `Bearer ${PAT}`);
  assert.deepEqual(llamadas[0].cuerpo.labels, ['self-hosted', 'platform-local', 'platform-pr']);
});

test('crearRunnerJit: error de GitHub o respuesta incompleta fallan sin filtrar el PAT', async () => {
  const mala = githubFalso({ estadoJit: 403 });
  await assert.rejects(crearRunnerJit({ cfg, pat: PAT, nombre: 'n', fetchFn: mala.fetchFn }), (e) => /HTTP 403/.test(e.message) && !e.message.includes(PAT));
  await assert.rejects(crearRunnerJit({ cfg, pat: PAT, nombre: 'n', fetchFn: async () => ({ ok: true, status: 201, json: async () => ({}) }) }), /sin configuración JIT/);
});

test('ciclo: un contenedor NUEVO por ciclo, el PAT no llega a docker y el runner se borra aunque docker falle', async () => {
  const { llamadas, fetchFn } = githubFalso();
  const corridas = [];
  const ejecutarDocker = async (args) => { corridas.push(args); return 0; };
  await ciclo({ cfg, pat: PAT, ranura: 1, ejecutarDocker, fetchFn, sufijo: 'aaaa' });
  await ciclo({ cfg, pat: PAT, ranura: 1, ejecutarDocker, fetchFn, sufijo: 'bbbb' });
  assert.equal(corridas.length, 2);
  assert.notEqual(corridas[0][corridas[0].indexOf('--name') + 1], corridas[1][corridas[1].indexOf('--name') + 1], 'nunca se reutiliza un contenedor');
  for (const args of corridas) {
    assert.ok(args.includes('--rm'));
    assert.ok(!args.join(' ').includes(PAT), 'el PAT no entra al contenedor del job');
    assert.ok(args.includes('RUNNER_JIT_CONFIG=JITCFG'));
  }
  assert.equal(llamadas.filter((l) => l.metodo === 'DELETE').length, 2);
  const falla = githubFalso();
  await assert.rejects(ciclo({ cfg, pat: PAT, ranura: 1, ejecutarDocker: async () => { throw new Error('docker murió'); }, fetchFn: falla.fetchFn }), /docker murió/);
  assert.equal(falla.llamadas.filter((l) => l.metodo === 'DELETE').length, 1, 'el runner se borra también si el contenedor falla');
});

test('borrarRunner nunca lanza (un 404 o un error de red no rompe el ciclo)', async () => {
  await borrarRunner({ cfg, pat: PAT, id: 1, fetchFn: async () => { throw new Error('red'); } });
  await borrarRunner({ cfg, pat: PAT, id: 1, fetchFn: async () => ({ ok: false, status: 404 }) });
});
