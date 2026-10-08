import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';

const script = path.resolve('infra/kestra/desplegar-flow.mjs');

async function withServer(status, callback) {
  const methods = [];
  const server = http.createServer((request, response) => {
    methods.push(request.method);
    request.resume();
    if (request.method === 'GET') response.writeHead(status).end();
    else response.writeHead(200, { 'content-type': 'application/json' }).end('{"revision":2}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await callback(`http://127.0.0.1:${server.address().port}`, methods); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

async function run(url) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kestra-flow-'));
  const source = path.join(directory, 'flow.yml');
  await writeFile(source, 'id: prueba\nnamespace: prueba\ntasks: []\n');
  try {
    return await new Promise((resolve) => {
      const child = spawn(process.execPath, [script, '--source', source, '--namespace', 'prueba', '--flow-id', 'flow', '--kestra-url', url, '--username', 'usuario', '--password', 'valor-de-prueba'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
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
