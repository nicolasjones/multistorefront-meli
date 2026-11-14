import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { verificarContrato } from './verificar-e2e-nocturno.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const WORKFLOW = '.github/workflows/e2e-nocturno.yml';
const DOC = 'docs/e2e-app.md';
const workflow = readFileSync(join(RAIZ, WORKFLOW), 'utf8');
const docs = readFileSync(join(RAIZ, DOC), 'utf8');

function fixture(t, cambios = {}) {
  const raiz = mkdtempSync(join(tmpdir(), 'e2e-nocturno-'));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  mkdirSync(join(raiz, '.github/workflows'), { recursive: true });
  mkdirSync(join(raiz, 'docs'), { recursive: true });
  writeFileSync(join(raiz, WORKFLOW), cambios.workflow ?? workflow);
  writeFileSync(join(raiz, DOC), cambios.docs ?? docs);
  return raiz;
}

const fallaYCambio = (t, cambios, motivo) => {
  const raiz = fixture(t, cambios);
  const resultado = verificarContrato(raiz);
  assert.equal(resultado.ok, false, `debió fallar: ${motivo}`);
  assert.ok(resultado.errores.length > 0, `debió explicar el fallo: ${motivo}`);
  return resultado;
};

test('el repo cumple el contrato del E2E nocturno', () => {
  assert.deepEqual(verificarContrato(RAIZ), { ok: true, errores: [] });
});

test('falla si desaparece el cron diario (mutación: cambia la hora)', (t) => {
  assert.notEqual(workflow.replace("cron: '0 5 * * *'", "cron: '0 6 * * *'"), workflow);
  fallaYCambio(t, { workflow: workflow.replace("cron: '0 5 * * *'", "cron: '0 6 * * *'") }, 'cron');
});

test('falla si desaparece el disparo manual', (t) => {
  const mutado = workflow.replace(/^ {2}workflow_dispatch:\s*$/m, '');
  assert.notEqual(mutado, workflow);
  fallaYCambio(t, { workflow: mutado }, 'workflow_dispatch');
});

test('falla si el job pasa a bloquear PRs', (t) => {
  const mutado = workflow.replace(/^on:\s*$/m, 'on:\n  pull_request:');
  assert.notEqual(mutado, workflow);
  fallaYCambio(t, { workflow: mutado }, 'pull_request');
});

test('falla si el job puede dispararse con pull_request_target', (t) => {
  const mutado = workflow.replace(/^on:\s*$/m, 'on:\n  pull_request_target:');
  assert.notEqual(mutado, workflow);
  fallaYCambio(t, { workflow: mutado }, 'pull_request_target');
});

test('falla si el kill switch del job se invierte (el job no correría nunca)', (t) => {
  const mutado = workflow.replace("vars.CI_E2E_NOCTURNO != 'false'", "vars.CI_E2E_NOCTURNO == 'false'");
  assert.notEqual(mutado, workflow);
  fallaYCambio(t, { workflow: mutado }, 'kill switch');
});

test('falla si el job pierde la condición del kill switch', (t) => {
  const mutado = workflow.replace(
    /^(\s*)if: \$\{\{ vars\.CI_PAUSED != 'true' && vars\.CI_E2E_NOCTURNO != 'false' \}\}$/m,
    '$1if: false',
  );
  assert.notEqual(mutado, workflow);
  fallaYCambio(t, { workflow: mutado }, 'kill switch');
});

test('falla si los permisos dejan de ser de solo lectura', (t) => {
  const mutado = workflow.replace(/^( {2}contents:) read$/m, '$1 write');
  assert.notEqual(mutado, workflow);
  fallaYCambio(t, { workflow: mutado }, 'contents');
});

test('falla si el cron deja de probar dokploy', (t) => {
  const mutado = workflow.replace("'schedule' && 'dokploy'", "'schedule' && 'main'");
  assert.notEqual(mutado, workflow);
  fallaYCambio(t, { workflow: mutado }, 'checkout de dokploy');
});

test('falla si la suite deja de correr en serie', (t) => {
  const mutado = workflow.replace('--workers=1', '--workers=2');
  assert.notEqual(mutado, workflow);
  fallaYCambio(t, { workflow: mutado }, 'workers');
});

test('falla si el job deja de levantar la base real o migrarla', (t) => {
  const sinStack = workflow.replace(/^(\s*)supabase start\b/m, '$1echo sin stack');
  assert.notEqual(sinStack, workflow);
  fallaYCambio(t, { workflow: sinStack }, 'supabase start');
  const sinMigrar = workflow.replace(/^(\s*)supabase migration up\b/m, '$1echo sin migrar');
  assert.notEqual(sinMigrar, workflow);
  fallaYCambio(t, { workflow: sinMigrar }, 'supabase migration up');
});

test('falla si desaparece la guarda contra omisiones masivas del resumen', (t) => {
  const mutado = workflow.replace('omitidos.length * 2 > filas.length', 'false');
  assert.notEqual(mutado, workflow);
  fallaYCambio(t, { workflow: mutado }, 'guarda contra omisiones masivas');
});

test('falla si la documentación deja de describir el nocturno', (t) => {
  const sinSeccion = docs.replace('## E2E nocturno', '## Otro');
  assert.notEqual(sinSeccion, docs);
  fallaYCambio(t, { docs: sinSeccion }, 'sección');
  const sinRuta = docs.replaceAll(WORKFLOW, 'otro.yml');
  assert.notEqual(sinRuta, docs);
  fallaYCambio(t, { docs: sinRuta }, 'ruta del workflow');
});

test('falla si falta el workflow o la documentación', (t) => {
  const raiz = fixture(t);
  rmSync(join(raiz, WORKFLOW));
  assert.equal(verificarContrato(raiz).ok, false);
  rmSync(join(raiz, DOC));
  assert.equal(verificarContrato(raiz).ok, false);
});
