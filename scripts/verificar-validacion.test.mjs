import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JOBS_VALIDACION, evaluar } from './verificar-validacion.mjs';

const todos = (resultado, excepciones = {}) => Object.fromEntries(JOBS_VALIDACION.map((j) => [j, { result: excepciones[j] ?? resultado }]));
const base = { evento: 'push', repoOrigen: '', repo: 'o/r', ciPausado: '', e2eTiendaBloquea: 'false' };

test('todo success o skipped es OK', () => {
  assert.equal(evaluar({ ...base, needs: todos('success') }).ok, true);
  assert.equal(evaluar({ ...base, needs: todos('skipped', { changes: 'success' }) }).ok, true);
});

test('un failure falla y se informa primero; los cancelados se listan aparte', () => {
  const r = evaluar({ ...base, needs: todos('success', { web: 'failure', database: 'cancelled' }) });
  assert.equal(r.ok, false);
  assert.match(r.mensajes.join('\n'), /Fallaron: web\. Además cancelados: database\./);
});

test('un cancelled sin ninguna falla falla con un mensaje propio (la corrida no cuenta como validada)', () => {
  const r = evaluar({ ...base, needs: todos('success', { web: 'cancelled' }) });
  assert.equal(r.ok, false);
  assert.match(r.mensajes.join('\n'), /Cancelados sin ninguna falla: web/);
});

test('e2e-tienda no bloquea mientras E2E_TIENDA_BLOQUEA no sea true, ni siquiera cancelado', () => {
  for (const resultado of ['failure', 'cancelled']) {
    const r = evaluar({ ...base, needs: todos('success', { 'e2e-tienda': resultado }) });
    assert.equal(r.ok, true, resultado);
    assert.match(r.mensajes.join('\n'), /no es bloqueante/);
  }
  assert.equal(evaluar({ ...base, e2eTiendaBloquea: 'true', needs: todos('success', { 'e2e-tienda': 'cancelled' }) }).ok, false);
});

test('un job que no figura en needs no se da por bueno', () => {
  const needs = todos('success');
  delete needs.chequeos;
  const r = evaluar({ ...base, needs });
  assert.equal(r.ok, false);
  assert.match(r.mensajes.join('\n'), /chequeos=sin resultado/);
});

test('PR de un fork o CI pausado no validan', () => {
  assert.equal(evaluar({ ...base, evento: 'pull_request', repoOrigen: 'otro/r', needs: todos('success') }).ok, false);
  assert.equal(evaluar({ ...base, ciPausado: 'true', needs: todos('success') }).ok, false);
});
