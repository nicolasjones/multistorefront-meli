import assert from 'node:assert/strict';
import test from 'node:test';
import { validarPolitica } from './validar-egress-workers.mjs';

const base = () => ({
  version: 1,
  common: { supabase: 'x', vault: 'y', blocked_examples: ['example.com'] },
  workers: {
    sistema: { network: 'worker-egress-sistema', solo_supabase: true, domains: [], workers: ['a'] },
  },
});

test('valida una politica que cubre todos los workers y redes', () => {
  assert.equal(validarPolitica(base(), ['a'], new Set(['sistema'])), 1);
});

test('falla si hay un worker descubierto sin entrada (no pasa en vacio)', () => {
  assert.throws(() => validarPolitica(base(), ['a', 'b']), /sin allowlist.*b/);
  assert.throws(() => validarPolitica({ ...base(), workers: {} }, ['a']), /sin allowlist.*a/);
});

test('falla si un flow referencia una red sin entrada', () => {
  assert.throws(() => validarPolitica(base(), ['a'], new Set(['otra'])), /worker-egress-otra/);
});

test('falla si la politica nombra un worker inexistente', () => {
  const p = base();
  p.workers.sistema.workers = ['a', 'q'];
  assert.throws(() => validarPolitica(p, ['a']), /no existen.*q/);
});

test('exige dominios o solo_supabase, y rechaza destinos denegados', () => {
  const sin = base();
  delete sin.workers.sistema.solo_supabase;
  assert.throws(() => validarPolitica(sin, ['a']), /dominios/);
  const malo = base();
  malo.workers.sistema.domains = ['example.com'];
  assert.throws(() => validarPolitica(malo, ['a']), /denegado/);
});

test('la red debe llamarse worker-egress-<sistema>', () => {
  const p = base();
  p.workers.sistema.network = 'worker-egress-otro';
  assert.throws(() => validarPolitica(p, ['a']), /red de egress/);
});
