// Medición de Lighthouse de la tienda (MSF-552): perfil móvil, rutas medidas y resumen de las corridas.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  OBJETIVO_LCP_MS, TIENDAS, configLighthouse, resumenMarkdown, resumirReportes, rutasDeMedicion,
} from './medir-tienda-lighthouse.mjs';

const raiz = path.resolve(import.meta.dirname, '..');
const perfil = JSON.parse(readFileSync(path.join(raiz, '.lighthouserc.tienda.json'), 'utf8'));

describe('perfil de Lighthouse de la tienda', () => {
  it('mide en celular: emulación móvil, CPU ×4 y «4G lento»', () => {
    const ajustes = perfil.ci.collect.settings;
    assert.equal(ajustes.formFactor, 'mobile');
    assert.equal(ajustes.screenEmulation.mobile, true);
    assert.equal(ajustes.screenEmulation.width, 390);
    assert.equal(ajustes.throttlingMethod, 'devtools');
    assert.equal(ajustes.throttling.cpuSlowdownMultiplier, 4);
    assert.ok(ajustes.throttling.rttMs > 0 && ajustes.throttling.throughputKbps > 0);
  });

  it('toma tres corridas por ruta (la mediana de una sola no es una medida)', () => {
    assert.ok(perfil.ci.collect.numberOfRuns >= 3);
  });
});

describe('rutas medidas', () => {
  const productos = { 'mundojc.localhost': '11111111-1111-1111-1111-111111111111', 'sanjavucho.localhost': '22222222-2222-2222-2222-222222222222' };

  it('mide el catálogo y la ficha de las dos tiendas del seed', () => {
    const rutas = rutasDeMedicion({ puerto: 4300, productosPorTienda: productos });
    assert.equal(rutas.length, 4);
    assert.deepEqual(rutas.map((r) => r.url), [
      'http://mundojc.localhost:4300/catalogo',
      'http://mundojc.localhost:4300/producto/11111111-1111-1111-1111-111111111111',
      'http://sanjavucho.localhost:4300/catalogo',
      'http://sanjavucho.localhost:4300/producto/22222222-2222-2222-2222-222222222222',
    ]);
  });

  it('falla si una tienda no tiene producto visible (no hay ficha que medir)', () => {
    assert.throws(() => rutasDeMedicion({ puerto: 4300, productosPorTienda: { 'mundojc.localhost': 'x' } }), /sanjavucho\.localhost/);
  });

  it('la config que corre LHCI conserva el perfil móvil y agrega las cuatro URLs', () => {
    const rutas = rutasDeMedicion({ puerto: 4300, productosPorTienda: productos });
    const config = configLighthouse(perfil, rutas);
    assert.equal(config.ci.collect.settings.formFactor, 'mobile');
    assert.equal(config.ci.collect.numberOfRuns, perfil.ci.collect.numberOfRuns);
    assert.deepEqual(config.ci.collect.url, rutas.map((r) => r.url));
  });
});

describe('resumen de las corridas', () => {
  const reporte = (url, lcp) => ({
    finalUrl: url,
    audits: {
      'largest-contentful-paint': { numericValue: lcp },
      'first-contentful-paint': { numericValue: 1000 },
      'cumulative-layout-shift': { numericValue: 0.05 },
      'total-blocking-time': { numericValue: 120 },
    },
    categories: { performance: { score: 0.8 }, accessibility: { score: 0.9 } },
  });

  it('agrupa por URL y usa la mediana de las corridas', () => {
    const url = 'http://mundojc.localhost:4300/catalogo';
    const resumen = resumirReportes([reporte(url, 2000), reporte(url, 3000), reporte(url, 4000)]);
    assert.equal(resumen.filas.length, 1);
    assert.equal(resumen.filas[0].corridas, 3);
    assert.equal(resumen.filas[0].lcp, 3000);
  });

  it('el veredicto falla si alguna ruta supera el objetivo de LCP', () => {
    const dentro = resumirReportes([reporte('http://mundojc.localhost:4300/catalogo', OBJETIVO_LCP_MS - 1)]);
    assert.equal(dentro.cumple, true);
    const fuera = resumirReportes([reporte('http://mundojc.localhost:4300/catalogo', OBJETIVO_LCP_MS + 1)]);
    assert.equal(fuera.cumple, false);
    assert.ok(fuera.lcpMaximo > OBJETIVO_LCP_MS);
  });

  it('sin reportes no hay veredicto (no se puede decir que cumple lo que no se midió)', () => {
    const resumen = resumirReportes([]);
    assert.deepEqual(resumen.filas, []);
    assert.equal(resumen.cumple, false);
  });

  it('el resumen en markdown deja la cifra y el objetivo a la vista', () => {
    const url = 'http://mundojc.localhost:4300/catalogo';
    const markdown = resumenMarkdown(resumirReportes([reporte(url, 2100)]));
    assert.match(markdown, /2100 ms/);
    assert.match(markdown, new RegExp(`${OBJETIVO_LCP_MS} ms`));
    assert.match(markdown, /cumple/);
  });

  it('las tiendas medidas son las dos del seed', () => {
    assert.deepEqual(TIENDAS.map((t) => t.host), ['mundojc.localhost', 'sanjavucho.localhost']);
  });
});
