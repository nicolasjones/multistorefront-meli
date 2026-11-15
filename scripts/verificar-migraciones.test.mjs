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

// Rama del PR que quedó ATRÁS de la punta de `origin/dokploy`: la base renumeró una
// migración y la rama la heredó sin tocar (MSF-749). El fixture deja tres archivos en la
// base: uno que la base renumera (y que además NO tiene guard de idempotencia), otro que
// la base no toca y uno con nombre inválido (heredado).
function conRamaAtras(callback) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'verif-migr-'));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  const escribir = (nombre, contenido = SQL) => writeFileSync(path.join(dir, 'supabase/migrations', nombre), contenido);
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    mkdirSync(path.join(dir, 'supabase/migrations'), { recursive: true });
    // Sin guard de idempotencia: la base la renumera, la rama la hereda sin tocar.
    escribir('20270121120000_vieja.sql', 'alter table t add column x int;\n');
    escribir('20270308100000_otra.sql');
    escribir('20270101000000.sql'); // nombre inválido, heredado
    git('add', '.');
    git('commit', '-qm', 'base');
    git('branch', 'rama'); // la rama del PR queda en el commit de la base
    git('checkout', '-q', 'main');
    git('mv', 'supabase/migrations/20270121120000_vieja.sql', 'supabase/migrations/20270201200127_nueva.sql');
    git('commit', '-qm', 'renumerada');
    git('update-ref', 'refs/remotes/origin/dokploy', 'HEAD');
    git('checkout', '-q', 'rama');
    callback({ dir, escribir, git });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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

test('un archivo de migración sin nombre es error: el CLI y el cron lo ignorarían', () => {
  conRepo(['20270115100200'], [], (dir) => {
    writeFileSync(path.join(dir, 'supabase/migrations/20270121110303.sql'), SQL);
    spawnSync('git', ['add', '.'], { cwd: dir });
    const r = correr(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /nombre inválido supabase\/migrations\/20270121110303\.sql/);
  });
});

test('renombrar una migración sin nombre ya publicada (mismo contenido) no es versión reusada ni migración nueva', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'verif-migr-'));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  try {
    git('init', '-q');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    mkdirSync(path.join(dir, 'supabase/migrations'), { recursive: true });
    writeFileSync(path.join(dir, 'supabase/migrations/20270201000000_base.sql'), SQL);
    // Publicada sin nombre y con DDL que la revisión de idempotencia rechazaría si la tomara por nueva.
    writeFileSync(path.join(dir, 'supabase/migrations/20270202200501.sql'), 'alter table t add column x int;\n');
    git('add', '.');
    git('commit', '-qm', 'base');
    git('update-ref', 'refs/remotes/origin/dokploy', 'HEAD');
    git('mv', 'supabase/migrations/20270202200501.sql', 'supabase/migrations/20270202200501_con_nombre.sql');
    for (const extra of [[], ['--estricto']]) {
      const r = correr(dir, extra, { GITHUB_BASE_REF: 'dokploy' });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /0 nuevo\(s\)/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('renombrar un archivo sin nombre Y cambiarle el contenido sigue siendo error (versión inmutable)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'verif-migr-'));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  try {
    git('init', '-q');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    mkdirSync(path.join(dir, 'supabase/migrations'), { recursive: true });
    writeFileSync(path.join(dir, 'supabase/migrations/20270202200501.sql'), SQL);
    git('add', '.');
    git('commit', '-qm', 'base');
    git('update-ref', 'refs/remotes/origin/dokploy', 'HEAD');
    git('mv', 'supabase/migrations/20270202200501.sql', 'supabase/migrations/20270202200501_con_nombre.sql');
    writeFileSync(path.join(dir, 'supabase/migrations/20270202200501_con_nombre.sql'), 'select 2;\n');
    git('add', '.');
    const r = correr(dir, [], { GITHUB_BASE_REF: 'dokploy' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /MODIFICADA/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

// --- MSF-749: el guard juzga las migraciones PROPIAS de la rama (desde el punto de
// divergencia), no el árbol entero: una base que renumera migraciones no puede hacer
// fallar un PR que no las tocó.

test('rama atrás de la base (la base renumeró una migración) sin tocar migraciones: no falla', () => {
  conRamaAtras(({ dir }) => {
    const r = correr(dir, [], { GITHUB_BASE_REF: 'dokploy' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /renumeró o quitó 1 migración\(es\)/);
  });
});

test('rama atrás que agrega su propia migración con versión reusada: sigue fallando', () => {
  conRamaAtras(({ dir, escribir, git }) => {
    escribir('20270201000000_mia.sql');
    git('add', '.');
    const r = correr(dir, [], { GITHUB_BASE_REF: 'dokploy' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /REUSADA/);
    assert.match(r.stderr, /20270201000000_mia\.sql/);
  });
});

test('rama atrás que modifica una migración publicada: sigue siendo MODIFICADA', () => {
  conRamaAtras(({ dir, escribir, git }) => {
    escribir('20270308100000_otra.sql', 'select 2;\n');
    git('add', '.');
    const r = correr(dir, [], { GITHUB_BASE_REF: 'dokploy' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /MODIFICADA/);
  });
});

test('migración heredada de la base sin guard de idempotencia: no se revisa (no es nueva de la rama)', () => {
  conRamaAtras(({ dir }) => {
    const r = correr(dir, [], { GITHUB_BASE_REF: 'dokploy' });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /add column/);
  });
});

test('rama atrás que agrega dos archivos con la misma versión: sigue siendo duplicado', () => {
  conRamaAtras(({ dir, escribir, git }) => {
    escribir('20270320000000_a.sql');
    escribir('20270320000000_b.sql');
    git('add', '.');
    const r = correr(dir, [], { GITHUB_BASE_REF: 'dokploy' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /versión duplicada 20270320000000/);
  });
});

test('nombre inválido: el de la rama es error y el heredado no culpa a la rama', () => {
  conRamaAtras(({ dir, escribir, git }) => {
    escribir('20270320000000.sql');
    git('add', '.');
    const r = correr(dir, [], { GITHUB_BASE_REF: 'dokploy' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /nombre inválido supabase\/migrations\/20270320000000\.sql/);
    assert.doesNotMatch(r.stderr, /20270101000000\.sql/);
  });
});

test('sin ancestro común con la base (clone superficial): cae a HEAD~1 y no se rompe', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'verif-migr-'));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    mkdirSync(path.join(dir, 'supabase/migrations'), { recursive: true });
    writeFileSync(path.join(dir, 'supabase/migrations/20270121120000_base.sql'), SQL);
    git('add', '.');
    git('commit', '-qm', 'base');
    writeFileSync(path.join(dir, 'supabase/migrations/20270320000000_nueva.sql'), SQL);
    git('add', '.');
    git('commit', '-qm', 'nueva');
    // Una base sin ancestro común (como un clon superficial): `merge-base` no resuelve.
    git('checkout', '-q', '--orphan', 'huerfano');
    rmSync(path.join(dir, 'supabase/migrations'), { recursive: true, force: true });
    writeFileSync(path.join(dir, 'README.md'), 'otra historia\n');
    git('add', '-A');
    git('commit', '-qm', 'huerfano');
    git('update-ref', 'refs/remotes/origin/dokploy', 'HEAD');
    git('checkout', '-q', 'main');
    const r = correr(dir, [], { GITHUB_BASE_REF: 'dokploy' });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /fatal|merge-base/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
