#!/usr/bin/env node
// Verifica que el BUNDLE web (el que se sirve en dev) trae la funcionalidad de opiniones de productos.
//
//   node scripts/verificar-bundle-tienda-opiniones.mjs [carpeta del bundle]
//
// Por qué: la bandera `tienda_opiniones` es del SERVIDOR, así que encenderla en dev no garantiza que el front desplegado
// tenga la pantalla: si el bundle que se sirve es viejo, la tienda queda sin bloque de opiniones y el panel sin «Opiniones»,
// y no se nota (con la bandera apagada la ficha es idéntica a la de antes). Este chequeo lee el bundle ya construido y
// exige que estén los textos de la pantalla del panel, del bloque de la ficha, del formulario y de la pestaña de la cuenta.
//
// Sale con código 0 si están todos; con código 1 si falta alguno (o si no hay bundle: hay que correr `pnpm build` antes).

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const BUNDLE_POR_DEFECTO = 'apps/web/dist';

// Textos que solo existen si la funcionalidad está en el bundle. Son literales del código (no se obfuscan al minificar).
export const MARCADORES = [
  { archivo: 'pantalla «Opiniones» del panel', texto: 'Moderá las opiniones que los clientes dejan sobre tus productos' },
  { archivo: 'bloque de opiniones de la ficha', texto: 'Todavía no hay opiniones' },
  { archivo: 'formulario «Tu opinión»', texto: 'Gracias, tu opinión se publicará cuando la revisemos' },
  { archivo: 'pestaña «Mis opiniones» de la cuenta', texto: 'Mis opiniones' },
];

// Los .js del bundle (assets). Los .css y .map no llevan estos textos.
export function jsDelBundle(carpeta) {
  const assets = path.join(carpeta, 'assets');
  if (!fs.existsSync(assets)) return [];
  return fs.readdirSync(assets).filter((f) => f.endsWith('.js')).map((f) => path.join(assets, f));
}

// Devuelve los marcadores que NO aparecen en el bundle.
export function marcadoresFaltantes(carpeta, marcadores = MARCADORES) {
  const archivos = jsDelBundle(carpeta);
  if (archivos.length === 0) return marcadores.map((m) => m.texto);
  const contenido = archivos.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  return marcadores.filter((m) => !contenido.includes(m.texto)).map((m) => m.texto);
}

export function verificar(carpeta = BUNDLE_POR_DEFECTO) {
  if (!fs.existsSync(carpeta) || jsDelBundle(carpeta).length === 0) {
    return { ok: false, motivo: `no hay bundle construido en ${carpeta}: corré \`pnpm build\` antes de verificarlo` };
  }
  const faltantes = marcadoresFaltantes(carpeta);
  if (faltantes.length > 0) {
    const detalle = MARCADORES.filter((m) => faltantes.includes(m.texto)).map((m) => `  - ${m.archivo}: no aparece «${m.texto}»`).join('\n');
    return { ok: false, motivo: `el bundle de ${carpeta} NO trae la funcionalidad de opiniones:\n${detalle}` };
  }
  return { ok: true, motivo: `el bundle de ${carpeta} trae la funcionalidad de opiniones (${MARCADORES.length} marcadores).` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const carpeta = process.argv[2] ?? BUNDLE_POR_DEFECTO;
  const resultado = verificar(carpeta);
  console.log(resultado.motivo);
  if (!resultado.ok) process.exitCode = 1;
}
