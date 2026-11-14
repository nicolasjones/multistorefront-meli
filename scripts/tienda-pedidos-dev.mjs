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
// Conexión (sin secretos en el repo; el SQL viaja por stdin, nunca por argv):
//   1. Si hay `SUPABASE_DB_URL` (la misma variable de scripts/migrar-supabase-cloud.mjs), el host de la URL tiene que ser de
//      dev: una etiqueta `dev` (p. ej. `supabase-dev.212-90-120-53.sslip.io`) y ninguna de stg/staging/prd/prod/production, o
//      figurar en `TIENDA_PEDIDOS_DEV_DB_HOSTS` (lista de hosts separados por coma que la persona declara a propósito, p. ej.
//      un túnel local a la base de dev). La contraseña viaja por PGPASSWORD, no por argv. Requiere `psql`.
//   2. Sin `SUPABASE_DB_URL`, si en este equipo corre el contenedor de la base de dev
//      (`supabase_db_multistorefront-meli-supabase-dev`, el mismo nombre que usa el cron de migraciones del VPS), se usa
//      `docker exec` contra ese contenedor: es dev por construcción.
//   3. Si ninguna de las dos aplica, se niega.

import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { redactError, separarContrasena } from './operaciones.mjs';

export const CLAVE_BANDERA = 'tienda_pedidos';
export const CONTENEDOR_DEV = 'supabase_db_multistorefront-meli-supabase-dev';
export const ACCIONES = ['encender', 'apagar', 'estado'];

const ETIQUETAS_NO_DEV = new Set(['stg', 'stag', 'staging', 'prd', 'prod', 'production', 'produccion']);
const DOMINIOS_NUBE = [/(^|\.)supabase\.(co|com|io)$/i, /(^|\.)pooler\.supabase\.com$/i];

export class ErrorEntorno extends Error {}

export const USO = [
  'Uso: node scripts/tienda-pedidos-dev.mjs <encender|apagar|estado> --entorno dev',
  'Solo opera en dev (D-24): staging y producción no se encienden en esta épica.',
].join('\n');

// Un host es de dev si alguna de sus etiquetas es `dev` y ninguna es de otro entorno ni de la nube de Supabase.
export function esHostDev(host) {
  if (!host) return false;
  const h = host.toLowerCase();
  if (DOMINIOS_NUBE.some((re) => re.test(h))) return false;
  const etiquetas = h.split(/[.\-_]/).filter(Boolean);
  return etiquetas.includes('dev') && !etiquetas.some((e) => ETIQUETAS_NO_DEV.has(e));
}

function hostDeUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// Decide a qué base conectarse o se niega con un mensaje en castellano. No toca la red.
export function resolverDestino({ entorno, env = {}, contenedorDevExiste = false }) {
  if (entorno !== 'dev') {
    throw new ErrorEntorno(
      `Me niego a operar: hace falta \`--entorno dev\` explícito (recibí ${entorno ? `«${entorno}»` : 'nada'}). `
      + 'La bandera tienda_pedidos solo se enciende en dev; staging y producción no, en esta épica (D-24).',
    );
  }

  const url = (env.SUPABASE_DB_URL ?? '').trim();
  if (url) {
    const host = hostDeUrl(url);
    if (!host) {
      throw new ErrorEntorno('Me niego a operar: SUPABASE_DB_URL no es una URL de conexión válida, así que no puedo comprobar que sea la de dev.');
    }
    const declarados = (env.TIENDA_PEDIDOS_DEV_DB_HOSTS ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (declarados.includes(host.toLowerCase()) || esHostDev(host)) {
      return { modo: 'url', url, host };
    }
    throw new ErrorEntorno(
      `Me niego a operar: SUPABASE_DB_URL apunta a «${host}», que no parece el entorno dev (no tiene una etiqueta «dev» o parece staging, producción o la nube). `
      + 'Si es un túnel a la base de dev, declaralo a propósito en TIENDA_PEDIDOS_DEV_DB_HOSTS.',
    );
  }

  if (contenedorDevExiste) {
    return { modo: 'contenedor', contenedor: CONTENEDOR_DEV };
  }

  throw new ErrorEntorno(
    'Me niego a operar: no detecto el entorno dev. No hay SUPABASE_DB_URL y en este equipo no corre el contenedor '
    + `${CONTENEDOR_DEV}. Corré el script en el equipo de dev o apuntá SUPABASE_DB_URL a la base de dev.`,
  );
}

// SQL fijo por acción (nada se arma con datos de la persona).
export function sqlPara(accion) {
  switch (accion) {
    case 'encender':
      return `update public.banderas_plataforma set activa = true where clave = '${CLAVE_BANDERA}' returning activa;\n`;
    case 'apagar':
      return `update public.banderas_plataforma set activa = false where clave = '${CLAVE_BANDERA}' returning activa;\n`;
    case 'estado':
      return `select activa from public.banderas_plataforma where clave = '${CLAVE_BANDERA}';\n`;
    default:
      throw new ErrorEntorno(`La acción «${accion ?? ''}» no existe.\n${USO}`);
  }
}

// Arma el comando de psql (o docker exec) para el destino. El SQL va por stdin.
export function comandoPara(destino) {
  const base = ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'];
  if (destino.modo === 'contenedor') {
    return { comando: 'docker', args: ['exec', '-i', destino.contenedor, 'psql', '-U', 'postgres', '-d', 'postgres', ...base], env: {} };
  }
  const { urlSinContrasena, env } = separarContrasena(destino.url);
  return { comando: 'psql', args: [urlSinContrasena, ...base], env };
}

export function ejecutarProceso(comando, args, { input, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const hijo = spawn(comando, args, { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let salida = '';
    let error = '';
    hijo.stdout.on('data', (d) => { salida += d; });
    hijo.stderr.on('data', (d) => { error += d; });
    hijo.on('error', reject);
    hijo.on('close', (codigo) => resolve({ codigo, salida, error }));
    hijo.stdin.end(input ?? '');
  });
}

async function contenedorDevExiste(ejecutar) {
  try {
    const r = await ejecutar('docker', ['inspect', '--type', 'container', CONTENEDOR_DEV]);
    return r.codigo === 0;
  } catch {
    return false;
  }
}

// Orquesta una corrida. `deps.ejecutar(comando, args, { input, env }) -> { codigo, salida, error }` se inyecta en las pruebas.
export async function principal(argv, env = process.env, deps = {}) {
  const ejecutar = deps.ejecutar ?? ejecutarProceso;
  const out = deps.out ?? ((m) => console.log(m));
  const accion = argv.find((a) => !a.startsWith('--'));
  const i = argv.indexOf('--entorno');
  const entorno = i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;

  if (!ACCIONES.includes(accion)) {
    throw new ErrorEntorno(`Falta la acción (encender, apagar o estado).\n${USO}`);
  }

  const destino = resolverDestino({
    entorno,
    env,
    contenedorDevExiste: env.SUPABASE_DB_URL?.trim() ? false : await contenedorDevExiste(ejecutar),
  });
  const { comando, args, env: envProceso } = comandoPara(destino);
  const r = await ejecutar(comando, args, { input: sqlPara(accion), env: envProceso });
  if (r.codigo !== 0) {
    throw new ErrorEntorno(`No pude hablar con la base de dev (${comando} terminó con código ${r.codigo}): ${redactError(new Error(r.error.trim() || 'sin detalle'))}`);
  }
  const valor = r.salida.trim().split('\n')[0]?.trim();
  if (valor !== 't' && valor !== 'f') {
    throw new ErrorEntorno(
      `La bandera ${CLAVE_BANDERA} no existe en la base de dev: ¿se aplicó la migración 20270320100000_tienda_capacidad.sql? `
      + 'No cambié nada.',
    );
  }
  const encendida = valor === 't';
  out(`Bandera ${CLAVE_BANDERA} en dev: ${encendida ? 'ENCENDIDA' : 'APAGADA'}${accion === 'estado' ? '' : ' (cambio aplicado)'}.`);
  return encendida;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof ErrorEntorno ? error.message : redactError(error));
    process.exitCode = 1;
  });
}
