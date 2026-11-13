// Spec 022, T006: el manifiesto cruza reporte Playwright × tasks.md × videos.
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { expandirRangos, extraerCriterios, extraerEtiquetas, generarManifiesto, leerCriterios, leerItems, mapaEpicaSpec } from './cobertura-e2e.mjs';

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

  it('expande rangos y extrae criterios [F-XXX-NN#…] del título', () => {
    assert.deepEqual(expandirRangos('1-3, 5'), [1, 2, 3, 5]);
    assert.deepEqual(extraerCriterios('x [F-STK-02#1-2,4] y'), [{ historia: 'F-STK-02', numeros: [1, 2, 4] }]);
    assert.deepEqual(extraerCriterios('[MSF-119:T020] sin criterios'), []);
  });

  it('lee los escenarios numerados de cada historia del spec', () => {
    const base = mkdtempSync(join(tmpdir(), 'criterios-'));
    const spec = join(base, 'spec.md');
    writeFileSync(spec, [
      '### User Story 1 - Registrar un movimiento (F-STK-02, P0, talla M)', '', '**Acceptance Scenarios**:', '',
      '1. **Given** stock 0, **When** entra 10, **Then** hay 10.', '2. **Given** stock 10, **When** sale 4, **Then** hay 6.', '',
      '### User Story 2 - Historial (F-STK-03, P0)', '', '1. **Given** movimientos, **When** abre, **Then** los ve.', '',
      '## Requirements', '1. no es un escenario',
    ].join('\n'));
    const mapa = leerCriterios(spec);
    assert.equal(mapa.get('F-STK-02').titulo, 'Registrar un movimiento');
    assert.deepEqual(mapa.get('F-STK-02').map((c) => c.n), [1, 2]);
    assert.match(mapa.get('F-STK-02')[1].texto, /^Given stock 10, When sale 4, Then hay 6\.$/);
    assert.deepEqual(mapa.get('F-STK-03').map((c) => c.n), [1]);
  });

  it('un test con criterios genera evidencia por historia y avisa los escenarios sin cubrir', () => {
    const { base, dirSpecs, dirResults } = armarFixture();
    writeFileSync(join(dirSpecs, 'spec-acceso', 'spec.md'), [
      '**Componente**: Stock', '', '**Jira Epic**: MSF-136 — Stock', '',
      '### User Story 1 - Registrar (F-STK-02, P0)', '',
      '1. **Given** a, **When** b, **Then** c.', '2. **Given** d, **When** e, **Then** f.', '3. **Given** g, **When** h, **Then** i.',
    ].join('\n'));
    const reporte = join(base, 'criterios.json');
    writeFileSync(reporte, JSON.stringify({ suites: [{ title: 's', specs: [{ title: 't', file: 'e2e/s.e2e.ts', tests: [
      { title: '[F-STK-02#1-2] registrar', results: [{ status: 'passed', attachments: [{ name: 'video', contentType: 'video/webm', path: join(dirResults, 'v.webm') }] }] },
      { title: '[F-STK-99#1] historia inexistente', results: [{ status: 'passed', attachments: [] }] },
    ] }] }] }));
    const m = generarManifiesto({ reporte, dirResults, dirSpecs, runId: 'r3', modo: 'on' });
    assert.equal(m.evidencias.length, 1);
    assert.equal(m.evidencias[0].epica, 'MSF-136');
    assert.equal(m.evidencias[0].historia, 'F-STK-02');
    assert.deepEqual(m.evidencias[0].criterios.map((c) => c.n), [1, 2]);
    assert.deepEqual(m.criterios_sin_cubrir.map((c) => [c.historia, c.n]), [['F-STK-02', 3]]);
    assert.ok(m.huerfanos.some((h) => /F-STK-99/.test(h.motivo)));
  });
});

// Un test sin resultados (omitido/skipped en el reporte) NO es 'pasado': el ensamblador después pedía
// un video que nunca existió y fallaba todo el lote.
describe('generarManifiesto: estado de un test sin resultados', () => {
  it('lo marca como omitido (no como pasado)', () => {
    const base = mkdtempSync(join(tmpdir(), 'cobertura-omit-'));
    const dirSpecs = join(base, 'specs');
    const dirResults = join(base, 'test-results');
    mkdirSync(join(dirSpecs, 'spec-acceso'), { recursive: true });
    mkdirSync(dirResults, { recursive: true });
    writeFileSync(join(dirSpecs, 'spec-acceso', 'spec.md'), '**Componente**: Acceso\n\n**Jira Epic**: MSF-119 — Acceso\n');
    writeFileSync(join(dirSpecs, 'spec-acceso', 'tasks.md'), '- [ ] T020 E2E de ingreso\n');
    const reporte = join(base, 'report.json');
    writeFileSync(reporte, JSON.stringify({
      suites: [{
        title: 'acceso',
        specs: [{
          title: 'publico', file: 'e2e/a.e2e.ts',
          tests: [{ title: '[MSF-119:T020] ruta protegida lleva al ingreso', results: [] }],
        }],
      }],
    }));
    const m = generarManifiesto({ reporte, dirResultados: dirResults, dirSpecs });
    assert.equal(m.evidencias.length, 1);
    assert.equal(m.evidencias[0].estado, 'omitido');
  });
});
