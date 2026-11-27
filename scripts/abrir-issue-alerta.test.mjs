import assert from 'node:assert/strict';
import test from 'node:test';
import { avisar, cuerpoDelAviso } from './abrir-issue-alerta.mjs';

const env = { GITHUB_TOKEN: 'ghs_token_de_prueba', GITHUB_REPOSITORY: 'org/repo', GITHUB_RUN_ID: '42', GITHUB_SERVER_URL: 'https://github.com' };
const ahora = new Date('2026-11-26T10:00:00Z');

function api(abiertos) {
  const llamadas = [];
  const fetchFn = async (url, opciones) => {
    llamadas.push({ url, metodo: opciones.method, cabeceras: opciones.headers, cuerpo: opciones.body ? JSON.parse(opciones.body) : undefined });
    const ok = (datos) => ({ ok: true, status: 200, json: async () => datos });
    if (opciones.method === 'GET') return ok(abiertos);
    if (url.endsWith('/comments')) return ok({});
    return ok({ number: 77 });
  };
  return { llamadas, fetchFn };
}

test('sin issue abierto con ese título: crea uno con la etiqueta y la URL del run', async () => {
  const { llamadas, fetchFn } = api([{ number: 5, title: 'otro título' }]);
  const r = await avisar({ env, titulo: 'Falla: staging', detalle: 'job staging', fetchFn, ahora });
  assert.deepEqual(r, { accion: 'creado', numero: 77 });
  const crear = llamadas.at(-1);
  assert.equal(crear.metodo, 'POST');
  assert.match(crear.url, /\/repos\/org\/repo\/issues$/);
  assert.deepEqual(crear.cuerpo.labels, ['alerta-ci']);
  assert.match(crear.cuerpo.body, /actions\/runs\/42/);
  assert.match(crear.cuerpo.body, /Detalle: job staging/);
  assert.equal(crear.cabeceras.Authorization, 'Bearer ghs_token_de_prueba');
});

test('con un issue abierto del mismo título: comenta en vez de duplicar', async () => {
  const { llamadas, fetchFn } = api([{ number: 9, title: 'Falla: staging' }]);
  const r = await avisar({ env, titulo: 'Falla: staging', fetchFn, ahora });
  assert.deepEqual(r, { accion: 'comentado', numero: 9 });
  assert.match(llamadas.at(-1).url, /issues\/9\/comments$/);
  assert.equal(llamadas.filter((l) => l.metodo === 'POST').length, 1);
});

test('un pull request con el mismo título no cuenta como issue existente', async () => {
  const { fetchFn } = api([{ number: 3, title: 'Falla: staging', pull_request: {} }]);
  assert.equal((await avisar({ env, titulo: 'Falla: staging', fetchFn, ahora })).accion, 'creado');
});

test('entradas inválidas y errores de la API', async () => {
  const { fetchFn } = api([]);
  await assert.rejects(avisar({ env: { ...env, GITHUB_TOKEN: '' }, titulo: 't', fetchFn }), /Faltan GITHUB_TOKEN/);
  await assert.rejects(avisar({ env: { ...env, GITHUB_REPOSITORY: 'sin-barra' }, titulo: 't', fetchFn }), /Faltan GITHUB_TOKEN/);
  await assert.rejects(avisar({ env, titulo: '', fetchFn }), /--titulo/);
  await assert.rejects(avisar({ env, titulo: 'x'.repeat(201), fetchFn }), /--titulo/);
  await avisar({ env, titulo: 'x'.repeat(200), fetchFn, ahora });
  const falla = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(avisar({ env, titulo: 't', fetchFn: falla }), (e) => /HTTP 403/.test(e.message) && !e.message.includes('ghs_token'));
});

test('el cuerpo no incluye el token y sin run id lo dice', () => {
  const c = cuerpoDelAviso({ detalle: '', urlRun: '(sin run)', ahora });
  assert.match(c, /\(sin run\)/);
  assert.doesNotMatch(c, /Detalle/);
});
