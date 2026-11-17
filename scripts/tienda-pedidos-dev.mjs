#!/usr/bin/env node
// Enciende, apaga o consulta la bandera de plataforma `tienda_pedidos` (MSF-176, D-19 y D-24) SOLO en el entorno dev.
//
//   node scripts/tienda-pedidos-dev.mjs encender --entorno dev
//   node scripts/tienda-pedidos-dev.mjs apagar   --entorno dev
//   node scripts/tienda-pedidos-dev.mjs estado   --entorno dev
//
// La bandera (`public.banderas_plataforma`, clave `tienda_pedidos`) nace APAGADA en todo entorno y gobierna «Mi cuenta»,
// favoritos, lista de pedido y presupuesto desde la tienda. En esta épica solo se enciende en dev, para probar: staging y
// producción NO se encienden (se necesita una decisión nueva con demanda medida, D-24). Por eso el script se NIEGA a operar
// (código de salida distinto de 0 y mensaje en castellano) si:
//   * no recibe `--entorno dev` explícito, o
//   * no puede demostrar que la conexión es la de dev.
//
// La conexión, las defensas contra un destino que no es dev disfrazado de dev y el marcador de dev están en el módulo común
// `scripts/banderas-dev.mjs` (los comparte con `scripts/tienda-opiniones-dev.mjs`); lo específico de esta bandera son la clave,
// el prefijo de las variables de entorno y los textos.

import {
  ACCIONES,
  CONTENEDOR_DEV,
  ErrorEntorno,
  ORGS_DEMO_SEED,
  VARIABLES_PG_PELIGROSAS,
  comandoPara,
  entornoLimpio,
  esHostDev,
  ejecutarComoScript,
  ejecutarProceso,
  leerArgumentos as leerArgumentosComunes,
  motivoUrlAmbigua,
  pathToFileURL,
  principal as principalComun,
  redactar,
  resolverDestino as resolverDestinoComun,
  sqlMarcadorDev as sqlMarcadorDevComun,
  sqlPara as sqlParaComun,
} from './banderas-dev.mjs';

export const CLAVE_BANDERA = 'tienda_pedidos';
export const PREFIJO_ENV = 'TIENDA_PEDIDOS_DEV';
export { CONTENEDOR_DEV, VARIABLES_PG_PELIGROSAS, ORGS_DEMO_SEED, ErrorEntorno };

export const USO = [
  'Uso: node scripts/tienda-pedidos-dev.mjs <encender|apagar|estado> --entorno dev',
  'Solo opera en dev (D-24): staging y producción no se encienden en esta épica.',
].join('\n');

const NEGACION = 'La bandera tienda_pedidos solo se enciende en dev; staging y producción no, en esta épica (D-24).';
const MENSAJE_NO_EXISTE = '¿se aplicó la migración 20270320100000_tienda_capacidad.sql?';

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

export { ACCIONES, comandoPara, entornoLimpio, esHostDev, ejecutarProceso, motivoUrlAmbigua, redactar };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await ejecutarComoScript('scripts/tienda-pedidos-dev.mjs', OPCIONES);
}
