import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hayCapturasCambiadas, pantallasCambiadas, pantallasSinCaptura } from './docs-capturas-manual.mjs';

const P = 'apps/web/src/pages';

// Equivalentes declarados: `[cm]?` y `[jt]sx?` de NO_PANTALLA no se distinguen porque PANTALLA exige `.tsx` (las variantes .mjs/.cts/.js nunca llegan a esa regex);
// el `^` de `(^|\/)` en NO_PANTALLA tampoco (toda ruta empieza con apps/ y PANTALLA ya está anclada). Antes: el `^` de `(^|\/)` en NO_PANTALLA no se distingue (toda ruta empieza con apps/ y PANTALLA ya está anclada).
// Una fila por condición (n-1 / n / n+1 donde aplica). Cada fila muere al mutar la condición que nombra.
const PANTALLAS = [
  // [ruta, ¿cuenta como pantalla?, condición que fija]
  [`${P}/ventas/lista.tsx`, true, 'caso base'],
  [`${P}/a/b/c/d.tsx`, true, 'ruta anidada (.+)'],
  [`${P}/login.tsx`, true, 'archivo directo en pages/'],
  [`${P}/ventas/con espacio ñ.tsx`, true, 'espacios y unicode'],
  [`${P}/atest/x.tsx`, true, 'un directorio que termina en «test» no es una carpeta de pruebas ((^|/))'],
  [`${P}/ventas/sal\nto.tsx`, true, 'nombre con salto de línea (flag s)'],
  [`${P}/.tsx`, false, 'el nombre no puede ser vacío (.+ y no .*)'],
  [`${P}/ventas/lista.ts`, false, '.tsx exacto (no .ts)'],
  [`${P}/ventas/lista.jsx`, false, '.tsx exacto (no .jsx)'],
  [`${P}/ventas/lista.tsx.bak`, false, 'termina en .tsx ($)'],
  [`apps/web/src/components/ventas/x.tsx`, false, 'solo pages/'],
  [`apps/web/src/pages.tsx`, false, 'pages/ es un directorio'],
  [`x/apps/web/src/pages/a.tsx`, false, 'anclado al inicio (^apps/web)'],
  [`apps/mobile/src/pages/a.tsx`, false, 'solo apps/web'],
  [`${P}/ventas/lista.test.tsx`, false, '.test'],
  [`${P}/ventas/lista.spec.tsx`, false, '.spec'],
  [`${P}/ventas/lista.stories.tsx`, false, '.stories'],
  [`${P}/ventas/__tests__/x.tsx`, false, '__tests__/'],
  [`${P}/ventas/__snapshots__/x.tsx`, false, '__snapshots__/'],
  [`${P}/ventas/test/x.tsx`, false, 'test/'],
  [`${P}/ventas/tests/x.tsx`, false, 'tests/'],
  [`${P}/ventas/e2e/x.tsx`, false, 'e2e/'],
  [`${P}/test/x.tsx`, false, 'test/ justo bajo pages/'],
];

const CAPTURAS = [
  ['docs/producto/img/ventas/01.png', true, 'caso base'],
  ['docs/producto/img/01.png', true, 'directamente bajo img/'],
  ['docs/producto/img/a/b/c.png', true, 'ruta anidada'],
  ['docs/producto/img/ventas/01.PNG', true, 'extensión sin distinguir mayúsculas (flag i)'],
  ['docs/producto/img/ventas/01.JpEg', true, 'jpeg con mayúsculas'],
  ['docs/producto/img/ventas/01.jpg', true, 'jpg'],
  ['docs/producto/img/ventas/01.jpeg', true, 'jpeg'],
  ['docs/producto/img/ventas/01.webp', true, 'webp'],
  ['docs/producto/img/ventas/captura ñ 1.png', true, 'espacios y unicode'],
  ['docs/producto/img/ventas/sal\nto.png', true, 'nombre con salto de línea (flag s)'],
  ['docs/producto/img/.png', false, 'el nombre no puede ser vacío (.+ y no .*)'],
  ['docs/producto/img/ventas/01.gif', false, 'extensiones permitidas'],
  ['docs/producto/img/ventas/notas.md', false, 'solo imágenes'],
  ['docs/producto/img/ventas/01.png.txt', false, 'termina en la extensión ($)'],
  ['docs/producto/ventas/01.png', false, 'la carpeta es docs/producto/img/'],
  ['docs/producto/01.png', false, 'la carpeta es docs/producto/img/ (no docs/producto/)'],
  ['docs/otra/img/01.png', false, 'solo docs/producto/'],
  ['x/docs/producto/img/01.png', false, 'anclado al inicio (^docs)'],
  ['apps/web/public/img/01.png', false, 'imagen fuera de docs/producto/img/'],
];

describe('docs-capturas-manual', () => {
  for (const [ruta, esperado, condicion] of PANTALLAS) {
    it(`pantalla ${esperado ? 'sí' : 'no'}: ${ruta} (${condicion})`, () => {
      assert.deepEqual(pantallasCambiadas([ruta]), esperado ? [ruta] : []);
    });
  }

  for (const [ruta, esperado, condicion] of CAPTURAS) {
    it(`captura ${esperado ? 'sí' : 'no'}: ${ruta} (${condicion})`, () => {
      assert.equal(hayCapturasCambiadas([ruta]), esperado);
    });
  }

  it('pantallasSinCaptura: lista las pantallas solo si no cambió ninguna captura', () => {
    const pantalla = `${P}/ventas/lista.tsx`;
    assert.deepEqual(pantallasSinCaptura([pantalla, 'docs/a.md']), [pantalla]);
    assert.deepEqual(pantallasSinCaptura([pantalla, 'docs/producto/img/ventas/01.png']), []);
    assert.deepEqual(pantallasSinCaptura(['docs/a.md', 'docs/producto/img/ventas/01.png']), []);
    assert.deepEqual(pantallasSinCaptura([]), []);
    // Con varias pantallas se devuelven todas, en orden.
    assert.deepEqual(pantallasSinCaptura([`${P}/b.tsx`, `${P}/a.tsx`]), [`${P}/b.tsx`, `${P}/a.tsx`]);
  });
});
