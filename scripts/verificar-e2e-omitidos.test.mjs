import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluar, evaluarRequeridos, parsearRequeridos, resumenMarkdown, resumir } from './verificar-e2e-omitidos.mjs';

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

// MSF-928: los specs que el job DEBE correr no pueden omitirse, aunque el total esté bajo el tope.
const delArchivo = (archivo, ...estados) => ({ file: archivo, suites: [{ title: 'describe', specs: estados.map((e) => ({ title: `t-${e}`, file: archivo, tests: [{ status: e }] })) }] });

test('un spec requerido con tests omitidos o ausente falla; con todo corrido, pasa', () => {
  const informe = { suites: [delArchivo('acceso-publico.e2e.ts', 'expected', 'skipped'), delArchivo('recorrido-publico.e2e.ts', 'expected'), delArchivo('otro.e2e.ts', 'skipped')] };
  assert.deepEqual(evaluarRequeridos(informe, ['recorrido-publico.e2e.ts']), []);
  const problemas = evaluarRequeridos(informe, ['acceso-publico.e2e.ts', 'recorrido-publico.e2e.ts', 'fantasma.e2e.ts']);
  assert.equal(problemas.length, 2);
  assert.match(problemas[0], /acceso-publico\.e2e\.ts: 1 de 2 tests omitidos/);
  assert.match(problemas[1], /fantasma\.e2e\.ts: no aparece/);
});

test('el resumen cuenta los omitidos por archivo para el resumen del job', () => {
  const informe = { suites: [delArchivo('a.e2e.ts', 'expected', 'skipped', 'skipped'), delArchivo('b.e2e.ts', 'expected')] };
  const md = resumenMarkdown(informe);
  assert.match(md, /2 corridos, 2 omitidos de 4/);
  assert.match(md, /`a\.e2e\.ts` \| 1 \| 2/);
  assert.doesNotMatch(md, /b\.e2e\.ts/);
});

test('--requeridos rechaza valores vacíos, comas de más y nombres con espacios; acepta una lista limpia', async () => {
  assert.deepEqual(parsearRequeridos('a.e2e.ts,b.e2e.ts'), ['a.e2e.ts', 'b.e2e.ts']);
  for (const malo of ['', 'a.e2e.ts,', ',a.e2e.ts', 'a.e2e.ts, b.e2e.ts', 'a b.e2e.ts']) {
    assert.throws(() => parsearRequeridos(malo), /--requeridos inválido/, JSON.stringify(malo));
  }
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const archivo = join(mkdtempSync(join(tmpdir(), 'e2e-')), 'r.json');
  writeFileSync(archivo, JSON.stringify(reporte('expected')));
  for (const arg of ['--requeridos=', '--requeridos', '--requeridos=a.e2e.ts, b']) {
    const r = spawnSync(process.execPath, ['scripts/verificar-e2e-omitidos.mjs', archivo, arg], { encoding: 'utf8' });
    assert.equal(r.status, 2, arg);
    assert.match(r.stderr, /--requeridos inválido/);
  }
});
