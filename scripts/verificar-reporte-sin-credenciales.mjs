#!/usr/bin/env node
// Último control antes de resumir y subir como artefacto el reporte de la medición de la tienda (job `medir` de
// `.github/workflows/nightly.yml`). Los reportes crudos de Lighthouse traen el log de red con las URL (a veces con
// tokens firmados de Storage) y `::add-mask::` no alcanza a los artefactos: por eso sólo se suben tres resúmenes
// GENERADOS por nuestros scripts, y acá se comprueba que sean eso y nada más.
//
// Dos barreras (defensa en profundidad, NO una garantía):
//   1. LISTA BLANCA (control primario): cada archivo tiene un formato cerrado (el que producen
//      `scripts/medir-tienda-lighthouse.mjs` y `scripts/medir-tienda-catalogo.sql`). Una línea, clave o valor que no
//      encaje es un hallazgo, sin importar cómo esté codificado: una credencial no es un formato esperado.
//   2. LISTA NEGRA (segunda barrera): patrones con forma de credencial (JWT, claves de Supabase y Stripe, cabeceras
//      de autorización, parámetros de firma), sobre el texto tal cual, decodificado de `%XX` y sin espacios.
// Falla CERRADO: un archivo ausente, ilegible, demasiado grande o fuera de formato es un hallazgo. Nunca imprime
// el contenido que no encaja (lo dejaría en claro en el log): sólo el archivo, la línea y el motivo.
//
// Uso: node scripts/verificar-reporte-sin-credenciales.mjs [archivo...] (por defecto, los del artefacto).
import { readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Los archivos que sube el artefacto `medir-tienda`: el `path:` del workflow tiene que ser exactamente esta lista. */
export const ARCHIVOS_DEL_ARTEFACTO = [
  'reports/lighthouse-tienda/resumen.md',
  'reports/lighthouse-tienda/resumen.json',
  'reports/medir-tienda/rpc-catalogo.txt',
];

export const MAX_BYTES = 1024 * 1024;
const MAX_LINEA = 400;

const ETQ = '[\\p{L} ]{1,20} · [\\p{L} ]{1,20}';
const ETIQUETA = new RegExp(`^${ETQ}$`, 'u');
const URL_RUTA = /^http:\/\/[a-z]+\.localhost:\d{4,5}\/(catalogo|producto\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const MS = '(?:\\d{1,6} ms|—)';
const PUNTO = '(?:\\d{1,3}|—)';

const LINEAS_MD = [
  /^\| Pantalla \| URL \| Corridas \| LCP \| FCP \| CLS \| TBT \| Perf\. \| A11y \|$/,
  /^\|---\|---\|---\|---\|---\|---\|---\|---\|---\|$/,
  new RegExp(`^\\| ${ETQ} \\| http://[a-z]+\\.localhost:\\d{4,5}/(?:catalogo|producto/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) \\| \\d{1,2} \\| ${MS} \\| ${MS} \\| (?:\\d{1,2}\\.\\d{3}|—) \\| ${MS} \\| ${PUNTO} \\| ${PUNTO} \\|$`, 'u'),
  /^$/,
  new RegExp(`^Objetivo: LCP ≤ \\d{1,6} ms \\(celular 390×844, CPU ×4, «4G lento»\\)\\. LCP máximo medido: ${MS}\\. Veredicto: (?:cumple|NO cumple)\\.$`),
  new RegExp(`^Línea base del job \`medir\`: \\d{1,6} ms \\(si el máximo la supera, es una regresión y el job falla\\)\\. Estado: (?:REGRESIÓN|sin regresión)\\.$`),
  /^El job `medir` falla si alguna ruta no se midió, si el LCP no llega al objetivo \(\d{1,6} ms\) o si supera la línea base \(\d{1,6} ms\)\.$/,
  new RegExp(`^Sin medir \\(no hay reporte o el reporte no trae la auditoría del LCP\\): ${ETQ}(?:, ${ETQ}){0,19}\\.$`, 'u'),
];

const LINEAS_TXT = [
  /^(?:BEGIN|COMMIT|ROLLBACK|DO|SET|CREATE TABLE|DROP TABLE|\(1 row\)|-{3,}|)$/,
  /^ set_config $/,
  /^ \d{1,7}$/,
  /^(?:INSERT 0|UPDATE) \d{1,7}$/,
  /^psql:<stdin>:\d{1,5}: NOTICE: {2}catalogo [a-z_]{1,30} -> mediana \d{1,7} ms · corridas \{\d{1,7}(?:,\d{1,7}){0,19}\} · productos en la pagina \d{1,5} · total \d{1,7}$/,
];

const CLAVES_RAIZ = ['objetivoLcpMs', 'lineaBaseLcpMs', 'filas', 'lcpMaximo', 'sinMedir', 'cumple', 'regresion'];
const CLAVES_FILA = ['etiqueta', 'url', 'corridas', 'lcp', 'fcp', 'cls', 'tbt', 'performance', 'accessibility'];
const numeroONull = (v) => v === null || (typeof v === 'number' && Number.isFinite(v));
const mismasClaves = (obj, claves) => {
  const k = Object.keys(obj);
  return k.length === claves.length && claves.every((c) => k.includes(c));
};

function validarLineas(texto, patrones) {
  const problemas = [];
  texto.split('\n').forEach((linea, i, todas) => {
    if (i === todas.length - 1 && linea === '') return; // salto de línea final
    if (linea.length > MAX_LINEA) return problemas.push(`línea ${i + 1}: demasiado larga`);
    if (!patrones.some((re) => re.test(linea))) problemas.push(`línea ${i + 1}: no tiene el formato esperado`);
  });
  return problemas;
}

function validarJson(texto) {
  let d;
  try { d = JSON.parse(texto); } catch { return ['no es JSON válido']; }
  const p = [];
  if (!d || typeof d !== 'object' || Array.isArray(d) || !mismasClaves(d, CLAVES_RAIZ)) return ['claves de primer nivel distintas de las esperadas'];
  for (const c of ['objetivoLcpMs', 'lineaBaseLcpMs', 'lcpMaximo']) if (!numeroONull(d[c])) p.push(`${c}: tipo inesperado`);
  for (const c of ['cumple', 'regresion']) if (typeof d[c] !== 'boolean') p.push(`${c}: tipo inesperado`);
  if (!Array.isArray(d.sinMedir) || d.sinMedir.length > 20 || !d.sinMedir.every((e) => typeof e === 'string' && ETIQUETA.test(e))) p.push('sinMedir: valores inesperados');
  if (!Array.isArray(d.filas) || d.filas.length > 20) return [...p, 'filas: valores inesperados'];
  d.filas.forEach((f, i) => {
    const ok = f && typeof f === 'object' && !Array.isArray(f) && mismasClaves(f, CLAVES_FILA)
      && typeof f.etiqueta === 'string' && ETIQUETA.test(f.etiqueta) && typeof f.url === 'string' && URL_RUTA.test(f.url)
      && ['corridas', 'lcp', 'fcp', 'cls', 'tbt', 'performance', 'accessibility'].every((c) => numeroONull(f[c]));
    if (!ok) p.push(`filas[${i}]: valores inesperados`);
  });
  return p;
}

// Segunda barrera: patrones con forma de credencial (sin palabras sueltas como `secret`, que dan falsos positivos con prosa).
export const PATRONES = [
  ['JWT', /eyJ[A-Za-z0-9_-]{10,}/i],
  ['clave de Supabase', /sb_(?:secret|publishable)_|sbp_/i],
  ['clave de Stripe', /sk_(?:live|test)_/i],
  ['bearer', /bearer\s+[A-Za-z0-9._-]{10,}/i],
  ['cabecera de autorización', /authorization\s*:/i],
  ['token', /(?:access|refresh)_token\s*[=:]\s*\S{10,}/i],
  ['apikey', /api_?key\s*[=:]\s*\S{10,}/i],
  ['token o firma en una URL', /(?:token|signature)=\S{16,}/i],
  ['firma de AWS', /x-amz-signature/i],
];

/** Motivos por los que el texto parece llevar una credencial (sin el contenido que coincidió). */
export function motivos(texto) {
  const variantes = [texto];
  try { variantes.push(decodeURIComponent(texto)); } catch { /* `%` suelto: se queda con el texto crudo */ }
  variantes.push(...variantes.map((v) => v.replace(/\s+/g, '')));
  return PATRONES.filter(([, re]) => variantes.some((v) => re.test(v))).map(([n]) => n);
}

export function problemasDe(archivo, texto) {
  const p = archivo.endsWith('.json') ? validarJson(texto) : validarLineas(texto, archivo.endsWith('.md') ? LINEAS_MD : LINEAS_TXT);
  const m = motivos(texto);
  if (m.length > 0) p.push(`patrón de credencial (${m.join(', ')})`);
  return p;
}

export function revisar(archivos = ARCHIVOS_DEL_ARTEFACTO) {
  const hallazgos = [];
  for (const archivo of archivos) {
    let texto;
    try {
      if (statSync(archivo).size > MAX_BYTES) { hallazgos.push(`${archivo}: archivo demasiado grande; no se sube`); continue; }
      texto = readFileSync(archivo, 'utf8');
    } catch {
      hallazgos.push(`${archivo}: falta o no se puede leer; no se sube`);
      continue;
    }
    const p = problemasDe(archivo, texto);
    if (p.length > 0) hallazgos.push(`${archivo}: ${p.slice(0, 5).join('; ')}; no se sube`);
  }
  return hallazgos;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2);
  const hallazgos = revisar(args.length > 0 ? args : undefined);
  for (const h of hallazgos) console.error(`::error::${h}`);
  if (hallazgos.length > 0) process.exit(1);
  console.log('Reporte de la medición: formato esperado y sin patrones de credenciales.');
}
