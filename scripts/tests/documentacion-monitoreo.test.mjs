// MSF-369 · F-OPS-03 (FR-032): docs/monitoreo.md explica qué se mira, umbrales, variables y destino de alertas.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const doc = readFileSync('docs/monitoreo.md', 'utf8');

test('tiene las secciones de umbrales, variables y verificación manual', () => {
  for (const seccion of ['## Qué se mira y dónde', '## Umbrales', '## Qué significa cada alerta', '## Variables', '## Verificación manual de SC-006']) {
    assert.ok(doc.includes(seccion), `falta ${seccion}`);
  }
});

test('nombra los umbrales por defecto y las variables clave', () => {
  assert.match(doc, /5 en 10 minutos/);
  assert.match(doc, /15 minutos/);
  assert.match(doc, /VITE_ERRORES_DSN/);
  assert.match(doc, /ERRORES_DSN/);
  assert.match(doc, /KESTRA_ALERTAS_WEBHOOK_URL/);
});

test('aclara que sin DSN no se envía nada', () => {
  assert.match(doc, /Vacío = no se envía nada/);
});
