#!/usr/bin/env node
// Medición de Lighthouse en perfil MÓVIL del catálogo y la ficha de las dos tiendas del seed
// (MSF-552 · seguimiento de T071/SC-010 de la épica MSF-167).
//
// Qué mide: `/catalogo` y `/producto/:id` de `mundojc.localhost` y `sanjavucho.localhost`, con el perfil
// `.lighthouserc.tienda.json` (celular 390×844, CPU ×4, «4G lento», 3 corridas por ruta).
//
// Requisitos: el stack de Supabase CON el seed (`pnpm dev:supabase` o el stack del CI), la web ya servida
// (`vite preview`) y `SUPABASE_URL` + `SUPABASE_ANON_KEY` de ese stack. Para el producto de la ficha se usa
// la RPC pública del catálogo (sin service-role). Si no hay Chrome instalado, `CHROME_PATH` puede apuntar al
// Chromium de Playwright (lo hace el workflow `medir-tienda`).
//
// Uso:
//   node scripts/medir-tienda-lighthouse.mjs [--puerto 4300] [--salida reports/lighthouse-tienda]
//
// Salida: `resumen.md` y `resumen.json` (una fila por ruta: LCP, FCP, CLS, TBT y puntajes) con el veredicto
// contra el objetivo de LCP < 3 s de `docs/tienda-movil.md`. Sale con código 1 si alguna ruta lo supera:
// la regresión se ve en el run, no se esconde en el resumen.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const TIENDAS = [
  { host: 'mundojc.localhost', nombre: 'Mundo JC' },
  { host: 'sanjavucho.localhost', nombre: 'San Javucho' },
];

// Objetivo de LCP en celular de `docs/tienda-movil.md` («4G lento», CPU ×4): por debajo de 3 s.
export const OBJETIVO_LCP_MS = 3000;

const rutaPorDefecto = (archivo) => path.resolve(import.meta.dirname, '..', archivo);

/** Rutas a medir: el catálogo y la ficha de cada tienda del seed. */
export function rutasDeMedicion({ puerto, productosPorTienda }) {
  return TIENDAS.flatMap((tienda) => {
    const producto = productosPorTienda[tienda.host];
    if (!producto) throw new Error(`No se resolvió el producto visible de la tienda ${tienda.host}.`);
    const base = `http://${tienda.host}:${puerto}`;
    return [
      { etiqueta: `${tienda.nombre} · catálogo`, tienda: tienda.nombre, ruta: '/catalogo', url: `${base}/catalogo` },
      { etiqueta: `${tienda.nombre} · ficha`, tienda: tienda.nombre, ruta: '/producto/:id', url: `${base}/producto/${producto}` },
    ];
  });
}

/** Config de LHCI con las URLs medidas y el perfil tal cual (`.lighthouserc.tienda.json`). */
export function configLighthouse(perfil, rutas) {
  return {
    ci: {
      ...perfil.ci,
      collect: { ...perfil.ci.collect, url: rutas.map((r) => r.url) },
    },
  };
}

const mediana = (valores) => {
  const ordenados = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 ? ordenados[medio] : (ordenados[medio - 1] + ordenados[medio]) / 2;
};

const numero = (auditoria) => {
  const valor = auditoria?.numericValue;
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
};

/** Una fila por ruta con la mediana de las corridas de Lighthouse. */
export function resumirReportes(reportes, rutas = []) {
  const porUrl = new Map();
  for (const reporte of reportes) {
    const url = reporte.finalUrl || reporte.requestedUrl;
    if (!url) continue;
    const fila = {
      url,
      lcp: numero(reporte.audits?.['largest-contentful-paint']),
      fcp: numero(reporte.audits?.['first-contentful-paint']),
      cls: numero(reporte.audits?.['cumulative-layout-shift']),
      tbt: numero(reporte.audits?.['total-blocking-time']),
      performance: reporte.categories?.performance?.score ?? null,
      accessibility: reporte.categories?.accessibility?.score ?? null,
    };
    porUrl.set(url, [...(porUrl.get(url) ?? []), fila]);
  }
  const etiquetaDe = (url) => rutas.find((r) => r.url === url)?.etiqueta ?? url;
  const filas = [...porUrl.entries()]
    .map(([url, corridas]) => ({
      etiqueta: etiquetaDe(url),
      url,
      corridas: corridas.length,
      lcp: mediana(corridas.map((c) => c.lcp).filter((v) => v !== null)),
      fcp: mediana(corridas.map((c) => c.fcp).filter((v) => v !== null)),
      cls: mediana(corridas.map((c) => c.cls).filter((v) => v !== null)),
      tbt: mediana(corridas.map((c) => c.tbt).filter((v) => v !== null)),
      performance: mediana(corridas.map((c) => c.performance).filter((v) => v !== null)),
      accessibility: mediana(corridas.map((c) => c.accessibility).filter((v) => v !== null)),
    }))
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'));
  const lcpMaximo = filas.reduce((max, f) => Math.max(max, f.lcp ?? 0), 0);
  return { filas, lcpMaximo, cumple: filas.length > 0 && filas.every((f) => f.lcp !== null && f.lcp <= OBJETIVO_LCP_MS) };
}

const ms = (valor) => (valor === null ? '—' : `${Math.round(valor)} ms`);
const puntos = (valor) => (valor === null ? '—' : String(Math.round(valor * 100)));

export function resumenMarkdown({ filas, cumple, lcpMaximo }) {
  const lineas = [
    '| Pantalla | URL | Corridas | LCP | FCP | CLS | TBT | Perf. | A11y |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const f of filas) {
    lineas.push(`| ${f.etiqueta} | ${f.url} | ${f.corridas} | ${ms(f.lcp)} | ${ms(f.fcp)} | ${f.cls?.toFixed(3) ?? '—'} | ${ms(f.tbt)} | ${puntos(f.performance)} | ${puntos(f.accessibility)} |`);
  }
  lineas.push('');
  lineas.push(`Objetivo: LCP ≤ ${OBJETIVO_LCP_MS} ms (celular 390×844, CPU ×4, «4G lento»). LCP máximo medido: ${ms(lcpMaximo)}. Veredicto: ${cumple ? 'cumple' : 'NO cumple'}.`);
  return `${lineas.join('\n')}\n`;
}

async function productoVisibleDe(urlApi, anonKey, host) {
  const respuesta = await fetch(`${urlApi}/rest/v1/rpc/catalogo_pagina_por_dominio`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
      'content-type': 'application/json',
      'accept-profile': 'publico',
      'content-profile': 'publico',
    },
    body: JSON.stringify({ host, categoria: null, solo_con_stock: false, precio_max: null, orden: 'relevancia', pagina: 1 }),
  });
  if (!respuesta.ok) throw new Error(`La RPC del catálogo de ${host} respondió ${respuesta.status}: ${await respuesta.text()}`);
  const datos = await respuesta.json();
  const producto = datos?.productos?.[0];
  if (!producto?.id) throw new Error(`La tienda ${host} no devolvió productos visibles: no hay ficha que medir.`);
  return producto.id;
}

function leerReportes(directorio) {
  if (!existsSync(directorio)) return [];
  return readdirSync(directorio)
    .filter((archivo) => archivo.endsWith('.report.json'))
    .map((archivo) => JSON.parse(readFileSync(path.join(directorio, archivo), 'utf8')));
}

function argumento(nombre, porDefecto) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
}

async function main() {
  const urlApi = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!urlApi || !anonKey) {
    console.error('Faltan SUPABASE_URL y SUPABASE_ANON_KEY del stack con el seed (no hay datos que medir sin eso).');
    process.exit(2);
  }
  const puerto = Number(argumento('puerto', process.env.TIENDA_PUERTO || process.env.WEB_PORT || 4300));
  const salida = path.resolve(argumento('salida', 'reports/lighthouse-tienda'));
  const perfil = JSON.parse(readFileSync(rutaPorDefecto('.lighthouserc.tienda.json'), 'utf8'));

  const productosPorTienda = {};
  for (const tienda of TIENDAS) {
    productosPorTienda[tienda.host] = await productoVisibleDe(urlApi, anonKey, tienda.host);
  }
  const rutas = rutasDeMedicion({ puerto, productosPorTienda });
  console.log(`Mediendo ${rutas.length} rutas en perfil móvil (puerto ${puerto}):`);
  for (const r of rutas) console.log(` - ${r.etiqueta}: ${r.url}`);

  const dirReportes = path.join(salida, 'lighthouse');
  mkdirSync(dirReportes, { recursive: true });
  const config = configLighthouse(perfil, rutas);
  const rutaConfig = path.join(salida, 'lighthouse-ci.json');
  writeFileSync(rutaConfig, `${JSON.stringify(config, null, 2)}\n`);

  const lhci = spawnSync('pnpm', ['dlx', '@lhci/cli@0.16.0', 'autorun', `--config=${rutaConfig}`], { stdio: 'inherit' });
  if (lhci.status !== 0) console.error(`Lighthouse CI terminó con código ${lhci.status}: los reportes parciales están en ${dirReportes}.`);

  const resumen = resumirReportes(leerReportes(dirReportes), rutas);
  if (!resumen.filas.length) {
    console.error(`No se leyó ningún reporte de Lighthouse en ${dirReportes}: la medición no produjo cifras.`);
    process.exit(1);
  }
  writeFileSync(path.join(salida, 'resumen.json'), `${JSON.stringify({ objetivoLcpMs: OBJETIVO_LCP_MS, ...resumen }, null, 2)}\n`);
  writeFileSync(path.join(salida, 'resumen.md'), resumenMarkdown(resumen));
  console.log(`\n${resumenMarkdown(resumen)}`);
  if (!resumen.cumple) {
    console.error(`Alguna ruta supera el objetivo de LCP (${OBJETIVO_LCP_MS} ms). Anotá el ajuste en docs/tiendas-online.md.`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
