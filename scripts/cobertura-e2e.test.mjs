// Spec 022, T006: el manifiesto cruza reporte Playwright × tasks.md × videos.
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { extraerEtiquetas, generarManifiesto, leerItems, mapaEpicaSpec } from './cobertura-e2e.mjs';

function armarFixture() {
  const base = mkdtempSync(join(tmpdir(), 'cobertura-'));
  const dirSpecs = join(base, 'specs');
  const dirResults = join(base, 'test-results');
  mkdirSync(join(dirSpecs, 'spec-acceso'), { recursive: true });
  mkdirSync(dirResults, { recursive: true });
  writeFileSync(join(dirSpecs, 'spec-acceso', 'spec.md'), '**Componente**: Acceso\n\n**Jira Epic**: MSF-119 — Acceso\n');
  writeFileSync(
    join(dirSpecs, 'spec-acceso', 'tasks.md'),
    '- [x] T020 E2E de ingreso y recuperación\n- [ ] T021 Pendiente sin E2E\n',
  );
  const reporte = join(base, 'report.json');
  writeFileSync(reporte, JSON.stringify({
    suites: [{
      title: 'acceso',
      specs: [
        {
          title: 'publico', file: 'e2e/a.e2e.ts',
          tests: [{
            title: '[MSF-119:T020] ruta protegida lleva al ingreso',
            results: [{ status: 'passed', attachments: [{ name: 'video', contentType: 'video/webm', path: join(dirResults, 't1', 'video.webm') }] }],
          }],
        },
        {
          title: 'suelto', file: 'e2e/a.e2e.ts',
          tests: [{ title: 'test sin etiqueta', results: [{ status: 'passed', attachments: [] }] }],
        },
        {
          title: 'typo', file: 'e2e/a.e2e.ts',
          tests: [{ title: '[MSF-119:T999] ítem inexistente', results: [{ status: 'passed', attachments: [] }] }],
        },
      ],
    }],
  }));
  return { base, dirSpecs, dirResults, reporte };
}

describe('cobertura-e2e', () => {
  it('extrae etiquetas [EPICA:TASK] simples y múltiples', () => {
    assert.deepEqual(extraerEtiquetas('[MSF-136:T021] texto'), [{ epica: 'MSF-136', items: ['T021'] }]);
    assert.deepEqual(extraerEtiquetas('[MSF-119:T020, T021] texto'), [{ epica: 'MSF-119', items: ['T020', 'T021'] }]);
    assert.deepEqual(extraerEtiquetas('sin etiqueta'), []);
  });

  it('resuelve épica a spec y lee items con su estado', () => {
    const { dirSpecs } = armarFixture();
    const mapa = mapaEpicaSpec(dirSpecs);
    assert.equal(mapa.get('MSF-119').nombre, 'Acceso')
    assert.deepEqual(mapa.get('MSF-119').specs, [
      { dir: join(dirSpecs, 'spec-acceso'), titulo: 'spec-acceso', componente: 'Acceso' },
    ]);
    assert.deepEqual(leerItems(join(dirSpecs, 'spec-acceso', 'tasks.md')), [
      { id: 'T020', hecho: true, texto: 'E2E de ingreso y recuperación' },
      { id: 'T021', hecho: false, texto: 'Pendiente sin E2E' },
    ]);
  });

  it('genera evidencias con video, huérfanos y sin cubrir', () => {
    const { dirSpecs, dirResults, reporte } = armarFixture();
    const m = generarManifiesto({ reporte, dirResults, dirSpecs, runId: 'r1', modo: 'on' });
    assert.equal(m.evidencias.length, 1);
    assert.equal(m.evidencias[0].epica, 'MSF-119');
    assert.equal(m.evidencias[0].items[0].id, 'T020');
    assert.equal(m.evidencias[0].video, join('t1', 'video.webm'));
    assert.equal(m.evidencias[0].estado, 'pasado');
    assert.equal(m.huerfanos.length, 2); // sin etiqueta + ítem inexistente
    assert.deepEqual(m.sin_cubrir.map((x) => x.id), ['T021']);
    assert.equal(m.evidencias[0].componente, 'Acceso');
    assert.equal(m.sin_cubrir[0].componente, 'Acceso');
  });

  it('marca omitido lo que se salteó por falta de stack', () => {
    const { dirSpecs, dirResults } = armarFixture();
    const reporte = join(dirResults, 'skip.json');
    writeFileSync(reporte, JSON.stringify({
      suites: [{ title: 's', specs: [{ title: 'x', file: 'e2e/x.e2e.ts', tests: [
        { title: '[MSF-119:T020] requiere stack', results: [{ status: 'skipped', attachments: [] }] },
      ] }] }],
    }));
    const m = generarManifiesto({ reporte, dirResults, dirSpecs, runId: 'r2', modo: 'retain' });
    assert.equal(m.evidencias[0].estado, 'omitido');
  });
});
