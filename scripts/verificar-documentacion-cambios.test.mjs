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
const comprobar = async (nombre, archivos, { env: extra = {}, args = [], base: baseFiles = {} } = {}) => {
  const cwd = path.join(dir, nombre);
  await mkdir(cwd, { recursive: true });
  git(cwd, 'init', '-q');
  await writeFile(path.join(cwd, 'base.txt'), 'base');
  for (const [archivo, texto] of Object.entries(baseFiles)) {
    await mkdir(path.dirname(path.join(cwd, archivo)), { recursive: true });
    await writeFile(path.join(cwd, archivo), texto);
  }
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-q', '-m', 'base');
  for (const archivo of archivos) {
    await mkdir(path.dirname(path.join(cwd, archivo)), { recursive: true });
    await writeFile(path.join(cwd, archivo), 'x');
  }
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-q', '-m', 'cambio');
  const env = { ...process.env, DOCUMENTATION_CHECK_BASE: 'HEAD~1', ...extra };
  delete env.GITHUB_BASE_REF;
  return spawnSync('node', [script, ...args], { cwd, env, encoding: 'utf8' });
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

  describe('correspondencia código-doc (MSF-869)', () => {
    const doc = '---\nowner: x\nsources:\n  - scripts/a.mjs\n  - apps/web/src/lib\n---\n# Doc\n';
    const base = { 'docs/a.md': doc, 'scripts/a.mjs': 'v0' };

    it('sin aviso si se toca el doc que corresponde al código', async () => {
      const r = await comprobar('corr-ok', ['scripts/a.mjs', 'docs/a.md'], { base });
      assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(r.stderr, /::warning/);
    });

    it('avisa (exit 0) si el doc cambiado no es el que corresponde', async () => {
      const r = await comprobar('corr-aviso', ['scripts/a.mjs', 'docs/otro.md'], { base });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stderr, /::warning file=docs\/a\.md::/);
      assert.match(r.stderr, /scripts\/a\.mjs/);
    });

    it('avisa también para archivos dentro de un directorio de sources', async () => {
      const r = await comprobar('corr-dir', ['apps/web/src/lib/x.ts', 'specs/s/spec.md'], { base });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stderr, /::warning file=docs\/a\.md::/);
    });

    it('modo estricto (variable o --estricto) falla con exit 1', async () => {
      const a = await comprobar('corr-estricto-env', ['scripts/a.mjs', 'docs/otro.md'], { base, env: { DOCUMENTACION_CORRESPONDENCIA_ESTRICTA: '1' } });
      assert.equal(a.status, 1);
      assert.match(a.stderr, /::error file=docs\/a\.md::/);
      const b = await comprobar('corr-estricto-flag', ['scripts/a.mjs', 'docs/otro.md'], { base, args: ['--estricto'] });
      assert.equal(b.status, 1);
    });

    it('sin aviso si el archivo no figura en ningún sources:, o es un test', async () => {
      const r = await comprobar('corr-sin-asignar', ['scripts/b.mjs', 'scripts/a.test.mjs', 'docs/otro.md'], { base });
      assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(r.stderr, /::warning/);
    });

    it('el comportamiento heredado se mantiene: sin ningún doc falla aun en modo aviso', async () => {
      const r = await comprobar('corr-heredado', ['scripts/a.mjs'], { base });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /Fallo de documentación/);
    });
  });
});
