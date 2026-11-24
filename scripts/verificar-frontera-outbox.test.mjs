import test from 'node:test';
import assert from 'node:assert/strict';
import { violaFrontera } from './verificar-frontera-outbox.mjs';

test('rechaza una llamada HTTP saliente desde SQL', () => {
  assert.equal(violaFrontera("select net.http_post(url := 'https://x.test');"), true);
  assert.equal(violaFrontera('perform http_get($1);'), true);
  assert.equal(violaFrontera('create extension pg_net;'), true);
});

test('rechaza un webhook en SQL ejecutable', () => {
  assert.equal(violaFrontera("select enviar_webhook('x');\nselect 'webhook';"), true);
});

test('un comentario de SQL o de línea que nombra un webhook no es una llamada saliente', () => {
  assert.equal(violaFrontera("comment on function public.f(text) is 'valida el destino de un webhook';"), false);
  assert.equal(violaFrontera("comment on table public.t is 'it''s un webhook; sin envío';"), false);
  assert.equal(violaFrontera('-- usa un webhook\nselect 1;'), false);
});

test('un comentario de SQL no esconde una llamada saliente que va después', () => {
  assert.equal(violaFrontera("comment on table public.t is 'ok';\nselect net.http_get('x');"), true);
});
