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

// --- MSF-703 / MSF-704: pools de runners separados ---

const PR = "${{ fromJSON(vars.CI_RUNS_ON_PR || '[\"self-hosted\",\"platform-local\"]') }}";
const DEPLOY = "${{ fromJSON(vars.CI_RUNS_ON_DEPLOY || '[\"self-hosted\",\"platform-local\"]') }}";
const workflow = ({ disparo = 'push', runsOn = PR, environment = '', extra = '' }) => `on:
  ${disparo}:
jobs:
  a:
    runs-on: ${runsOn}
    timeout-minutes: 5
${environment ? `    environment: ${environment}\n` : ''}${extra}    steps:
      - run: echo
`;

test('pools: un job de PR en el pool de PR y un deploy en el de deploy pasan', () => {
  assert.deepEqual(analizar('w.yml', workflow({})), []);
  assert.deepEqual(analizar('w.yml', workflow({ runsOn: DEPLOY, environment: 'produccion' })), []);
  assert.deepEqual(analizar('w.yml', workflow({ disparo: 'pull_request' })), []);
  assert.deepEqual(analizar('w.yml', workflow({ runsOn: 'ubuntu-latest' })), [], 'un runner hospedado por GitHub no entra en esta regla');
});

test('pools: cada mutante falla por UNA razón', () => {
  const casos = [
    [workflow({ runsOn: '[self-hosted, platform-local]' }), /fija la etiqueta self-hosted a mano/],
    [workflow({ runsOn: '[self-hosted, platform-deploy]', environment: 'p' }), /nombra platform-deploy a mano/],
    [workflow({ environment: 'produccion' }), /usa un environment.*pool de deploy/],
    [workflow({ runsOn: DEPLOY }), /usa el pool de deploy sin environment/],
    [workflow({ disparo: 'pull_request', runsOn: DEPLOY, environment: 'p' }), /workflow disparado por pull_request/],
    [workflow({ disparo: 'pull_request_target', runsOn: DEPLOY, environment: 'p' }), /workflow disparado por pull_request/],
    [workflow({ extra: '    # release\n' }).replace('steps:\n      - run: echo', `steps:\n      - uses: googleapis/release-please-action@${SHA} # v4`), /publica un release/],
  ];
  for (const [yml, motivo] of casos) {
    const h = analizar('w.yml', yml);
    // Algunos mutantes rompen dos reglas a la vez (etiqueta a mano Y pool equivocado): basta con que aparezca el motivo propio.
    assert.ok(h.some((x) => motivo.test(x)), `${motivo}: ${JSON.stringify(h)}`);
  }
});

test('pools: la variable de PESADO también es válida y un job reutilizable no se evalúa', () => {
  assert.deepEqual(analizar('w.yml', workflow({ runsOn: "${{ fromJSON(vars.CI_RUNS_ON_PESADO || '[\"self-hosted\"]') }}" })), []);
  assert.deepEqual(analizar('w.yml', 'on:\n  push:\njobs:\n  llamar:\n    uses: ./.github/workflows/x.yml\n    environment: p\n'), []);
});
