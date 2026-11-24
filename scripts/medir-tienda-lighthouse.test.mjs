// Medición de Lighthouse de la tienda (MSF-552): perfil móvil, rutas medidas y resumen de las corridas.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  LCP_BASE_MS, OBJETIVO_LCP_MS, TIENDAS, configLighthouse, motivoDeFallo, resumenMarkdown, resumirReportes,
  rutasDeMedicion,
} from './medir-tienda-lighthouse.mjs';
import { extraerSeccion } from './verificar-medicion-tienda.mjs';

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

const productos = { 'mundojc.localhost': '11111111-1111-1111-1111-111111111111', 'sanjavucho.localhost': '22222222-2222-2222-2222-222222222222' };

describe('rutas medidas', () => {

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

  it('los reportes se leen del directorio que pide `--salida` (si no, LHCI escribe en otro lado)', () => {
    const rutas = rutasDeMedicion({ puerto: 4300, productosPorTienda: productos });
    const config = configLighthouse(perfil, rutas, { directorioReportes: '/tmp/otra-salida/lighthouse' });
    assert.equal(config.ci.upload.outputDir, '/tmp/otra-salida/lighthouse');
    // Sin directorio explícito queda el del perfil (el valor por defecto).
    assert.equal(configLighthouse(perfil, rutas).ci.upload.outputDir, perfil.ci.upload.outputDir);
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

  it('una ruta sin la auditoría del LCP no se midió: no es que supere el objetivo', () => {
    // Reporte de LHCI con error de navegación: viene sin la auditoría del LCP.
    const sinLcp = { finalUrl: 'http://mundojc.localhost:4300/catalogo', audits: { 'first-contentful-paint': { numericValue: 1000 } } };
    const resumen = resumirReportes([sinLcp]);
    assert.equal(resumen.filas[0].lcp, null, 'no puede quedar NaN: no hay LCP medido');
    assert.deepEqual(resumen.sinMedir, ['http://mundojc.localhost:4300/catalogo']);
    assert.equal(resumen.lcpMaximo, null);
    assert.doesNotMatch(resumenMarkdown(resumen), /NaN/);
    assert.match(resumenMarkdown(resumen), /Sin medir/);
  });

  it('no cumplir el objetivo hace fallar la medición (el job no queda verde con el LCP 6× arriba)', () => {
    const url = 'http://mundojc.localhost:4300/catalogo';
    // La degradación conocida (18.511 ms): no cumple el objetivo, pero está dentro de la línea base.
    const conocido = resumirReportes([reporte(url, 18511)]);
    assert.equal(conocido.cumple, false);
    assert.equal(conocido.regresion, false);
    assert.match(motivoDeFallo(conocido), /objetivo/);
    // Una regresión: supera la línea base.
    const regresion = resumirReportes([reporte(url, LCP_BASE_MS + 1)]);
    assert.equal(regresion.regresion, true);
    assert.ok(regresion.lcpMaximo > LCP_BASE_MS);
    assert.match(motivoDeFallo(regresion), /línea base/);
    // Dentro del objetivo: se puede publicar.
    assert.equal(motivoDeFallo(resumirReportes([reporte(url, OBJETIVO_LCP_MS - 1)])), null);
  });

  it('una ruta sin reporte NO se midió: la medición parcial no se publica como exitosa', () => {
    const rutas = rutasDeMedicion({ puerto: 4300, productosPorTienda: productos });
    const resumen = resumirReportes([reporte(rutas[0].url, 2000)], rutas);
    assert.equal(resumen.filas.length, 4, 'la fila de la ruta sin reporte tiene que estar: si no, no se ve que falta');
    assert.equal(resumen.sinMedir.length, 3);
    for (const r of rutas.slice(1)) assert.ok(resumen.sinMedir.includes(r.etiqueta), `falta ${r.etiqueta} en sinMedir`);
    assert.match(motivoDeFallo(resumen), /no se midió/i);
  });

  it('el LCP de una ruta se mide aunque el reporte venga con otra forma de la URL', () => {
    const rutas = rutasDeMedicion({ puerto: 4300, productosPorTienda: productos });
    const conBarra = [{ ...reporte(rutas[0].url, 2000), finalUrl: `${rutas[0].url}/` }];
    const resumen = resumirReportes(conBarra, rutas);
    assert.equal(resumen.filas[0].lcp, 2000, 'la ruta reportada tiene que quedar medida');
    assert.ok(!resumen.sinMedir.includes(rutas[0].etiqueta), 'la ruta reportada no es «sin medir»');
    assert.equal(resumen.sinMedir.length, 3);
  });

  it('el resumen en markdown deja la cifra, el objetivo y la línea base a la vista', () => {
    const url = 'http://mundojc.localhost:4300/catalogo';
    const markdown = resumenMarkdown(resumirReportes([reporte(url, 2100)]));
    assert.match(markdown, /2100 ms/);
    assert.match(markdown, new RegExp(`${OBJETIVO_LCP_MS} ms`));
    assert.match(markdown, new RegExp(`${LCP_BASE_MS} ms`));
    assert.match(markdown, /cumple/);
  });

  it('sin reportes no hay veredicto (no se puede decir que cumple lo que no se midió)', () => {
    const resumen = resumirReportes([]);
    assert.deepEqual(resumen.filas, []);
    assert.equal(resumen.cumple, false);
    assert.equal(resumen.regresion, false);
  });

  it('las tiendas medidas son las dos del seed', () => {
    assert.deepEqual(TIENDAS.map((t) => t.host), ['mundojc.localhost', 'sanjavucho.localhost']);
  });
});

describe('la guía y el script cuentan lo mismo', () => {
  it('la guía declara la misma línea base que el script', () => {
    const guia = readFileSync(path.join(raiz, 'docs', 'tiendas-online.md'), 'utf8');
    const seccion = extraerSeccion(guia);
    assert.ok(seccion, 'no se encontró la sección «Rendimiento en celular» en la guía');
    const declarado = seccion.match(/línea base del job `medir`:\s*([\d.]+)\s*ms/i);
    assert.ok(declarado, 'la guía no declara la línea base del job `medir`');
    assert.equal(Number(declarado[1].replace(/\./g, '')), LCP_BASE_MS);
  });
});
