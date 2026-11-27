// Verifica un CSV descargado de un tablero embebido de Superset (MSF-761, MSF-326): BOM UTF-8 al inicio y escape de fórmulas.
// Se corre a mano contra el archivo que baja `pnpm dev:superset` (paso 3 y 4 de docs/operar-superset.md, «Exportar reportes a CSV»):
//   node infra/superset/verificar-csv-superset.mjs <archivo.csv> [--celda "=1+1"]
// Sale con 0 si el BOM está y la celda de prueba salió escapada; con 1 si no, imprimiendo qué falló. No imprime el contenido del CSV.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const DISPARADORES = ['=', '+', '-', '@'];

/** Analiza los bytes del CSV. `celda` es el texto que se cargó como dato de prueba (por defecto `=1+1`). */
export function analizarCsv(bytes, celda = '=1+1') {
  if (!Buffer.isBuffer(bytes)) throw new Error('Se esperaba un Buffer con el CSV.');
  if (!DISPARADORES.includes(celda[0])) throw new Error('La celda de prueba debe empezar con = + - o @.');
  const tieneBom = bytes.subarray(0, 3).equals(BOM);
  // Un BOM duplicado (el hook corriendo dos veces) se ve como U+FEFF al inicio del texto sin BOM.
  const texto = bytes.subarray(tieneBom ? 3 : 0).toString('utf8');
  const bomDuplicado = tieneBom && texto.startsWith('﻿');
  const celdas = texto.split(/\r?\n/).flatMap((linea) => linea.split(';')).map((c) => c.replace(/^"|"$/g, ''));
  const escapada = celdas.includes(`'${celda}`);
  const sinEscapar = celdas.includes(celda);
  return { tieneBom, bomDuplicado, escapada, sinEscapar, encontrada: escapada || sinEscapar };
}

/** Devuelve la lista de problemas (vacía = todo bien). */
export function problemas(analisis) {
  const lista = [];
  if (!analisis.tieneBom) lista.push('El archivo no empieza con los bytes EF BB BF (BOM UTF-8): Excel lo abrirá como ANSI.');
  if (analisis.bomDuplicado) lista.push('El BOM aparece dos veces.');
  if (!analisis.encontrada) lista.push('La celda de prueba no está en el CSV: cargá un cliente o producto con ese nombre y bajá un reporte que lo incluya.');
  else if (analisis.sinEscapar) lista.push('La celda de prueba salió SIN apóstrofo: Excel la calcularía como fórmula. Neutralizar en la vista o dataset.');
  return lista;
}

async function main() {
  const [archivo, ...resto] = process.argv.slice(2);
  const i = resto.indexOf('--celda');
  if (!archivo) {
    console.error('Uso: node infra/superset/verificar-csv-superset.mjs <archivo.csv> [--celda "=1+1"]');
    process.exit(2);
  }
  const fallas = problemas(analizarCsv(await readFile(archivo), i >= 0 ? resto[i + 1] : '=1+1'));
  if (fallas.length === 0) console.log('OK: BOM presente y la celda de prueba salió escapada.');
  else fallas.forEach((f) => console.error(`FALLA: ${f}`));
  process.exit(fallas.length === 0 ? 0 : 1);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((e) => { console.error(`Error: ${e.message}`); process.exit(2); });
}
