// MSF-907: la regla única de los runners de evidencia.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { codigoHistoria, leerItems, leerItemsDesdeTexto, motivoDescripcion, textoSinEtiquetas } from './historia-item.mjs';

const TASKS = [
  '- [x] T001 [F-EMP-03][US1] Migración aditiva `dominio.empresas` (FR-001)',
  '- [ ] T002 [P] [F-EMP-03][US1] pgTAP de aislamiento',
  '  - Nota: corre dentro de la transacción de prueba.',
  '- [ ] T003 [P] Crear el hook `useOrganizacionActiva` en',
  '  `apps/web/src/hooks/useOrganizacionActiva.ts`.',
  '- [ ] T004 [P] [US1]',
  '',
  '## Fase 2',
  '',
  '- [ ] T005 E2E de la pantalla de empresas',
].join('\n');

test('lee el código de historia en cualquier posición del texto', () => {
  assert.equal(codigoHistoria('[P] [F-EMP-03][US1] pgTAP'), 'F-EMP-03');
  assert.equal(codigoHistoria('[F-EMP-03][US1] pgTAP'), 'F-EMP-03');
  assert.equal(codigoHistoria('sin código'), '');
});

test('el texto del ítem incluye las líneas de continuación', () => {
  const items = leerItemsDesdeTexto(TASKS);
  assert.equal(items.length, 5);
  assert.equal(items[1].texto, '[P] [F-EMP-03][US1] pgTAP de aislamiento - Nota: corre dentro de la transacción de prueba.');
  assert.equal(items[2].texto, '[P] Crear el hook `useOrganizacionActiva` en `apps/web/src/hooks/useOrganizacionActiva.ts`.');
  assert.equal(items[2].historia, '');
  assert.equal(items[4].id, 'T005');
});

test('cada ítem dice si su descripción alcanza y por qué no', () => {
  const items = leerItemsDesdeTexto(TASKS);
  assert.equal(items[0].motivo, ''); // texto + historia: el runner deriva los criterios
  assert.equal(items[1].motivo, '');
  assert.equal(items[2].motivo, 'sin historia'); // texto, pero no dice a qué historia pertenece
  assert.equal(items[3].motivo, 'sin texto'); // sólo etiquetas: no hay nada que describir
  assert.equal(items[4].motivo, 'sin historia');
  assert.equal(motivoDescripcion('[P] [F-EMP-03][US1] algo'), '');
});

test('el texto sin etiquetas es lo que se muestra y lo que se deriva', () => {
  assert.equal(textoSinEtiquetas('[P] [F-EMP-03][US1] E2E de stock `SC-001`'), 'E2E de stock SC-001');
  assert.equal(textoSinEtiquetas('[P] [F-EMP-03][US1]'), '');
});

test('leerItems lee el tasks.md del disco con la misma regla', () => {
  const base = mkdtempSync(join(tmpdir(), 'historia-item-'));
  const ruta = join(base, 'tasks.md');
  writeFileSync(ruta, TASKS);
  assert.deepEqual(leerItems(ruta).map((i) => [i.id, i.hecho, i.historia, i.motivo]), [
    ['T001', true, 'F-EMP-03', ''],
    ['T002', false, 'F-EMP-03', ''],
    ['T003', false, '', 'sin historia'],
    ['T004', false, '', 'sin texto'],
    ['T005', false, '', 'sin historia'],
  ]);
  assert.deepEqual(leerItems(join(base, 'no-existe.md')), []);
});
