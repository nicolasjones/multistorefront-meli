import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MARCADORES, marcadoresFaltantes, verificar } from './verificar-bundle-tienda-opiniones.mjs';

function bundleFalso(contenido = MARCADORES.map((m) => m.rpc)) {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-opiniones-'));
  fs.mkdirSync(path.join(carpeta, 'assets'));
  fs.writeFileSync(path.join(carpeta, 'assets', 'app-abc123.js'), contenido.join('\n'));
  fs.writeFileSync(path.join(carpeta, 'assets', 'app-abc123.css'), 'body{color:red}');
  return carpeta;
}

test('un bundle con la funcionalidad pasa y no falta ningún marcador', () => {
  const carpeta = bundleFalso();
  assert.deepEqual(marcadoresFaltantes(carpeta), []);
  const resultado = verificar(carpeta);
  assert.equal(resultado.ok, true);
});

test('un bundle viejo (sin la pantalla del panel) falla y dice qué falta', () => {
  const carpeta = bundleFalso(MARCADORES.slice(1).map((m) => m.rpc));
  const resultado = verificar(carpeta);
  assert.equal(resultado.ok, false);
  assert.match(resultado.motivo, /pantalla «Opiniones» del panel/);
  assert.deepEqual(marcadoresFaltantes(carpeta), [MARCADORES[0].rpc]);
});

test('cada marcador es un literal del código del front (no un texto de la pantalla: el copy no rompe el chequeo)', () => {
  const raiz = path.resolve(import.meta.dirname, '..');
  const fuentes = ['apps/web/src/lib/opiniones.ts', 'apps/web/src/lib/tiendaOpiniones.ts']
    .map((archivo) => fs.readFileSync(path.join(raiz, archivo), 'utf8')).join('\n');
  for (const marcador of MARCADORES) {
    assert.ok(fuentes.includes(marcador.rpc), `el marcador «${marcador.rpc}» no aparece en el código del front`);
  }
});

test('sin bundle construidos el chequeo dice que hay que correr el build', () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-vacio-'));
  const resultado = verificar(carpeta);
  assert.equal(resultado.ok, false);
  assert.match(resultado.motivo, /pnpm build/);
});

test('los css no cuentan: los marcadores tienen que estar en el js', () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-css-'));
  fs.mkdirSync(path.join(carpeta, 'assets'));
  fs.writeFileSync(path.join(carpeta, 'assets', 'app-abc123.css'), MARCADORES.map((m) => m.rpc).join('\n'));
  assert.equal(marcadoresFaltantes(carpeta).length, MARCADORES.length);
});
