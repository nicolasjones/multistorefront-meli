#!/usr/bin/env node
// Enciende, apaga o consulta la bandera de plataforma `tienda_opiniones` (MSF-467, D11) SOLO en el entorno dev.
//
//   node scripts/tienda-opiniones-dev.mjs encender --entorno dev
//   node scripts/tienda-opiniones-dev.mjs apagar   --entorno dev
//   node scripts/tienda-opiniones-dev.mjs estado   --entorno dev
//
// La bandera (`public.banderas_plataforma`, clave `tienda_opiniones`) nace APAGADA en todo entorno y gobierna las opiniones
// de productos: la moderación en el panel y, con la bandera encendida, la ficha y «Mi cuenta» de la tienda. Por D11 se
// enciende SOLO en dev (para probar con la gente de la tienda); staging y producción quedan apagados: encenderlas exige una
// decisión nueva de Nicolás, no este script.
//
// El script se NIEGA a operar (código de salida distinto de 0 y mensaje en castellano) si:
//   * no recibe `--entorno dev` explícito, o
//   * no puede demostrar que la conexión es la de dev.
//
// La conexión, las defensas contra un destino que no es dev disfrazado de dev y el marcador de dev están en el módulo común
// `scripts/banderas-dev.mjs` (los comparte con `scripts/tienda-pedidos-dev.mjs`); lo específico de esta bandera son la clave,
// el prefijo de las variables de entorno y los textos.

import {
  CONTENEDOR_DEV,
  ErrorEntorno,
  ORGS_DEMO_SEED,
  comandoPara,
  ejecutarComoScript,
  leerArgumentos as leerArgumentosComunes,
  pathToFileURL,
  principal as principalComun,
  resolverDestino as resolverDestinoComun,
  sqlMarcadorDev as sqlMarcadorDevComun,
  sqlPara as sqlParaComun,
} from './banderas-dev.mjs';

export const CLAVE_BANDERA = 'tienda_opiniones';
export const PREFIJO_ENV = 'TIENDA_OPINIONES_DEV';
export { CONTENEDOR_DEV, ORGS_DEMO_SEED, ErrorEntorno };

export const USO = [
  'Uso: node scripts/tienda-opiniones-dev.mjs <encender|apagar|estado> --entorno dev',
  'Solo opera en dev (D11): staging y producción quedan apagados.',
].join('\n');

const NEGACION = 'La bandera tienda_opiniones solo se enciende en dev; staging y producción quedan apagados (D11).';
const MENSAJE_NO_EXISTE = '¿se aplicó la migración 20270341000000_opiniones_producto.sql?';

const OPCIONES = { clave: CLAVE_BANDERA, prefijoEnv: PREFIJO_ENV, uso: USO, negacion: NEGACION, mensajeNoExiste: MENSAJE_NO_EXISTE };

export function leerArgumentos(argv) {
  return leerArgumentosComunes(argv, USO);
}

export function resolverDestino(destino) {
  return resolverDestinoComun({ ...destino, prefijoEnv: PREFIJO_ENV, negacion: NEGACION });
}

export function sqlMarcadorDev(env = {}) {
  return sqlMarcadorDevComun(env, PREFIJO_ENV);
}

export function sqlPara(accion) {
  return sqlParaComun(CLAVE_BANDERA, accion);
}

export async function principal(argv, env = process.env, deps = {}) {
  return principalComun(OPCIONES, argv, env, deps);
}

export { comandoPara };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await ejecutarComoScript('scripts/tienda-opiniones-dev.mjs', OPCIONES);
}
