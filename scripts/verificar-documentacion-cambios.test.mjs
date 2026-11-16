import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

const script = path.resolve('scripts/verificar-documentacion-cambios.mjs');
let dir;

const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });

// Repo temporal con un commit base y un segundo commit que escribe `archivos`.
const comprobar = async (nombre, archivos) => {
  const cwd = path.join(dir, nombre);
  await mkdir(cwd, { recursive: true });
  git(cwd, 'init', '-q');
  await writeFile(path.join(cwd, 'base.txt'), 'base');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-q', '-m', 'base');
  for (const archivo of archivos) {
    await mkdir(path.dirname(path.join(cwd, archivo)), { recursive: true });
    await writeFile(path.join(cwd, archivo), 'x');
  }
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-q', '-m', 'cambio');
  const env = { ...process.env, DOCUMENTATION_CHECK_BASE: 'HEAD~1' };
  delete env.GITHUB_BASE_REF;
  return spawnSync('node', [script], { cwd, env, encoding: 'utf8' });
};

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'docs-check-'));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('verificar-documentacion-cambios', () => {
  it('acepta .specify/bugs/<slug>/ como documentación de un bug-fix', async () => {
    const r = await comprobar('bugs', ['scripts/a.mjs', '.specify/bugs/msf-1/fix.md']);
    assert.equal(r.status, 0, r.stderr);
  });

  it('acepta la constitución en .specify/memory/', async () => {
    const r = await comprobar('memory', ['scripts/a.mjs', '.specify/memory/constitution.md']);
    assert.equal(r.status, 0, r.stderr);
  });

  it('rechaza plantillas o scripts de .specify/ como documentación', async () => {
    const r = await comprobar('plantilla', ['scripts/a.mjs', '.specify/templates/spec-template.md', '.specify/scripts/x.sh']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Fallo de documentación/);
  });

  it('rechaza código de tooling sin documentación', async () => {
    const r = await comprobar('sin-docs', ['scripts/a.mjs']);
    assert.equal(r.status, 1);
  });
});
