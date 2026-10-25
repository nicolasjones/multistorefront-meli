import assert from 'node:assert/strict';
import { test } from 'node:test';
import { argsClipDeImagen, argsConcat, comentarioEpica, comentarioHistoria, hijoDelItem, htmlTarjeta, planEpica, textoItem, tituloTest } from './armar-video-evidencia.mjs';

const manifiesto = {
  run_id: '1',
  fecha: '2026-10-25T01:58:34.128Z',
  evidencias: [
    { epica: 'MSF-136', epicaNombre: 'Stock', componente: 'Stock', spec: 'specs/x', specTitulo: 'Stock · Stock movimientos', items: [{ id: 'T021', texto: '[Transversal][—] E2E de stock `SC-001`' }], test: 'a', estado: 'pasado', video: '1/a.webm' },
    { epica: 'MSF-136', epicaNombre: 'Stock', componente: 'Stock', spec: 'specs/x', specTitulo: 'Stock · Stock movimientos', items: [{ id: 'T021', texto: 'x' }], test: 'b', estado: 'fallido', video: '1/b.webm' },
    { epica: 'MSF-136', items: [{ id: 'T022' }], test: 'c', estado: 'pasado', video: null },
    { epica: 'MSF-119', items: [{ id: 'T020' }], test: 'd', estado: 'pasado', video: '1/d.webm' },
  ],
  sin_cubrir: [{ epica: 'MSF-136', id: 'T023' }, { epica: 'MSF-119', id: 'T001' }],
};

test('textoItem saca las etiquetas y el código', () => {
  assert.equal(textoItem('[Transversal][—] E2E de stock `SC-001`'), 'E2E de stock SC-001');
  assert.equal(textoItem('Primera idea. Segunda que sobra'), 'Primera idea');
});

test('planEpica agrupa por ítem, cuenta pasados y ignora lo sin video', () => {
  const plan = planEpica(manifiesto, 'MSF-136');
  assert.equal(plan.nombre, 'Stock movimientos');
  assert.equal(plan.tests, 2);
  assert.equal(plan.pasados, 1);
  assert.equal(plan.sinCubrir, 1);
  assert.deepEqual(plan.historias.map((h) => [h.id, h.tests.length]), [['T021', 2]]);
  assert.equal(planEpica(manifiesto, 'MSF-999'), null);
});

test('tituloTest saca archivo y etiqueta', () => {
  assert.equal(tituloTest('stock.e2e.ts Stock [MSF-136:T021] entrada 10 y salida 4'), 'entrada 10 y salida 4');
  assert.equal(tituloTest('sin etiqueta'), 'sin etiqueta');
});

test('htmlTarjeta escapa el texto y arma las dos tarjetas de un test', () => {
  const plan = planEpica(manifiesto, 'MSF-136');
  const datos = { id: 'T021', texto: 'E2E', titulo: '<b>x</b>', estado: 'pasado', n: 1, de: 2 };
  assert.match(htmlTarjeta('historia', plan, datos), /Funcionalidad 1 de 2/);
  assert.match(htmlTarjeta('historia', plan, datos), /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(htmlTarjeta('cierre', plan, datos), /Probado, no prometido/);
  assert.match(htmlTarjeta('cierre', plan, { ...datos, estado: 'fallido' }), /La prueba falló/);
});

test('hijoDelItem busca el Txxx completo en el título', () => {
  const hijos = [{ id: 1, title: 'F-STK-02' }, { id: 2, title: '[Cierre MSF-136] Última fase (T020, T021, T022)' }];
  assert.equal(hijoDelItem(hijos, 'T021').id, 2);
  assert.equal(hijoDelItem(hijos, 'T02'), undefined);
  assert.equal(hijoDelItem(hijos, 'T099'), undefined);
});

test('los argumentos de ffmpeg normalizan a 1920x1080 con audio mudo', () => {
  assert.ok(argsClipDeImagen('a.png', 4, 'o.mp4').join(' ').includes('scale=1920:1080'));
  assert.deepEqual(argsConcat('l.txt', 'o.mp4').slice(-2), ['+faststart', 'o.mp4']);
});

test('los comentarios listan un link por video, la épica agrupada por historia', () => {
  const filas = [
    { id: 'T021', texto: 'E2E', titulo: 'entrada 10', estado: 'pasado', url: 'http://x/1.mp4', issue: 'MSF-516' },
    { id: 'T021', texto: 'E2E', titulo: 'salida 5', estado: 'fallido', url: 'http://x/2.mp4', issue: 'MSF-516' },
  ];
  const historia = comentarioHistoria('T021', filas);
  assert.match(historia, /✅ entrada 10 → \[ver video\]\(http:\/\/x\/1\.mp4\)/);
  assert.match(historia, /❌ salida 5/);
  const epica = comentarioEpica('MSF-136', filas, '2026-10-25');
  assert.equal(epica.match(/\*\*T021\*\*/g).length, 1);
  assert.match(epica, /MSF-516/);
  assert.match(epica, /ver video\]\(http:\/\/x\/2\.mp4\)/);
});
