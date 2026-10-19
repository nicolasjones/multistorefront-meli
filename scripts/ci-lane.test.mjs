import { mkdtemp, mkdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { cargaExcedida, carrilesEnUso, intentarCarriles } from './ci-lane.mjs';

let dir;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ci-lane-'));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('intentarCarriles', () => {
  it('toma hasta N carriles y después devuelve null (no oversuscribe)', async () => {
    const base = path.join(dir, 'toma');
    assert.equal(await intentarCarriles({ dir: base, nombre: 'ci', carriles: 3, ahora: Date.now }), 0);
    assert.equal(await intentarCarriles({ dir: base, nombre: 'ci', carriles: 3, ahora: Date.now }), 1);
    assert.equal(await intentarCarriles({ dir: base, nombre: 'ci', carriles: 3, ahora: Date.now }), 2);
    assert.equal(await intentarCarriles({ dir: base, nombre: 'ci', carriles: 3, ahora: Date.now }), null);
    assert.equal(await carrilesEnUso({ dir: base, nombre: 'ci' }), 3);

    await rm(path.join(base, 'ci-1'), { recursive: true, force: true });
    assert.equal(await carrilesEnUso({ dir: base, nombre: 'ci' }), 2);
    assert.equal(await intentarCarriles({ dir: base, nombre: 'ci', carriles: 3, ahora: Date.now }), 1);
  });

  it('con 0 carriles no reserva nada (admisión apagada)', async () => {
    assert.equal(await intentarCarriles({ dir: path.join(dir, 'apagada'), nombre: 'ci', carriles: 0 }), null);
  });

  it('recicla un carril vencido de un job muerto', async () => {
    const base = path.join(dir, 'vencido');
    const lock = path.join(base, 'ci-0');
    await mkdir(lock, { recursive: true });
    const viejo = new Date(Date.now() - 2 * 3600_000);
    await utimes(lock, viejo, viejo);

    // TTL de 1 min: el lock de hace 2 h queda vencido y se recicla.
    assert.equal(await intentarCarriles({ dir: base, nombre: 'ci', carriles: 1, ttlMs: 60_000, ahora: Date.now }), 0);
  });

  it('no recicla un carril vivo', async () => {
    const base = path.join(dir, 'vivo');
    await mkdir(path.join(base, 'ci-0'), { recursive: true });
    assert.equal(await intentarCarriles({ dir: base, nombre: 'ci', carriles: 1, ttlMs: 60_000, ahora: Date.now }), null);
  });
});

describe('cargaExcedida', () => {
  it('con factor 0 está apagado', () => {
    assert.equal(cargaExcedida({ load: 100, nucleos: 4, factor: 0 }), false);
  });
  it('marca exceso cuando load > núcleos × factor', () => {
    assert.equal(cargaExcedida({ load: 4.5, nucleos: 4, factor: 1 }), true);
    assert.equal(cargaExcedida({ load: 3.9, nucleos: 4, factor: 1 }), false);
    assert.equal(cargaExcedida({ load: 7.5, nucleos: 4, factor: 2 }), false);
    assert.equal(cargaExcedida({ load: 8.1, nucleos: 4, factor: 2 }), true);
  });
});
