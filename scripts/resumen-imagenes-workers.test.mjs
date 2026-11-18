import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resumen } from './resumen-imagenes-workers.mjs';

const DIGEST = `ghcr.io/org/repo-worker-historial@sha256:${'a'.repeat(64)}`;

test('el resumen lista las referencias en un bloque de código y rechaza las mutables o vacías', () => {
  const md = resumen(`${DIGEST}\n`);
  assert.match(md, /^### Imágenes de workers publicadas/);
  assert.match(md, /```\nghcr\.io\/org\/repo-worker-historial@sha256:a{64}\n```/);
  assert.throws(() => resumen(''), /ninguna imagen/);
  for (const mala of ['ghcr.io/o/r:latest', 'ghcr.io/o/r', `ghcr.io/o/r:${'b'.repeat(40)}`, 'ghcr.io/o/r@sha256:abc']) {
    assert.throws(() => resumen(`${DIGEST}\n${mala}`), /no son inmutables/, mala);
  }
});

test('el CLI funciona y worker-images.yml lo usa y valida el digest antes de publicarlo (PR, sin correr en main)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'img-'));
  const archivo = path.join(dir, 'imagenes.txt');
  writeFileSync(archivo, `${DIGEST}\n`);
  const ok = spawnSync(process.execPath, ['scripts/resumen-imagenes-workers.mjs', archivo], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  writeFileSync(archivo, 'ghcr.io/o/r:latest\n');
  assert.equal(spawnSync(process.execPath, ['scripts/resumen-imagenes-workers.mjs', archivo], { encoding: 'utf8' }).status, 1);

  const wf = readFileSync('.github/workflows/worker-images.yml', 'utf8');
  assert.match(wf, /node scripts\/resumen-imagenes-workers\.mjs "\$RUNNER_TEMP\/worker-imagenes\.txt" >> "\$GITHUB_STEP_SUMMARY"/);
  assert.match(wf, /imagetools inspect "\$image:\$SHA" --format '\{\{ \.Manifest\.Digest \}\}'/);
  // El case que valida el digest acepta `sha256:` + 64 caracteres y rechaza el resto.
  const patron = wf.match(/case "\$digest" in (sha256:\?+)\)/)[1];
  assert.equal(patron.length, 'sha256:'.length + 64);
  const prueba = (d) => spawnSync('sh', ['-c', `case "$1" in ${patron}) exit 0 ;; *) exit 1 ;; esac`, 'sh', d]).status === 0;
  assert.equal(prueba(`sha256:${'f'.repeat(64)}`), true);
  assert.equal(prueba(`sha256:${'f'.repeat(63)}`), false);
});
