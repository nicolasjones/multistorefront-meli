import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const script = path.join(import.meta.dirname, 'demo-sandbox.mjs');
const correr = (url, args = []) => {
  const env = { PATH: process.env.PATH, SUPABASE_URL: url };
  return spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' });
};

describe('demo-sandbox (MSF-587)', () => {
  it('al abortar por un host no local imprime el origen y el host, no el constructor URL', () => {
    const r = correr('https://prod.ejemplo.test:443');
    assert.equal(r.status, 1);
    // El puerto por omisión (443) se normaliza: el origen es https://prod.ejemplo.test.
    assert.match(r.stderr, /https:\/\/prod\.ejemplo\.test no es un Supabase local \(prod\.ejemplo\.test\)/);
    assert.doesNotMatch(r.stderr, /native code/);
  });

  it('con una URL inválida aborta con el host vacío', () => {
    const r = correr('no-es-una-url');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /\(URL inválida\) no es un Supabase local \(\)/);
  });

  it('no filtra usuario, clave ni ruta de la URL al abortar', () => {
    const r = correr('https://admin:s3cr3t@prod.ejemplo.test:8443/rest/v1?apikey=tok3n');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /https:\/\/prod\.ejemplo\.test:8443 no es un Supabase local/);
    for (const secreto of ['admin', 's3cr3t', 'tok3n', '/rest/v1']) assert.ok(!r.stderr.includes(secreto), r.stderr);
  });

  it('en dry-run contra un host local no toca la red, sale 0 y tampoco filtra la clave', () => {
    const r = correr('http://u:p4ss@127.0.0.1:54321/x', ['--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Supabase: http:\/\/127\.0\.0\.1:54321\n/);
    assert.ok(!r.stdout.includes('p4ss'));
  });
});
