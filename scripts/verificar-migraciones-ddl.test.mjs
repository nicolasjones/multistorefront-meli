// Test de integración del guard de migraciones (`scripts/verificar-migraciones.mjs`): arma una
// migración sintética en un repo git temporal y comprueba el CÓDIGO DE SALIDA del script.
// Es lo que MSF-682 rompe: el guard decía "Migraciones OK" (exit 0) con `ADD COLUMN` escrito en
// una línea aparte, y esa clase de falla (una aplicación parcial traba el reintento) es la que
// el guard tiene que impedir.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const GUARD = path.join(aqui, 'verificar-migraciones.mjs');

// El guard lee el índice de git (`git ls-files`) y el contenido con `git show :archivo`, y
// compara contra una base: con una base inexistente TODOS los archivos se revisan.
const correrGuard = (sql, archivo = '20260101000000_sintetica.sql') => {
  const dir = mkdtempSync(path.join(tmpdir(), 'guard-migraciones-'));
  try {
    mkdirSync(path.join(dir, 'supabase', 'migrations'), { recursive: true });
    writeFileSync(path.join(dir, 'supabase', 'migrations', archivo), sql);
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '.'], { cwd: dir });
    const r = spawnSync('node', [GUARD, '--base', 'base-inexistente'], { cwd: dir, encoding: 'utf8' });
    return { codigo: r.status, salida: `${r.stdout || ''}${r.stderr || ''}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe('verificar-migraciones (integración)', () => {
  it('falla con ADD COLUMN sin guard en una línea aparte (MSF-682)', () => {
    const r = correrGuard('alter table public.t\n  add column x int;\n');
    assert.equal(r.codigo, 1);
    assert.match(r.salida, /ADD COLUMN sin IF NOT EXISTS/);
    assert.match(r.salida, /:2 /);
  });

  it('falla con ADD COLUMN sin guard en una sola línea', () => {
    const r = correrGuard('alter table public.t add column x int;\n');
    assert.equal(r.codigo, 1);
    assert.match(r.salida, /ADD COLUMN sin IF NOT EXISTS/);
  });

  it('falla cuando la sentencia no arranca al inicio de línea', () => {
    const r = correrGuard('select 1; alter table public.t add column x int;\n');
    assert.equal(r.codigo, 1);
    assert.match(r.salida, /ADD COLUMN sin IF NOT EXISTS/);
  });

  it('pasa con ADD COLUMN if not exists (una línea o multilínea)', () => {
    assert.equal(correrGuard('alter table public.t add column if not exists x int;\n').codigo, 0);
    assert.equal(correrGuard('alter table public.t\n  add column if not exists x int;\n').codigo, 0);
  });

  it('pasa con SQL dinámico en un cuerpo dollar-quoted', () => {
    const r = correrGuard('execute $q$\n  alter table public.t add column x int\n$q$;\n');
    assert.equal(r.codigo, 0);
    assert.doesNotMatch(r.salida, /ADD COLUMN sin IF NOT EXISTS/);
  });

  it('no marca CREATE INDEX con if not exists en la línea siguiente', () => {
    const r = correrGuard('create index\n  if not exists\n  idx_t_a on public.t (a);\n');
    assert.equal(r.codigo, 0);
    assert.doesNotMatch(r.salida, /CREATE INDEX sin IF NOT EXISTS/);
  });

  it('falla con CREATE INDEX sin guard', () => {
    const r = correrGuard('create index idx_t_a on public.t (a);\n');
    assert.equal(r.codigo, 1);
    assert.match(r.salida, /CREATE INDEX sin IF NOT EXISTS/);
  });
});
