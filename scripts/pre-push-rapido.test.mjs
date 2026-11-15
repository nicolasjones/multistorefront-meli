import test from 'node:test';
import assert from 'node:assert/strict';
import { comandos } from './pre-push-rapido.mjs';

test('un cambio de web corre tsc, oxlint y los tests afectados', () => {
  const c = comandos(['apps/web/src/a.ts']);
  assert.equal(c.length, 3);
  assert.ok(c.some(([, a]) => a.includes('vitest') && a.includes('--changed')));
});
test('un cambio solo de docs corre docs:check y nada de web', () => {
  assert.deepEqual(comandos(['docs/x.md']), [['pnpm', ['docs:check']]]);
});
test('un cambio solo de supabase no corre nada local', () => {
  assert.deepEqual(comandos(['supabase/migrations/1.sql']), []);
});
