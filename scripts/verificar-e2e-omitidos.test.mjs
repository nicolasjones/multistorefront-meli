import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluar, evaluarRequeridos, parsearPermitidos, parsearRequeridos, resumenMarkdown, resumir } from './verificar-e2e-omitidos.mjs';

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

test('recupera el motivo del omitido desde las anotaciones del reporte', () => {
  const conMotivo = { suites: [{ file: 'a.e2e.ts', specs: [{ title: 't', tests: [{ status: 'skipped', annotations: [{ type: 'skip', description: 'sin Edge' }] }] }, { title: 'u', tests: [{ status: 'expected' }] }] }] };
  const { omitidos } = resumir(conMotivo);
  assert.equal(omitidos[0].motivo, 'sin Edge');
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

const conTitulo = (archivo, titulo, status) => ({ title: titulo, file: archivo, tests: [{ status }] });
const reporteDe = (...specs) => ({ suites: [{ file: 'x', suites: [{ title: 'd', specs }] }] });
const PERMITIDOS = parsearPermitidos('cuenta-web-cliente.e2e.ts::SC-006');

test('--permitidos: solo pasa si el omitido es EXACTAMENTE el esperado (mutación: --max=1 solo toleraba cualquiera)', () => {
  const sc006 = conTitulo('apps/web/e2e/cuenta-web-cliente.e2e.ts', 'recuperar responde igual con y sin cuenta (SC-006)', 'skipped');
  const corrido = conTitulo('apps/web/e2e/otro.e2e.ts', 'corre', 'expected');
  assert.equal(evaluar(reporteDe(corrido, sc006), 1, PERMITIDOS).ok, true);
  // Otro spec omitido por un entorno roto: con el tope solo pasaba; con --permitidos falla.
  const otro = conTitulo('apps/web/e2e/tienda-checkout.e2e.ts', 'compra (SC-006)', 'skipped');
  assert.equal(evaluar(reporteDe(corrido, otro), 1).ok, true, 'sin --permitidos el tope global lo toleraba');
  const r = evaluar(reporteDe(corrido, otro), 1, PERMITIDOS);
  assert.equal(r.ok, false);
  assert.match(r.mensaje, /no son los permitidos/);
  // Mismo archivo pero otro test de ese archivo omitido: tampoco.
  assert.equal(evaluar(reporteDe(corrido, conTitulo('apps/web/e2e/cuenta-web-cliente.e2e.ts', 'ingreso (SC-005)', 'skipped')), 1, PERMITIDOS).ok, false);
  // Sin omitidos con --permitidos: pasa (el omitido es opcional; --max y --requeridos regulan lo demás).
  assert.equal(evaluar(reporteDe(corrido), 1, PERMITIDOS).ok, true);
  // Se siguen respetando el tope y el caso de nada corrido.
  assert.equal(evaluar(reporteDe(corrido, sc006, conTitulo('apps/web/e2e/cuenta-web-cliente.e2e.ts', 'otro (SC-006)', 'skipped')), 1, PERMITIDOS).ok, false);
});

test('--permitidos rechaza valores sin título, vacíos o con espacios en el archivo', async () => {
  assert.deepEqual(parsearPermitidos('a.e2e.ts::SC-006,b.e2e.ts::robots.txt'), [{ archivo: 'a.e2e.ts', titulo: 'SC-006' }, { archivo: 'b.e2e.ts', titulo: 'robots.txt' }]);
  for (const malo of ['', 'a.e2e.ts', 'a.e2e.ts::', '::SC-006', 'a b.e2e.ts::x', 'a.e2e.ts::x,']) assert.throws(() => parsearPermitidos(malo), /--permitidos inválido/, JSON.stringify(malo));
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const archivo = join(mkdtempSync(join(tmpdir(), 'e2e-')), 'r.json');
  writeFileSync(archivo, JSON.stringify(reporteDe(conTitulo('a.e2e.ts', 'ok', 'expected'), conTitulo('b.e2e.ts', 'x (SC-006)', 'skipped'))));
  assert.equal(spawnSync(process.execPath, ['scripts/verificar-e2e-omitidos.mjs', archivo, '--max=1', '--permitidos=b.e2e.ts::SC-006'], { encoding: 'utf8' }).status, 0);
  const ajeno = spawnSync(process.execPath, ['scripts/verificar-e2e-omitidos.mjs', archivo, '--max=1', '--permitidos=c.e2e.ts::SC-006'], { encoding: 'utf8' });
  assert.equal(ajeno.status, 1);
  assert.match(ajeno.stderr, /no son los permitidos/);
  assert.equal(spawnSync(process.execPath, ['scripts/verificar-e2e-omitidos.mjs', archivo, '--permitidos='], { encoding: 'utf8' }).status, 2);
});
