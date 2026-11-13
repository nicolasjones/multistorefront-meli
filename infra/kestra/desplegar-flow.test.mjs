import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';

const script = path.resolve('infra/kestra/desplegar-flow.mjs');

async function withServer(status, callback, deleteStatus = 200) {
  const methods = [];
  const server = http.createServer((request, response) => {
    methods.push(request.method);
    request.resume();
    if (request.method === 'GET') response.writeHead(status).end();
    else if (request.method === 'DELETE') response.writeHead(deleteStatus).end();
    else response.writeHead(200, { 'content-type': 'application/json' }).end('{"revision":2}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await callback(`http://127.0.0.1:${server.address().port}`, methods); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

function ejecutar(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function run(url) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kestra-flow-'));
  const source = path.join(directory, 'flow.yml');
  await writeFile(source, 'id: prueba\nnamespace: prueba\ntasks: []\n');
  try {
    return await ejecutar(['--source', source, '--namespace', 'prueba', '--flow-id', 'flow', '--kestra-url', url, '--username', 'usuario', '--password', 'valor-de-prueba']);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function runBorrar(url) {
  return await ejecutar(['--borrar', '--namespace', 'platform.consultas', '--flow-id', 'avisos-consultas', '--kestra-url', url, '--username', 'usuario', '--password', 'valor-de-prueba']);
}

async function runRetirar(url, manifiesto) {
  return await ejecutar(['--retirar', '--manifiesto', manifiesto, '--kestra-url', url, '--username', 'usuario', '--password', 'valor-de-prueba']);
}

test('crea un flow cuando la consulta devuelve 404', async () => {
  await withServer(404, async (url, methods) => {
    const result = await run(url);
    assert.equal(result.code, 0);
    assert.deepEqual(methods, ['GET', 'POST']);
  });
});

test('actualiza un flow cuando la consulta devuelve 200', async () => {
  await withServer(200, async (url, methods) => {
    const result = await run(url);
    assert.equal(result.code, 0);
    assert.deepEqual(methods, ['GET', 'PUT']);
  });
});

test('no publica cuando la consulta devuelve un estado inesperado', async () => {
  await withServer(500, async (url, methods) => {
    const result = await run(url);
    assert.notEqual(result.code, 0);
    assert.deepEqual(methods, ['GET']);
    assert.match(result.stderr, /HTTP 500/);
  });
});

test('borra el flow pedido y no publica nada', async () => {
  await withServer(404, async (url, methods) => {
    const result = await runBorrar(url);
    assert.equal(result.code, 0);
    assert.deepEqual(methods, ['DELETE']);
  });
});

test('el retiro es idempotente: un flow ya borrado (404) no falla', async () => {
  await withServer(404, async (url, methods) => {
    const result = await runBorrar(url);
    assert.equal(result.code, 0);
    assert.deepEqual(methods, ['DELETE']);
  }, 404);
});

test('falla cuando Kestra no puede borrar el flow', async () => {
  await withServer(404, async (url, methods) => {
    const result = await runBorrar(url);
    assert.notEqual(result.code, 0);
    assert.deepEqual(methods, ['DELETE']);
    assert.match(result.stderr, /HTTP 500/);
  }, 500);
});

test('borra todos los flows del manifiesto y saltea los comentarios', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kestra-retirados-'));
  const manifiesto = path.join(directory, 'flows-retirados.txt');
  await writeFile(manifiesto, '# comentario\nplatform.consultas/avisos-consultas\n\nplatform.consultas/otro-flow\n');
  try {
    await withServer(404, async (url, methods) => {
      const result = await runRetirar(url, manifiesto);
      assert.equal(result.code, 0);
      assert.deepEqual(methods, ['DELETE', 'DELETE']);
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('falla cuando el manifiesto tiene una línea inválida', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kestra-retirados-'));
  const manifiesto = path.join(directory, 'flows-retirados.txt');
  await writeFile(manifiesto, 'sin-namespace\n');
  try {
    await withServer(404, async (url, methods) => {
      const result = await runRetirar(url, manifiesto);
      assert.notEqual(result.code, 0);
      assert.deepEqual(methods, []);
      assert.match(result.stderr, /manifiesto de flows retirados/);
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
