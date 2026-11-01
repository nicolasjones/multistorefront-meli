import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const script = path.resolve('scripts/verificar-migraciones.mjs');
const SQL = 'select 1;\n';

// Repo git temporal: `origin/dokploy` con las versiones `enBase` y el árbol con `nuevas` agregadas.
function conRepo(enBase, nuevas, callback) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'verif-migr-'));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  try {
    git('init', '-q');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    mkdirSync(path.join(dir, 'supabase/migrations'), { recursive: true });
    for (const v of enBase) writeFileSync(path.join(dir, `supabase/migrations/${v}_base.sql`), SQL);
    git('add', '.');
    git('commit', '-qm', 'base');
    git('update-ref', 'refs/remotes/origin/dokploy', 'HEAD');
    for (const v of nuevas) writeFileSync(path.join(dir, `supabase/migrations/${v}_nueva.sql`), SQL);
    git('add', '.');
    callback(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const correr = (cwd, args = [], env = {}) => {
  const e = { ...process.env, ...env };
  delete e.GITHUB_BASE_REF;
  if (env.GITHUB_BASE_REF) e.GITHUB_BASE_REF = env.GITHUB_BASE_REF;
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', env: e });
};

test('versión nueva bajo la máxima de dokploy: aviso, no error, fuera de un PR', () => {
  conRepo(['20270121110303'], ['20270115100200'], (dir) => {
    const r = correr(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /se acomoda al integrar la épica/);
  });
});

test('con --estricto la misma versión es error REUSADA', () => {
  conRepo(['20270121110303'], ['20270115100200'], (dir) => {
    const r = correr(dir, ['--estricto']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /REUSADA/);
  });
});

test('en un PR hacia dokploy (GITHUB_BASE_REF) es error', () => {
  conRepo(['20270121110303'], ['20270115100200'], (dir) => {
    const r = correr(dir, [], { GITHUB_BASE_REF: 'dokploy' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /REUSADA/);
  });
});

test('versión mayor que la máxima de la base pasa limpia', () => {
  conRepo(['20270115100200'], ['20270121110303'], (dir) => {
    const r = correr(dir, ['--estricto']);
    assert.equal(r.status, 0, r.stderr);
  });
});

test('versión duplicada en el árbol sigue siendo error', () => {
  conRepo(['20270101000000'], [], (dir) => {
    writeFileSync(path.join(dir, 'supabase/migrations/20270201000000_a.sql'), SQL);
    writeFileSync(path.join(dir, 'supabase/migrations/20270201000000_b.sql'), SQL);
    spawnSync('git', ['add', '.'], { cwd: dir });
    const r = correr(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /versión duplicada/);
  });
});

test('versión existente en la base con otro contenido sigue siendo error', () => {
  conRepo(['20270101000000'], [], (dir) => {
    writeFileSync(path.join(dir, 'supabase/migrations/20270101000000_base.sql'), 'select 2;\n');
    spawnSync('git', ['add', '.'], { cwd: dir });
    const r = correr(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /MODIFICADA/);
  });
});

test('base de una rama de épica (no integración): el orden es error', () => {
  conRepo(['20270121110303'], ['20270115100200'], (dir) => {
    spawnSync('git', ['update-ref', 'refs/remotes/origin/epic', 'refs/remotes/origin/dokploy'], { cwd: dir });
    const r = correr(dir, ['--base', 'origin/epic']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /REUSADA/);
  });
});
