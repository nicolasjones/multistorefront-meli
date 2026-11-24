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
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TIENDAS, VISTAS } from './medir-tienda-lighthouse.mjs';

/** Los archivos que sube el artefacto `medir-tienda`: el `path:` del workflow tiene que ser exactamente esta lista. */
export const ARCHIVOS_DEL_ARTEFACTO = [
  'reports/lighthouse-tienda/resumen.md',
  'reports/lighthouse-tienda/resumen.json',
  'reports/medir-tienda/rpc-catalogo.txt',
];

export const MAX_BYTES = 1024 * 1024;
const MAX_LINEA = 400;

const escapar = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alternativas = (lista) => lista.map(escapar).join('|');

// Valores CERRADOS: salen de las constantes del script de medición (tiendas y vistas) y de la lista de modos de
// `scripts/medir-tienda-catalogo.sql` (un test ata cada lista a su generador). Ningún texto libre cabe.
export const ETIQUETAS_VALIDAS = TIENDAS.flatMap((t) => VISTAS.map((v) => `${t.nombre} · ${v}`));
export const HOSTS_VALIDOS = TIENDAS.map((t) => t.host);
export const MODOS_RPC = ['relevancia', 'precio_asc', 'precio_desc', 'precio_max', 'solo_stock'];

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ETQ = `(?:${alternativas(ETIQUETAS_VALIDAS)})`;
const URL_MEDIDA = `http://(?:${alternativas(HOSTS_VALIDOS)}):\\d{4,5}/(?:catalogo|producto/${UUID})`;
const ETIQUETA = new RegExp(`^${ETQ}$`, 'u');
const URL_RUTA = new RegExp(`^${URL_MEDIDA}$`);
const MS = '(?:\\d{1,6} ms|—)';
const PUNTO = '(?:\\d{1,3}|—)';

export const LINEAS_MD = [
  /^\| Pantalla \| URL \| Corridas \| LCP \| FCP \| CLS \| TBT \| Perf\. \| A11y \|$/,
  /^\|---\|---\|---\|---\|---\|---\|---\|---\|---\|$/,
  new RegExp(`^\\| ${ETQ} \\| ${URL_MEDIDA} \\| \\d{1,2} \\| ${MS} \\| ${MS} \\| (?:\\d{1,2}\\.\\d{3}|—) \\| ${MS} \\| ${PUNTO} \\| ${PUNTO} \\|$`, 'u'),
  /^$/,
  new RegExp(`^Objetivo: LCP ≤ \\d{1,6} ms \\(celular 390×844, CPU ×4, «4G lento»\\)\\. LCP máximo medido: ${MS}\\. Veredicto: (?:cumple|NO cumple)\\.$`),
  new RegExp(`^Línea base del job \`medir\`: \\d{1,6} ms \\(si el máximo la supera, es una regresión y el job falla\\)\\. Estado: (?:REGRESIÓN|sin regresión)\\.$`),
  /^El job `medir` falla si alguna ruta no se midió, si el LCP no llega al objetivo \(\d{1,6} ms\) o si supera la línea base \(\d{1,6} ms\)\.$/,
  new RegExp(`^Sin medir \\(no hay reporte o el reporte no trae la auditoría del LCP\\): ${ETQ}(?:, ${ETQ}){0,7}\\.$`, 'u'),
];
const CABECERA_MD = LINEAS_MD[0];

export const LINEAS_TXT = [
  /^(?:BEGIN|COMMIT|ROLLBACK|DO|SET|CREATE TABLE|DROP TABLE|\(1 row\)|-{3,}|)$/,
  /^ set_config $/,
  /^ \d{1,7}$/,
  /^(?:INSERT 0|UPDATE) \d{1,7}$/,
  new RegExp(`^psql:<stdin>:\\d{1,5}: NOTICE: {2}catalogo (?:${alternativas(MODOS_RPC)}) -> mediana \\d{1,7} ms · corridas \\{\\d{1,7}(?:,\\d{1,7}){0,19}\\} · productos en la pagina \\d{1,5} · total \\d{1,7}$`),
];

const CLAVES_RAIZ = ['objetivoLcpMs', 'lineaBaseLcpMs', 'filas', 'lcpMaximo', 'sinMedir', 'cumple', 'regresion'];
const CLAVES_FILA = ['etiqueta', 'url', 'corridas', 'lcp', 'fcp', 'cls', 'tbt', 'performance', 'accessibility'];
const numeroONull = (v) => v === null || (typeof v === 'number' && Number.isFinite(v));
const mismasClaves = (obj, claves) => {
  const k = Object.keys(obj);
  return k.length === claves.length && claves.every((c) => k.includes(c));
};

const PISTA = (constantes) => `Si el generador cambió legítimamente, actualizá ${constantes} en scripts/verificar-reporte-sin-credenciales.mjs y su test.`;

function validarLineas(texto, patrones, { requiere }) {
  const problemas = [];
  const lineas = texto.split('\n');
  lineas.forEach((linea, i) => {
    if (i === lineas.length - 1 && linea === '') return; // salto de línea final
    if (linea.length > MAX_LINEA) return problemas.push(`línea ${i + 1}: demasiado larga`);
    if (!patrones.some((re) => re.test(linea))) problemas.push(`línea ${i + 1}: no tiene el formato esperado`);
  });
  if (!lineas.some(requiere)) problemas.push('falta el contenido mínimo esperado');
  return problemas;
}

/** Todos los strings (claves y valores) de un valor JSON ya parseado. */
function textosDe(valor, acc = []) {
  if (typeof valor === 'string') acc.push(valor);
  else if (Array.isArray(valor)) valor.forEach((v) => textosDe(v, acc));
  else if (valor && typeof valor === 'object') for (const [k, v] of Object.entries(valor)) { acc.push(k); textosDe(v, acc); }
  return acc;
}

function validarJson(texto) {
  let d;
  try { d = JSON.parse(texto); } catch { return ['no es JSON válido']; }
  const p = [];
  if (!d || typeof d !== 'object' || Array.isArray(d) || !mismasClaves(d, CLAVES_RAIZ)) return ['claves de primer nivel distintas de las esperadas'];
  for (const c of ['objetivoLcpMs', 'lineaBaseLcpMs', 'lcpMaximo']) if (!numeroONull(d[c])) p.push(`${c}: tipo inesperado`);
  for (const c of ['cumple', 'regresion']) if (typeof d[c] !== 'boolean') p.push(`${c}: tipo inesperado`);
  if (!Array.isArray(d.sinMedir) || d.sinMedir.length > 8 || !d.sinMedir.every((e) => typeof e === 'string' && ETIQUETA.test(e))) p.push('sinMedir: valores inesperados');
  if (!Array.isArray(d.filas) || d.filas.length > 8) return [...p, 'filas: valores inesperados'];
  d.filas.forEach((f, i) => {
    const ok = f && typeof f === 'object' && !Array.isArray(f) && mismasClaves(f, CLAVES_FILA)
      && typeof f.etiqueta === 'string' && ETIQUETA.test(f.etiqueta) && typeof f.url === 'string' && URL_RUTA.test(f.url)
      && ['corridas', 'lcp', 'fcp', 'cls', 'tbt', 'performance', 'accessibility'].every((c) => numeroONull(f[c]));
    if (!ok) p.push(`filas[${i}]: valores inesperados`);
  });
  // Los strings parseados (un `eyJ…` escapado no aparece igual en el texto crudo).
  const m = textosDe(d).flatMap(motivos);
  if (m.length > 0) p.push(`patrón de credencial en un valor (${[...new Set(m)].join(', ')})`);
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
const MAX_DECODIFICACIONES = 5;

/** Motivos por los que el texto parece llevar una credencial (sin el contenido que coincidió). */
export function motivos(texto) {
  // Se decodifica `%XX` hasta el punto fijo (con tope): `%2565yJ` es `%65yJ` y luego `eyJ`.
  const variantes = [texto];
  let actual = texto;
  for (let i = 0; i < MAX_DECODIFICACIONES; i += 1) {
    let siguiente;
    try { siguiente = decodeURIComponent(actual); } catch { break; } // `%` suelto: se queda con lo ya decodificado
    if (siguiente === actual) break;
    variantes.push(siguiente);
    actual = siguiente;
  }
  variantes.push(...variantes.map((v) => v.replace(/\s+/g, '')));
  return PATRONES.filter(([, re]) => variantes.some((v) => re.test(v))).map(([n]) => n);
}

const POR_NOMBRE = {
  'resumen.md': { pista: PISTA('LINEAS_MD, ETIQUETAS_VALIDAS y HOSTS_VALIDOS'), valida: (t) => validarLineas(t, LINEAS_MD, { requiere: (l) => CABECERA_MD.test(l) }) },
  'resumen.json': { pista: PISTA('CLAVES_RAIZ, CLAVES_FILA y validarJson'), valida: validarJson },
  'rpc-catalogo.txt': { pista: PISTA('LINEAS_TXT y MODOS_RPC'), valida: (t) => validarLineas(t, LINEAS_TXT, { requiere: (l) => l.trim() !== '' }) },
};

export function problemasDe(nombre, texto) {
  const regla = POR_NOMBRE[nombre];
  const p = regla.valida(texto);
  const m = motivos(texto);
  if (m.length > 0 && !p.some((x) => x.startsWith('patrón de credencial'))) p.push(`patrón de credencial (${m.join(', ')})`);
  return p;
}

export function revisar(archivos = ARCHIVOS_DEL_ARTEFACTO) {
  const hallazgos = [];
  for (const archivo of archivos) {
    const nombre = path.basename(archivo);
    if (!Object.hasOwn(POR_NOMBRE, nombre)) {
      hallazgos.push(`${archivo}: nombre de archivo no esperado (sólo ${Object.keys(POR_NOMBRE).join(', ')}); no se sube. ${PISTA('POR_NOMBRE y ARCHIVOS_DEL_ARTEFACTO')}`);
      continue;
    }
    let texto;
    try {
      const st = lstatSync(archivo); // `lstat`: un enlace simbólico no se sigue
      if (!st.isFile()) { hallazgos.push(`${archivo}: no es un archivo regular (enlace u otro tipo); no se sube`); continue; }
      if (st.size > MAX_BYTES) { hallazgos.push(`${archivo}: archivo demasiado grande; no se sube`); continue; }
      texto = readFileSync(archivo, 'utf8');
    } catch {
      hallazgos.push(`${archivo}: falta o no se puede leer; no se sube`);
      continue;
    }
    const p = problemasDe(nombre, texto);
    if (p.length > 0) hallazgos.push(`${archivo}: ${p.slice(0, 5).join('; ')}; no se sube. ${POR_NOMBRE[nombre].pista}`);
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
