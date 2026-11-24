#!/usr/bin/env node
// Último control antes de subir como artefacto el reporte de la medición de la tienda (job `medir` de
// `.github/workflows/nightly.yml`): falla si en los archivos que se suben aparece algo con forma de credencial.
// Los reportes crudos de Lighthouse traen el log de red con las URL (a veces con tokens firmados de Storage) y
// `::add-mask::` no alcanza a los artefactos; por eso sólo se suben los resúmenes y se revisan acá.
//
// Alcance: defensa en profundidad, NO una garantía. Detecta patrones conocidos (JWT, claves de Supabase y
// Stripe, cabeceras de autorización, parámetros de firma, palabras como `password`); no detecta un secreto sin
// forma reconocible. Nunca imprime el contenido que coincide (sería dejarlo en claro en el log): sólo el
// archivo y el motivo.
//
// Uso: node scripts/verificar-reporte-sin-credenciales.mjs [archivo...] (por defecto, los tres del artefacto).
// Un archivo que no existe se ignora (el job puede haber fallado antes de generarlo). Sale 1 si hay hallazgos.
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ARCHIVOS_DEL_ARTEFACTO = [
  'reports/lighthouse-tienda/resumen.md',
  'reports/lighthouse-tienda/resumen.json',
  'reports/medir-tienda/rpc-catalogo.txt',
];

export const PATRONES = [
  ['JWT', /eyJ[A-Za-z0-9_-]{10,}/i],
  ['clave de Supabase', /sb_secret_|sb_publishable_|sbp_/i],
  ['clave de Stripe', /sk_(live|test)_/i],
  ['service_role', /service_role/i],
  ['apikey', /api[_-]?key/i],
  ['token', /access_token|refresh_token|token=/i],
  ['cabecera de autorización', /authorization:|bearer /i],
  ['firma de URL', /signature=|x-amz-signature/i],
  ['password o secret', /password|secret/i],
];

/** Motivos por los que el texto parece llevar una credencial (sin el contenido que coincidió). */
export function motivos(texto) {
  return PATRONES.filter(([, re]) => re.test(texto)).map(([nombre]) => nombre);
}

export function revisar(archivos = ARCHIVOS_DEL_ARTEFACTO) {
  const hallazgos = [];
  for (const archivo of archivos) {
    if (!existsSync(archivo)) continue;
    const m = motivos(readFileSync(archivo, 'utf8'));
    if (m.length > 0) hallazgos.push(`${archivo}: parece llevar una credencial (${m.join(', ')}); no se sube`);
  }
  return hallazgos;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2);
  const hallazgos = revisar(args.length > 0 ? args : undefined);
  for (const h of hallazgos) console.error(`::error::${h}`);
  if (hallazgos.length > 0) process.exit(1);
  console.log('Reporte de la medición: sin patrones de credenciales.');
}
