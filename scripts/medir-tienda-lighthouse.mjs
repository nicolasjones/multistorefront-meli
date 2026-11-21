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
// contra el objetivo de LCP < 3 s de `docs/tienda-movil.md`.
//
// Cuándo falla (código 1): si no se midió alguna ruta (no hay reporte o el reporte no trae la auditoría del
// LCP: eso NO es «supera el objetivo», es que no se midió), si el LCP de alguna ruta NO llega al objetivo de
// 3 s o si supera la LÍNEA BASE (`LCP_BASE_MS`): eso sí es una regresión del front. El job queda rojo mientras
// el objetivo no se cumpla: la degradación conocida (la tienda pública carga el bundle del panel) está
// anotada en `docs/tiendas-online.md` y no puede quedar escondida en un resumen verde.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const TIENDAS = [
  { host: 'mundojc.localhost', nombre: 'Mundo JC' },
  { host: 'sanjavucho.localhost', nombre: 'San Javucho' },
];

// Objetivo de LCP en celular de `docs/tienda-movil.md` («4G lento», CPU ×4): por debajo de 3 s.
export const OBJETIVO_LCP_MS = 3000;

// Línea base del LCP: el máximo de las 12 corridas del 17/11/2026 (run 44118543460) fue 21,6 s, así que la
// línea base queda por encima para que la variación normal no se lea como regresión. Superarla es una
// regresión del front (la degradación conocida ya está por encima del objetivo, no de la línea base).
// La guía (`docs/tiendas-online.md`, «Rendimiento en celular») declara este mismo número y el test compara
// los dos: si cambia uno sin el otro, la guía miente.
export const LCP_BASE_MS = 22000;

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
export function configLighthouse(perfil, rutas, { directorioReportes } = {}) {
  return {
    ci: {
      ...perfil.ci,
      collect: { ...perfil.ci.collect, url: rutas.map((r) => r.url) },
      // El directorio de los reportes lo decide el script (`--salida`): el del perfil es sólo el valor por
      // defecto y, si no se sobrescribiera, LHCI escribiría siempre en el mismo lugar y el script leería
      // reportes de otra corrida.
      upload: { ...perfil.ci.upload, ...(directorioReportes ? { outputDir: directorioReportes } : {}) },
    },
  };
}

const mediana = (valores) => {
  if (!valores.length) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 ? ordenados[medio] : (ordenados[medio - 1] + ordenados[medio]) / 2;
};

const numero = (auditoria) => {
  const valor = auditoria?.numericValue;
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
};

/** Clave de ruta: mismo host y path, sin puerto ni barra final (el reporte puede venir con otra forma). */
const claveUrl = (url) => {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return url;
  }
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
    const clave = claveUrl(url);
    const previa = porUrl.get(clave);
    porUrl.set(clave, previa ? { url: previa.url, corridas: [...previa.corridas, fila] } : { url, corridas: [fila] });
  }
  const filaDe = (etiqueta, url, corridas) => ({
    etiqueta,
    url,
    corridas: corridas.length,
    lcp: mediana(corridas.map((c) => c.lcp).filter((v) => v !== null)),
    fcp: mediana(corridas.map((c) => c.fcp).filter((v) => v !== null)),
    cls: mediana(corridas.map((c) => c.cls).filter((v) => v !== null)),
    tbt: mediana(corridas.map((c) => c.tbt).filter((v) => v !== null)),
    performance: mediana(corridas.map((c) => c.performance).filter((v) => v !== null)),
    accessibility: mediana(corridas.map((c) => c.accessibility).filter((v) => v !== null)),
  });
  // Una fila por ruta ESPERADA: si a una ruta no le llegó ningún reporte (LHCI abortó, murió Chrome), la fila
  // queda sin LCP y la ruta cuenta como «sin medir». Con las rutas esperadas como base, una medición
  // parcial no se puede publicar como si fuera completa.
  const filas = rutas.length
    ? rutas.map((r) => filaDe(r.etiqueta, r.url, porUrl.get(claveUrl(r.url))?.corridas ?? []))
    : [...porUrl.values()].map((e) => filaDe(e.url, e.url, e.corridas));
  filas.sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'));
  // Las rutas sin LCP NO se midieron (no hay reporte, o el reporte no trae la auditoría): no es que superen
  // el objetivo.
  const sinMedir = filas.filter((f) => f.lcp === null).map((f) => f.etiqueta);
  const lcpMaximo = filas.some((f) => f.lcp !== null) ? Math.max(...filas.map((f) => f.lcp ?? 0)) : null;
  return {
    filas,
    lcpMaximo,
    sinMedir,
    cumple: filas.length > 0 && filas.every((f) => f.lcp !== null && f.lcp <= OBJETIVO_LCP_MS),
    regresion: lcpMaximo !== null && lcpMaximo > LCP_BASE_MS,
  };
}

/** Motivo por el que la medición NO es publicable (null = se puede publicar). */
export function motivoDeFallo(resumen) {
  if (!resumen.filas.length) return 'No se leyó ningún reporte de Lighthouse: la medición no produjo cifras.';
  if (resumen.sinMedir.length) {
    return `No se midió el LCP de: ${resumen.sinMedir.join(', ')}. Eso no es «supera el objetivo»: es que la ruta no se midió.`;
  }
  if (resumen.regresion) {
    return `El LCP máximo medido (${Math.round(resumen.lcpMaximo)} ms) supera la línea base (${LCP_BASE_MS} ms): es una regresión.`;
  }
  if (!resumen.cumple) {
    return `El LCP no llega al objetivo de ${OBJETIVO_LCP_MS} ms (máximo medido: ${Math.round(resumen.lcpMaximo)} ms).`;
  }
  return null;
}

const ms = (valor) => (valor === null ? '—' : `${Math.round(valor)} ms`);
const puntos = (valor) => (valor === null ? '—' : String(Math.round(valor * 100)));

export function resumenMarkdown({ filas, cumple, lcpMaximo, sinMedir = [], regresion = false }) {
  const lineas = [
    '| Pantalla | URL | Corridas | LCP | FCP | CLS | TBT | Perf. | A11y |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const f of filas) {
    lineas.push(`| ${f.etiqueta} | ${f.url} | ${f.corridas} | ${ms(f.lcp)} | ${ms(f.fcp)} | ${f.cls?.toFixed(3) ?? '—'} | ${ms(f.tbt)} | ${puntos(f.performance)} | ${puntos(f.accessibility)} |`);
  }
  lineas.push('');
  lineas.push(`Objetivo: LCP ≤ ${OBJETIVO_LCP_MS} ms (celular 390×844, CPU ×4, «4G lento»). LCP máximo medido: ${ms(lcpMaximo)}. Veredicto: ${cumple ? 'cumple' : 'NO cumple'}.`);
  lineas.push(`Línea base del job \`medir\`: ${LCP_BASE_MS} ms (si el máximo la supera, es una regresión y el job falla). Estado: ${regresion ? 'REGRESIÓN' : 'sin regresión'}.`);
  lineas.push(`El job \`medir\` falla si alguna ruta no se midió, si el LCP no llega al objetivo (${OBJETIVO_LCP_MS} ms) o si supera la línea base (${LCP_BASE_MS} ms).`);
  if (sinMedir.length) lineas.push(`Sin medir (no hay reporte o el reporte no trae la auditoría del LCP): ${sinMedir.join(', ')}.`);
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
  if (!respuesta.ok) {
    // El cuerpo crudo de la API pública no hace falta en el log (ni para diagnosticar): se recorta.
    const detalle = (await respuesta.text()).slice(0, 200);
    throw new Error(`La RPC del catálogo de ${host} respondió ${respuesta.status}: ${detalle}`);
  }
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
  const config = configLighthouse(perfil, rutas, { directorioReportes: dirReportes });
  const rutaConfig = path.join(salida, 'lighthouse-ci.json');
  writeFileSync(rutaConfig, `${JSON.stringify(config, null, 2)}\n`);

  const lhci = spawnSync('pnpm', ['dlx', '@lhci/cli@0.16.0', 'autorun', `--config=${rutaConfig}`], { stdio: 'inherit' });
  if (lhci.status !== 0) console.error(`Lighthouse CI terminó con código ${lhci.status}: los reportes parciales están en ${dirReportes}.`);

  const reportes = leerReportes(dirReportes);
  if (!reportes.length) {
    console.error(`No se leyó ningún reporte de Lighthouse en ${dirReportes}: la medición no produjo cifras.`);
    process.exit(1);
  }
  const resumen = resumirReportes(reportes, rutas);
  writeFileSync(path.join(salida, 'resumen.json'), `${JSON.stringify({ objetivoLcpMs: OBJETIVO_LCP_MS, lineaBaseLcpMs: LCP_BASE_MS, ...resumen }, null, 2)}\n`);
  writeFileSync(path.join(salida, 'resumen.md'), resumenMarkdown(resumen));
  console.log(`\n${resumenMarkdown(resumen)}`);
  const motivo = motivoDeFallo(resumen);
  if (motivo) {
    console.error(motivo);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
