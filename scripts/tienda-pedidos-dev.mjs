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
//
// Defensas contra un destino que no es dev disfrazado de dev:
//   * la URL se rechaza si su autoridad (lo que va entre `://` y la primera `/`) tiene `?`, `,`, `%` o más de una `@` (libpq acepta
//     varios hosts separados por coma y decodifica porcentajes); y de la query solo se aceptan, por LISTA BLANCA, `sslmode`
//     (require, verify-ca, verify-full o prefer) y `connect_timeout` (un entero): `host`, `hostaddr`, `service`, `port`, `dbname`,
//     `options`, etc. pisarían el destino ya validado;
//   * del entorno del proceso hijo se borran PGHOST, PGHOSTADDR, PGSERVICE, PGSERVICEFILE, PGPASSFILE, PGPORT, PGDATABASE, PGUSER,
//     PGOPTIONS, PGSSLMODE, PGTARGETSESSIONATTRS y PGSYSCONFDIR (libpq) y DOCKER_HOST y DOCKER_CONTEXT (docker), para que nada del
//     entorno cambie el destino que ya se validó;
//   * en AMBOS modos (URL y contenedor), antes de tocar nada se comprueba POR POSITIVO, con una consulta de solo lectura, que la base
//     es la de dev: existe una organización de demostración con id fijo del seed (`supabase/seed.sql`) y nombre «… (demo)». El id
//     fijo por defecto es el de «Mundo JC (demo)» (`0f5eed00-0000-4000-8000-000000000001`) o el de «San Javucho (demo)»
//     (`…0002`); si la organización demo de dev tiene otro id, se declara a propósito en TIENDA_PEDIDOS_DEV_ORG_IDS (uuids
//     separados por coma). No hace falta escribir nada en dev; si no hay ninguna, el script se niega.

import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { separarContrasena } from './operaciones.mjs';

export const CLAVE_BANDERA = 'tienda_pedidos';
export const CONTENEDOR_DEV = 'supabase_db_multistorefront-meli-supabase-dev';
export const ACCIONES = ['encender', 'apagar', 'estado'];
// Variables de libpq que cambian el destino o la autenticación de psql: se quitan del entorno hijo.
export const VARIABLES_PG_PELIGROSAS = [
  'PGHOST', 'PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGOPTIONS',
  'PGSSLMODE', 'PGTARGETSESSIONATTRS', 'PGSYSCONFDIR', 'DOCKER_HOST', 'DOCKER_CONTEXT',
];
// Parámetros de la query de la URL que se aceptan (lista blanca) y sus valores válidos.
const PARAMETROS_URL_PERMITIDOS = {
  sslmode: (v) => ['require', 'verify-ca', 'verify-full', 'prefer'].includes(v),
  connect_timeout: (v) => /^\d{1,3}$/.test(v),
};
// Organizaciones de demostración con id fijo del seed (supabase/seed.sql). Marcador POSITIVO de dev, sin escribir nada.
export const ORGS_DEMO_SEED = ['0f5eed00-0000-4000-8000-000000000001', '0f5eed00-0000-4000-8000-000000000002'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// SQL del marcador de dev: solo lectura; los ids se validan como uuid antes de interpolarse.
export function sqlMarcadorDev(env = {}) {
  const extra = (env.TIENDA_PEDIDOS_DEV_ORG_IDS ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  for (const id of extra) {
    if (!UUID.test(id)) throw new ErrorEntorno(`TIENDA_PEDIDOS_DEV_ORG_IDS tiene un valor que no es un uuid: «${id.slice(0, 40)}».`);
  }
  const ids = [...new Set([...ORGS_DEMO_SEED, ...extra].map((x) => x.toLowerCase()))];
  return `select exists (select 1 from public.organizaciones where id = any (array[${ids.map((i) => `'${i}'`).join(', ')}]::uuid[]) and nombre like '%(demo)')::text;\n`;
}

const ETIQUETAS_NO_DEV = new Set([
  'stg', 'stag', 'stage', 'staging', 'qa', 'uat', 'test', 'pre', 'preprod', 'prod', 'prd', 'production', 'produccion',
]);
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

// Autoridad de una URL de conexión: lo que va entre `://` y la primera `/` (o el final), sin la query.
function autoridadDeUrl(url) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/]*)/i.exec(url);
  return m ? m[1] : null;
}

function hostDeUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// Motivo por el que la URL puede apuntar a otro host que el que se ve, o null si es segura de leer.
export function motivoUrlAmbigua(url) {
  const autoridad = autoridadDeUrl(url);
  if (autoridad === null) return 'no es una URL postgres://usuario@host/base';
  if (/[?,%]/.test(autoridad)) return 'la autoridad tiene «?», «,» o «%» (varios hosts o porcentajes que libpq interpreta distinto)';
  if ((autoridad.match(/@/g) ?? []).length > 1) return 'la autoridad tiene más de una «@»';
  const consulta = url.includes('?') ? url.slice(url.indexOf('?') + 1).split('#')[0] : '';
  for (const par of consulta.split('&').filter(Boolean)) {
    const i = par.indexOf('=');
    let clave = i < 0 ? par : par.slice(0, i);
    let valor = i < 0 ? '' : par.slice(i + 1);
    try { clave = decodeURIComponent(clave); valor = decodeURIComponent(valor); } catch { return 'la query tiene un parámetro con codificación ilegible'; }
    const valida = PARAMETROS_URL_PERMITIDOS[clave.toLowerCase()];
    if (!valida) return `la query trae el parámetro «${clave}», que no está en la lista permitida (solo sslmode y connect_timeout)`;
    if (!valida(valor)) return `el parámetro «${clave}» tiene un valor no permitido`;
  }
  return null;
}

// Enmascara la URL de conexión y su contraseña en un texto, usando el entorno INYECTADO (no process.env).
export function redactar(texto, env = {}) {
  const url = (env.SUPABASE_DB_URL ?? '').trim();
  let contrasena = '';
  try { contrasena = decodeURIComponent(new URL(url).password); } catch { /* sin contraseña legible */ }
  return [url, contrasena, env.PGPASSWORD]
    .filter((v) => typeof v === 'string' && v.length > 0)
    .reduce((t, v) => t.replaceAll(v, '[REDACTADO]'), String(texto));
}

// Entorno del proceso hijo sin las variables de libpq que podrían cambiar el destino ya validado.
export function entornoLimpio(base = process.env, extra = {}) {
  const env = { ...base, ...extra };
  for (const k of VARIABLES_PG_PELIGROSAS) delete env[k];
  return env;
}

// Lee los argumentos en cualquier orden: una acción y `--entorno <valor>` (o `--entorno=<valor>`).
export function leerArgumentos(argv) {
  let accion;
  let entorno;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--entorno') {
      const v = argv[i + 1];
      if (v && !v.startsWith('--')) { entorno = v; i += 1; }
    } else if (a.startsWith('--entorno=')) {
      entorno = a.slice('--entorno='.length);
    } else if (a.startsWith('--')) {
      throw new ErrorEntorno(`La opción «${a}» no existe.\n${USO}`);
    } else if (accion === undefined) {
      accion = a;
    } else {
      throw new ErrorEntorno(`Sobra el argumento «${a}»: se pide una sola acción.\n${USO}`);
    }
  }
  return { accion, entorno };
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
    const ambigua = motivoUrlAmbigua(url);
    if (ambigua) {
      throw new ErrorEntorno(`Me niego a operar: SUPABASE_DB_URL es ambigua (${ambigua}), así que no puedo comprobar que sea la de dev.`);
    }
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
    const hijo = spawn(comando, args, { env: entornoLimpio(process.env, env), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
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
  const { accion, entorno } = leerArgumentos(argv);

  if (!ACCIONES.includes(accion)) {
    throw new ErrorEntorno(`Falta la acción (encender, apagar o estado).\n${USO}`);
  }

  const destino = resolverDestino({
    entorno,
    env,
    contenedorDevExiste: env.SUPABASE_DB_URL?.trim() ? false : await contenedorDevExiste(ejecutar),
  });
  const { comando, args, env: envProceso } = comandoPara(destino);
  const correr = async (sql) => {
    const r = await ejecutar(comando, args, { input: sql, env: envProceso });
    if (r.codigo !== 0) {
      throw new ErrorEntorno(`No pude hablar con la base de dev (${comando} terminó con código ${r.codigo}): ${redactar(r.error.trim() || 'sin detalle', env)}`);
    }
    return r.salida.trim().split('\n')[0]?.trim();
  };

  // Antes de tocar nada, en URL y en contenedor: la base tiene que DECLARARSE dev (consulta de solo lectura), no solo llamarse así.
  const marcador = await correr(sqlMarcadorDev(env));
  if (marcador !== 'true') {
    throw new ErrorEntorno(
      `Me niego a operar: la base (${destino.modo === 'url' ? 'SUPABASE_DB_URL' : destino.contenedor}) no se identifica como dev: `
      + 'no tiene una organización de demostración «… (demo)» con el id fijo del seed ni con los de TIENDA_PEDIDOS_DEV_ORG_IDS. '
      + 'No cambié nada.',
    );
  }

  const valor = await correr(sqlPara(accion));
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
    console.error(error instanceof ErrorEntorno ? error.message : redactar(error instanceof Error ? error.message : error, process.env));
    process.exitCode = 1;
  });
}
