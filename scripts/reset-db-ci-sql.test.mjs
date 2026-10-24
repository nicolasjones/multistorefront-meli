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

test('el reset descarta el rol de Superset para que la migración lo cree nologin', () => {
  assert.match(sqlReset(), /drop owned by superset_analitica;\s+drop role superset_analitica;/);
});
