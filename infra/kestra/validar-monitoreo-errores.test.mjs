// Contrato estático del flow monitoreo-errores-aplicacion (MSF-369, F-OPS-03, FR-033): cuenta los eventos de
// los últimos 10 minutos en la herramienta de errores y registra el fallo de fuente `aplicacion` al llegar
// a 5. El token de lectura es solo un secreto de Kestra.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FLOW = 'infra/kestra/flows/monitoreo-errores-aplicacion.yml';
const leer = async () => (await readFile(FLOW, 'utf8'))
  .split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');

test('ventana de 10 minutos y umbral de 5 como inputs', async () => {
  const content = await leer();
  assert.match(content, /- id: ventana_min\n\s+type: INT\n\s+defaults: 10/);
  assert.match(content, /- id: umbral\n\s+type: INT\n\s+defaults: 5/);
});

test('consulta la herramienta con el token como secreto de Kestra', async () => {
  const content = await leer();
  assert.match(content, /Authorization: "Bearer \{\{ secret\('ERRORES_APP_TOKEN'\) \}\}"/);
  assert.match(content, /uri: "\{\{ envs\.errores_app_url \}\}/);
  assert.doesNotMatch(content, /Bearer (?!\{\{)/, 'el token no puede ir literal');
});

test('registra fallo u ok de la fuente aplicacion según el umbral', async () => {
  const content = await leer();
  assert.match(content, /public\.registrar_evento_monitoreo\('aplicacion'/);
  assert.match(content, />= inputs\.umbral \? 'fallo' : 'ok'/);
});

test('sin URL configurada el flow no hace nada', async () => {
  const content = await leer();
  assert.match(content, /condition: "\{\{ envs\.errores_app_url is defined and envs\.errores_app_url != '' \}\}"/);
});

test('un fallo del conteo se registra como fallo del monitor y tolera variables ausentes', async () => {
  const content = await leer();
  assert.match(content, /allowFailure: true/);
  assert.match(content, /monitor:\{\{ envs\.errores_app_proyecto \?\? 'aplicacion' \}\}/);
  assert.match(content, /errores_app_organizacion \?\? 'plataforma'/);
  assert.match(content, /\(outputs\.contar_eventos\.code \?\? 0\) != 200/);
});

test('el conteo usa el total real (X-Hits) o una página de al menos el umbral, no la primera página por defecto', async () => {
  const content = await leer();
  assert.match(content, /- id: limite_pagina\n\s+type: INT\n\s+defaults: 100/);
  assert.match(content, /&limit=\{\{ inputs\.limite_pagina > inputs\.umbral \? inputs\.limite_pagina : inputs\.umbral \}\}/);
  assert.match(content, /outputs\.contar_eventos\.headers\['x-hits'\] is defined/);
  assert.match(content, /\(vars\.conteo \| number\) >= inputs\.umbral \? 'fallo' : 'ok'/);
  assert.doesNotMatch(content, /fromJson\(outputs\.contar_eventos\.body\) \| length\) >= inputs\.umbral/, 'no decide con el largo de la primera página');
});
