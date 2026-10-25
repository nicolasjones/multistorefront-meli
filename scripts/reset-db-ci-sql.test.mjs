import assert from 'node:assert/strict';
import test from 'node:test';
import { ESQUEMAS_STACK, sqlReset } from './reset-db-ci-sql.mjs';

test('el LIKE de esquemas del sistema escapa el guion bajo', () => {
  assert.match(sqlReset(), /not like 'pg\\_%'/);
  assert.doesNotMatch(sqlReset(), /not like 'pg_%'/);
});

test('el reset nunca excluye esquemas de la aplicación ni los lista como del stack', () => {
  for (const esquema of ['public', 'private', 'dominio', 'analitica']) {
    assert.ok(!ESQUEMAS_STACK.includes(esquema), `${esquema} no puede ser del stack`);
  }
  assert.match(sqlReset(), /nspname not in \('auth', /);
});

test('el reset deja el rol de Superset nologin sin contraseña, sin drop owned ni drop role', () => {
  assert.match(sqlReset(), /alter role superset_analitica with nologin password null;/);
  assert.doesNotMatch(sqlReset(), /drop owned|drop role/);
});
