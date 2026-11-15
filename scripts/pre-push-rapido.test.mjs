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
test('un cambio de supabase fuera de migraciones y pruebas no corre nada local', () => {
  assert.deepEqual(comandos(['supabase/config.toml']), []);
});
test('una migración, un pgTAP o un E2E corren solo las trampas conocidas', () => {
  const esperado = [['node', ['scripts/verificar-trampas-conocidas.mjs']]];
  assert.deepEqual(comandos(['supabase/migrations/1_x.sql']), esperado);
  assert.deepEqual(comandos(['supabase/tests/database/x.test.sql']), esperado);
});
test('un cambio en pantallas de apps/web/src/pages corre además el guard de estilos sueltos', () => {
  assert.deepEqual(comandos(['apps/web/src/pages/x/Pantalla.tsx']).at(-1), ['pnpm', ['estilos:check']]);
  assert.ok(!comandos(['apps/web/src/lib/a.ts']).some(([, a]) => a.includes('estilos:check')));
});
