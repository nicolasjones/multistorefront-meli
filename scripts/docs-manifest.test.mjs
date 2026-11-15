// MSF-950: `sourceAt` del manifest no depende de HEAD (en el CI es el merge efímero del PR).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const script = path.resolve(import.meta.dirname, 'docs-manifest.mjs');

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'docs-manifest-'));
  git(dir, 'init', '-q');
  mkdirSync(path.join(dir, 'docs'));
  mkdirSync(path.join(dir, 'src'));
  writeFileSync(path.join(dir, 'docs/a.md'), '---\nowner: producto\nsources:\n  - src\n---\n# A\n');
  writeFileSync(path.join(dir, 'src/x.txt'), 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'inicial');
  return dir;
}

function manifest(dir) {
  rmSync(path.join(dir, 'docs/manifest.json'), { force: true });
  const r = spawnSync('node', [script], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return JSON.parse(readFileSync(path.join(dir, 'docs/manifest.json'), 'utf8')).pages['docs/a.md'];
}

test('sourceAt es el último commit propio de la página y no HEAD (con commits posteriores ajenos)', () => {
  const dir = repo();
  try {
    const propio = git(dir, 'log', '-1', '--format=%h', '--', 'docs/a.md');
    writeFileSync(path.join(dir, 'otro.txt'), 'otro\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'commit ajeno a la página');
    const head = git(dir, 'rev-parse', '--short', 'HEAD');
    assert.notEqual(head, propio);
    const pagina = manifest(dir);
    assert.equal(pagina.sourceAt, propio);
    assert.notEqual(pagina.sourceAt, head);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('un archivo agregado a la fuente después de sourceAt no cambia sourceHash (D-4)', () => {
  const dir = repo();
  try {
    const antes = manifest(dir);
    writeFileSync(path.join(dir, 'src/y.txt'), 'nuevo\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'agrega un archivo a la fuente');
    const despues = manifest(dir);
    assert.equal(despues.sourceAt, antes.sourceAt);
    assert.equal(despues.sourceHash, antes.sourceHash);
    // Cambiar un archivo que ya existía en sourceAt, en cambio, sí cambia el hash.
    writeFileSync(path.join(dir, 'src/x.txt'), 'x editado\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'edita un archivo existente');
    assert.notEqual(manifest(dir).sourceHash, antes.sourceHash);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('dos HEAD distintos con el mismo contenido de la página dan el mismo sourceAt y sourceHash', () => {
  const dir = repo();
  try {
    const antes = manifest(dir);
    // Commit vacío y un merge efímero (como el checkout de un PR en el CI): HEAD cambia, la página no.
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'otro HEAD');
    git(dir, 'checkout', '-q', '-b', 'lateral');
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'lateral');
    git(dir, 'checkout', '-q', '-');
    git(dir, 'merge', '-q', '--no-ff', '-m', 'merge efímero', 'lateral');
    const despues = manifest(dir);
    assert.equal(despues.sourceAt, antes.sourceAt);
    assert.equal(despues.sourceHash, antes.sourceHash);
    assert.equal(despues.commit, antes.commit);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
