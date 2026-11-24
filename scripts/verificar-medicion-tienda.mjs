#!/usr/bin/env node
// Guarda documental de la medición de rendimiento de la tienda (MSF-552 · T071/SC-010 de MSF-167).
//
// Qué comprueba: que la sección «Rendimiento en celular (T071, SC-010)» de `docs/tiendas-online.md` TENGA las
// cifras medidas, con su entorno y su fuente. Sin esta guarda, el criterio puede volver a cerrarse «sin medir»
// (pasó en el cierre de MSF-167: la tarea quedó marcada como cumplida sin evidencia).
//
// Reglas (cada una es un requisito de T071):
//   1. La sección existe y no dice «No medido todavía» ni «sin medir».
//   2. Están las CUATRO rutas medidas: catálogo y ficha de las dos tiendas del seed (cada fila con su LCP en ms).
//      Se comprueban por ruta (host + path), no contando filas: una fila repetida no es otra ruta.
//   3. Está la medición de `publico.catalogo_pagina_por_dominio` con el tamaño del catálogo usado.
//   4. Está el entorno de la medición y de dónde salen las cifras (workflow o reporte).
//   5. Está declarada la línea base del job `medir` (la que usa el script para detectar regresiones).
//
// Uso: node scripts/verificar-medicion-tienda.mjs [ruta-del-doc]
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const TITULO = '### Rendimiento en celular (T071, SC-010)';

/** Las cuatro rutas que la medición tiene que cubrir (catálogo y ficha de cada tienda del seed). */
export const RUTAS_ESPERADAS = [
  { host: 'mundojc.localhost', ruta: '/catalogo' },
  { host: 'mundojc.localhost', ruta: '/producto/:id' },
  { host: 'sanjavucho.localhost', ruta: '/catalogo' },
  { host: 'sanjavucho.localhost', ruta: '/producto/:id' },
];

/** Host y ruta de una fila de la tabla de la sección (la URL va entre comillas invertidas). */
export function rutaDeFila(linea) {
  const m = linea.match(/https?:\/\/([a-z0-9.-]+)(?::\d+)?(\/[^\s`|)]*)/i);
  if (!m) return null;
  const ruta = m[2].replace(/\/+$/, '');
  return { host: m[1].toLowerCase(), ruta: ruta.startsWith('/producto/') ? '/producto/:id' : ruta };
}

export function extraerSeccion(texto, titulo = TITULO) {
  const indice = texto.indexOf(titulo);
  if (indice < 0) return null;
  const resto = texto.slice(indice + titulo.length);
  const corte = resto.search(/\n#{2,3} /);
  return (corte < 0 ? resto : resto.slice(0, corte)).trim();
}

/** Problemas de la sección (vacío = la medición está registrada como corresponde). */
export function revisarSeccion(seccion) {
  const problemas = [];
  if (!seccion) return [`No se encontró la sección «${TITULO}» en docs/tiendas-online.md.`];
  if (/no medido todav[ií]a|sin medir/i.test(seccion)) {
    problemas.push('La sección dice que la medición no está hecha («No medido todavía» / «sin medir»): registrá las cifras medidas.');
  }
  const filas = seccion.split('\n').filter((linea) => linea.trim().startsWith('|'));
  // Una ruta cuenta UNA vez: se la reconoce por host y path, no por la cantidad de filas.
  const medidas = new Set();
  for (const linea of filas) {
    if (!/\d+\s*ms/.test(linea)) continue;
    const ruta = rutaDeFila(linea);
    if (ruta) medidas.add(`${ruta.host}${ruta.ruta}`);
  }
  const faltantes = RUTAS_ESPERADAS.filter((esperada) => !medidas.has(`${esperada.host}${esperada.ruta}`));
  if (faltantes.length) {
    problemas.push(
      `Faltan las cuatro rutas medidas con su LCP en ms (catálogo y ficha de las dos tiendas del seed): faltan ${faltantes.map((f) => `${f.host}${f.ruta}`).join(', ')}.`,
    );
  }
  if (!/catalogo_pagina_por_dominio/.test(seccion)) {
    problemas.push('Falta la medición de `publico.catalogo_pagina_por_dominio` (T071 la pide con un catálogo grande).');
  }
  if (!/\d+\s*productos/.test(seccion)) {
    problemas.push('Falta el tamaño del catálogo usado en la medición de la RPC (cuántos productos se sembraron).');
  }
  if (!/(Postgres|Supabase|seed|runner)/i.test(seccion)) {
    problemas.push('Falta el entorno de la medición (base, seed y dónde corrió).');
  }
  if (!/(workflow|run del|artifact|reporte|lighthouse-tienda|resumen\.md)/i.test(seccion)) {
    problemas.push('Falta la fuente de las cifras (workflow o reporte de donde salen).');
  }
  if (!/l[ií]nea base/i.test(seccion)) {
    problemas.push('Falta la línea base del job `medir` (el número con el que el script detecta una regresión).');
  }
  return problemas;
}

function main() {
  const ruta = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '..', 'docs', 'tiendas-online.md'));
  const seccion = extraerSeccion(readFileSync(ruta, 'utf8'));
  const problemas = revisarSeccion(seccion);
  if (problemas.length) {
    console.error('La medición de rendimiento de la tienda no está registrada como corresponde:');
    for (const problema of problemas) console.error(` - ${problema}`);
    process.exit(1);
  }
  console.log('Medición de rendimiento de la tienda: OK (cifras con entorno y fuente).');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
