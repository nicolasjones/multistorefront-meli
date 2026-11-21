// Guarda documental de la medición de rendimiento de la tienda (MSF-552): la sección de la guía tiene que
// traer las cifras con su entorno y su fuente; si no, el criterio se vuelve a cerrar «sin medir».
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { extraerSeccion, revisarSeccion } from './verificar-medicion-tienda.mjs';

const raiz = path.resolve(import.meta.dirname, '..');
const guia = readFileSync(path.join(raiz, 'docs', 'tiendas-online.md'), 'utf8');

const seccionConCifras = `
| Pantalla | LCP |
|---|---|
| Mundo JC · catálogo | \`http://mundojc.localhost:4300/catalogo\` · 1 200 ms |
| Mundo JC · ficha | \`http://mundojc.localhost:4300/producto/abc\` · 1 400 ms |
| San Javucho · catálogo | \`http://sanjavucho.localhost:4300/catalogo\` · 1 300 ms |
| San Javucho · ficha | \`http://sanjavucho.localhost:4300/producto/def\` · 1 500 ms |

Medición de \`publico.catalogo_pagina_por_dominio\` con 500 productos sembrados en Postgres local (seed).
Cifras del workflow \`medir-tienda\` (artifact con el reporte).
Línea base del job \`medir\`: 22.000 ms.
`;

describe('sección «Rendimiento en celular» de la guía', () => {
  it('existe en docs/tiendas-online.md', () => {
    assert.ok(extraerSeccion(guia), 'no se encontró la sección de rendimiento en la guía');
  });

  it('está medida: cifras de las cuatro rutas, RPC, entorno y fuente', () => {
    assert.deepEqual(revisarSeccion(seccionConCifras), []);
  });

  it('falla si la sección dice que no se midió', () => {
    const problemas = revisarSeccion('**No medido todavía.** No hay cifras que registrar (no se inventan).');
    assert.ok(problemas.some((p) => /no está hecha/.test(p)), JSON.stringify(problemas));
  });

  it('falla si falta alguna de las cuatro rutas medidas', () => {
    const sinFicha = seccionConCifras.split('\n').filter((linea) => !/ficha/.test(linea)).join('\n');
    const problemas = revisarSeccion(sinFicha);
    assert.ok(problemas.some((p) => /cuatro rutas/.test(p)), JSON.stringify(problemas));
  });

  it('falla si falta una ruta y otra está repetida (no cuenta filas: cuenta rutas)', () => {
    const repetida = seccionConCifras.replace(
      '| San Javucho · ficha | `http://sanjavucho.localhost:4300/producto/def` · 1 500 ms |',
      '| Mundo JC · catálogo | `http://mundojc.localhost:4300/catalogo` · 1 200 ms |',
    );
    const problemas = revisarSeccion(repetida);
    assert.ok(problemas.some((p) => /cuatro rutas/.test(p)), JSON.stringify(problemas));
  });

  it('falla si no está la medición de la RPC con el tamaño del catálogo', () => {
    const sinRpc = seccionConCifras.replace(/`publico\.catalogo_pagina_por_dominio`/g, 'la RPC').replace(/500 productos/g, 'muchos');
    const problemas = revisarSeccion(sinRpc);
    assert.ok(problemas.some((p) => /catalogo_pagina_por_dominio/.test(p)), JSON.stringify(problemas));
    assert.ok(problemas.some((p) => /tamaño del catálogo/.test(p)), JSON.stringify(problemas));
  });

  it('falla si las cifras no dicen de dónde salen', () => {
    const sinFuente = seccionConCifras.replace(/Cifras del workflow[\s\S]*/, '');
    const problemas = revisarSeccion(sinFuente);
    assert.ok(problemas.some((p) => /fuente de las cifras/.test(p)), JSON.stringify(problemas));
  });

  it('falla si no declara la línea base del job `medir`', () => {
    const sinBase = seccionConCifras.replace(/Línea base[^\n]*/, '');
    const problemas = revisarSeccion(sinBase);
    assert.ok(problemas.some((p) => /línea base/.test(p)), JSON.stringify(problemas));
  });

  it('la guía del repo pasa la guarda (las cifras registradas están completas)', () => {
    assert.deepEqual(revisarSeccion(extraerSeccion(guia)), []);
  });
});
