// MSF-369 · F-OPS-03 (FR-022, FR-023): el error del worker lleva EJECUCION_ID; sin DSN es un no-op.
import assert from 'node:assert/strict';
import test from 'node:test';
import { capturarError, crearEvento, leerDsn } from '../../workers/_comun/errores.mjs';

const DSN = 'https://abc123@errores.example.com/3';

test('el evento adjunta EJECUCION_ID, el worker, ambiente y versión', () => {
  const evento = crearEvento(new Error('boom'), {
    worker: 'historial-importador',
    env: { EJECUCION_ID: 'e-1', ERRORES_AMBIENTE: 'staging', ERRORES_VERSION: '1.0.0' },
  });
  assert.equal(evento.tags.EJECUCION_ID, 'e-1');
  assert.equal(evento.tags.worker, 'historial-importador');
  assert.equal(evento.environment, 'staging');
  assert.equal(evento.release, '1.0.0');
});

test('limpia correos, teléfonos, tokens y credenciales de URL del mensaje', () => {
  const evento = crearEvento(new Error('ana@example.com +54 11 5555-1234 Bearer abc postgres://u:clave@db/x'), { worker: 'w', env: {} });
  const texto = JSON.stringify(evento);
  assert.doesNotMatch(texto, /ana@example|5555|Bearer abc|u:clave/);
});

test('con DSN envía el evento una vez', async () => {
  const llamadas = [];
  const ok = await capturarError(new Error('boom'), {
    worker: 'w', env: { ERRORES_DSN: DSN, EJECUCION_ID: 'e-2' }, enviar: async (url, cuerpo) => { llamadas.push([url, cuerpo]); },
  });
  assert.equal(ok, true);
  assert.equal(llamadas.length, 1);
  assert.match(llamadas[0][0], /^https:\/\/errores\.example\.com\/api\/3\/store\//);
  assert.equal(JSON.parse(llamadas[0][1]).tags.EJECUCION_ID, 'e-2');
});

test('sin DSN no envía nada y no falla', async () => {
  let llamadas = 0;
  const ok = await capturarError(new Error('boom'), { worker: 'w', env: {}, enviar: async () => { llamadas += 1; } });
  assert.equal(ok, false);
  assert.equal(llamadas, 0);
  assert.equal(leerDsn(''), null);
});

test('un fallo del envío no lanza', async () => {
  const ok = await capturarError(new Error('boom'), { worker: 'w', env: { ERRORES_DSN: DSN }, enviar: async () => { throw new Error('red'); } });
  assert.equal(ok, false);
});

test('el evento lleva la organización como tag (solo su id) y descarta valores que no son UUID', () => {
  const org = '3f2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6b';
  assert.equal(crearEvento(new Error('x'), { worker: 'w', env: { ORGANIZACION_ID: org } }).tags.organizacion_id, org);
  assert.equal(crearEvento(new Error('x'), { worker: 'w', env: { ORGANIZACION_ID: 'ana@example.com' } }).tags.organizacion_id, 'sin_organizacion');
  assert.equal(crearEvento(new Error('x'), { worker: 'w', env: {} }).tags.organizacion_id, 'sin_organizacion');
});
