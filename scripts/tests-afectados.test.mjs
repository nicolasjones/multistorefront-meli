import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { plan, seleccionarSuites } from './tests-afectados.mjs';

describe('seleccionarSuites (determinista)', () => {
  it('un cambio de página web dispara web + e2e + estilos', () => {
    assert.deepEqual(
      seleccionarSuites(['apps/web/src/pages/clientes/list.tsx']),
      ['lint', 'docs', 'estilos', 'web', 'e2e'],
    );
  });

  it('un componente no dispara estilos (sólo páginas) pero sí e2e', () => {
    assert.deepEqual(
      seleccionarSuites(['apps/web/src/components/clientes/FiltroTienda.tsx']),
      ['lint', 'docs', 'web', 'e2e'],
    );
  });

  it('una migración dispara pgTAP + validación de aditivas', () => {
    assert.deepEqual(
      seleccionarSuites(['supabase/migrations/20261018180000_x.sql']),
      ['lint', 'docs', 'db:aditivas', 'db'],
    );
  });

  it('un test pgTAP dispara pgTAP, no la validación de aditivas', () => {
    assert.deepEqual(seleccionarSuites(['supabase/tests/database/x.test.sql']), ['lint', 'docs', 'db']);
  });

  it('una edge function dispara sus tests', () => {
    assert.deepEqual(seleccionarSuites(['supabase/functions/invitar-miembro/index.ts']), ['lint', 'docs', 'edge']);
  });

  it('scripts y workflows disparan tooling', () => {
    assert.deepEqual(seleccionarSuites(['scripts/ci-lane.mjs']), ['lint', 'docs', 'tooling']);
    assert.deepEqual(seleccionarSuites(['.github/workflows/validate.yml']), ['lint', 'docs', 'tooling']);
  });

  it('infra dispara compose + tooling', () => {
    assert.deepEqual(seleccionarSuites(['infra/runner/compose.yaml']), ['lint', 'docs', 'infra:config', 'tooling']);
  });

  it('prototipo y specs disparan sus gates', () => {
    assert.deepEqual(seleccionarSuites(['design/pantallas/Clientes.dc.html']), ['lint', 'docs', 'prototipo']);
    assert.deepEqual(seleccionarSuites(['specs/x/spec.md']), ['lint', 'docs', 'matriz']);
  });

  it('sólo docs corre lo barato', () => {
    assert.deepEqual(seleccionarSuites(['docs/clientes.md']), ['lint', 'docs']);
  });

  it('es determinista: mismo diff, mismo plan y mismo orden', () => {
    const archivos = ['apps/web/src/pages/stock/list.tsx', 'supabase/migrations/x.sql', 'scripts/a.mjs'];
    assert.deepEqual(seleccionarSuites(archivos), seleccionarSuites([...archivos].reverse()));
    assert.deepEqual(plan(archivos).map((p) => p.id), seleccionarSuites(archivos));
  });
});
