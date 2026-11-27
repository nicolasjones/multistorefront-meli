import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const script = path.resolve('scripts/demo-sandbox.mjs');
const correr = (url, args = []) => {
  const env = { PATH: process.env.PATH, SUPABASE_URL: url };
  return spawnSync('node', [script, ...args], { env, encoding: 'utf8' });
};

describe('demo-sandbox (MSF-587)', () => {
  it('al abortar por un host no local imprime el host y la URL, no el constructor URL', () => {
    const r = correr('https://prod.ejemplo.test:443');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /https:\/\/prod\.ejemplo\.test:443 no es un Supabase local \(prod\.ejemplo\.test\)/);
    assert.doesNotMatch(r.stderr, /native code/);
  });

  it('con una URL inválida aborta con el host vacío', () => {
    const r = correr('no-es-una-url');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no-es-una-url no es un Supabase local \(\)/);
  });

  it('en dry-run contra un host local no toca la red y sale 0', () => {
    const r = correr('http://127.0.0.1:54321', ['--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Supabase: http:\/\/127\.0\.0\.1:54321/);
  });
});
