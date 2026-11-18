import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analizar, analizarDirectorio } from './verificar-workflows.mjs';

const SHA = 'a'.repeat(40);

test('el repo cumple: acciones por SHA con comentario y jobs con timeout (MSF-925, MSF-926)', () => {
  assert.deepEqual(analizarDirectorio('.github/workflows'), []);
});

test('un tag mutable, un SHA sin comentario y un job sin timeout se detectan', () => {
  const yml = `jobs:
  a:
    runs-on: x
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@${SHA}
      - uses: actions/cache@${SHA} # v4
      - uses: ./.github/actions/local
`;
  const h = analizar('w.yml', yml);
  assert.equal(h.length, 3);
  assert.match(h[0], /checkout@v4 no está pineada/);
  assert.match(h[1], /setup-node@a+ no lleva el comentario/);
  assert.match(h[2], /job a no declara timeout-minutes/);
});

test('un job que solo llama a un workflow reutilizable no necesita timeout-minutes', () => {
  const yml = `jobs:
  migraciones:
    uses: ./.github/workflows/migraciones-cloud.yml
    secrets: inherit
`;
  assert.deepEqual(analizar('w.yml', yml), []);
});
