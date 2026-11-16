import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluar, resumir } from './verificar-e2e-omitidos.mjs';

const prueba = (status) => ({ title: 't', file: 'a.e2e.ts', tests: [{ status }] });
const reporte = (...estados) => ({ suites: [{ file: 'a.e2e.ts', suites: [{ title: 'describe', specs: estados.map(prueba) }] }] });

test('cuenta pruebas y omitidos recorriendo suites anidadas', () => {
  const { total, omitidos, corridos } = resumir(reporte('expected', 'skipped', 'flaky'));
  assert.deepEqual([total, omitidos.length, corridos], [3, 1, 2]);
});

test('pasa con los omitidos permitidos (mutación: con 0 permitidos falla)', () => {
  assert.equal(evaluar(reporte('expected', 'skipped'), 1).ok, true);
  assert.equal(evaluar(reporte('expected', 'skipped'), 0).ok, false);
});

test('falla ante una omisión masiva aunque Playwright la cuente como éxito', () => {
  const masivo = evaluar(reporte('expected', ...Array(18).fill('skipped')), 1);
  assert.equal(masivo.ok, false);
  assert.match(masivo.mensaje, /18 tests omitidos/);
});

test('falla si no corrió nada o si todo se omitió', () => {
  assert.equal(evaluar({ suites: [] }, 1).ok, false);
  assert.equal(evaluar(reporte('skipped'), 1).ok, false);
});
