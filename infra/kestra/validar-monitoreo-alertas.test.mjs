// Contrato estático del flow monitoreo-evaluar (MSF-369, F-OPS-03, FR-029, FR-030): umbrales como inputs
// (5 / 10 min / 15 min) y notificación de cada alerta nueva por el subflow `alertas` (tipo tecnica), sin
// modificarlo y sin secretos ni detalle del error en el webhook.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FLOW = 'infra/kestra/flows/monitoreo-evaluar.yml';
const leer = async () => (await readFile(FLOW, 'utf8'))
  .split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');

test('los umbrales son inputs con los valores de la épica', async () => {
  const content = await leer();
  assert.match(content, /- id: ventana_min\n\s+type: INT\n\s+defaults: 10/);
  assert.match(content, /- id: fallos\n\s+type: INT\n\s+defaults: 5/);
  assert.match(content, /- id: cola_min\n\s+type: INT\n\s+defaults: 15/);
});

test('evalúa con public.evaluar_monitoreo usando los inputs', async () => {
  const content = await leer();
  assert.match(content, /public\.evaluar_monitoreo\(/);
  assert.match(content, /ventana: "\{\{ inputs\.ventana_min \}\}"/);
  assert.match(content, /fallos: "\{\{ inputs\.fallos \}\}"/);
  assert.match(content, /cola: "\{\{ inputs\.cola_min \}\}"/);
  assert.match(content, /cron: "\*\/2 \* \* \* \*"/);
});

test('notifica por el subflow alertas existente con tipo tecnica y motivo fijo', async () => {
  const content = await leer();
  assert.match(content, /namespace: platform\.alertas/);
  assert.match(content, /flowId: alertas/);
  assert.match(content, /tipo: tecnica/);
  assert.match(content, /motivo_sanitizado: FALLA_TECNICA_SANITIZADA/);
  assert.doesNotMatch(content, /motivo_sanitizado: "\{\{/, 'el detalle no viaja al webhook');
});

test('sin organización no se pasa el input vacío al subflow y no hay secretos literales', async () => {
  const content = await leer();
  assert.match(content, /organizacion_id is not null/);
  assert.doesNotMatch(content, /password: "(?!\{\{)/);
  assert.doesNotMatch(content, /secret\(/, 'el flow no necesita secretos propios');
});

test('marca la alerta como notificada solo después de enviarla y propaga el fallo del envío', async () => {
  const content = await leer();
  assert.match(content, /select alerta_id, fuente, clave/);
  assert.match(content, /public\.marcar_alerta_notificada\(CAST\(NULLIF\(:alerta_id, ''\) AS uuid\)\)/);
  assert.doesNotMatch(content, /transmitFailed: false/, 'un envío fallido debe dejar la alerta pendiente');
  assert.ok(content.indexOf('id: marcar_notificada') > content.indexOf('id: alertar_sin_organizacion'), 'marca después de enviar');
});
