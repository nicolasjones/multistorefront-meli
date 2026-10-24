// Importa los dashboards versionados de Superset y registra sus reportes en la base de la app
// (F-REN-01, FR-009). Contrato original: specs/20261003-105444-cicd-staging-produccion/contracts/
// cli-importar-dashboards-superset.md. Esta versión suma:
//   - `--directorio <carpeta>`: empaqueta los YAML versionados (con `empaquetar-dashboards.mjs`) y
//     los importa; es lo que usan CI y el despliegue para no depender de un ZIP a mano.
//   - registro idempotente en `public.reportes` (con `seccion`) a partir de `reportes.json`, cuando
//     están `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `SUPERSET_REPORTE_CREADO_POR`.
//   - contraseñas de las conexiones por entorno (`passwords` del import), nunca en Git.
//
// La service-role key se usa SOLO acá, server-side, para escribir el catálogo de reportes; jamás en
// el navegador. Los mensajes de error se redactan (nunca imprimen credenciales).
import { readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { argumentValue, redactError } from '../../scripts/operaciones.mjs';
import { conexionesDelDirectorio, empaquetarDashboards } from './empaquetar-dashboards.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validarEntorno(entorno) {
  if (!['staging', 'production'].includes(entorno)) {
    throw new Error('Uso: node infra/superset/importar-dashboards.mjs --source <paquete.zip> --entorno staging|production');
  }
}

export function validarPaquete(paquete) {
  if (!Buffer.isBuffer(paquete) || paquete.length === 0) throw new Error('El paquete de dashboards está vacío.');
}

// Una entrada por dashboard: el UUID es el de EMBEDDING (el que va al guest token), no el interno
// del dashboard. Ver docs/operar-superset.md, «Mapeo de UUIDs».
export function validarReportes(manifiesto) {
  if (!manifiesto || !Array.isArray(manifiesto.reportes)) {
    throw new Error('reportes.json debe tener un arreglo "reportes".');
  }
  for (const reporte of manifiesto.reportes) {
    if (!reporte.nombre || !UUID.test(reporte.dashboard_uuid ?? '')) {
      throw new Error('Cada reporte de reportes.json necesita "nombre" y un "dashboard_uuid" UUID.');
    }
    if (reporte.seccion !== undefined && reporte.seccion !== null && String(reporte.seccion).trim() === '') {
      throw new Error(`El reporte ${reporte.nombre} tiene una sección vacía.`);
    }
  }
  return manifiesto.reportes;
}

export function mapasDeContrasenas(archivos, contrasena) {
  if (!contrasena) return undefined;
  return Object.fromEntries(archivos.map((archivo) => [archivo, contrasena]));
}

export async function importarPaquete({ paquete, fetch, config, passwords, timeout = 60_000 }) {
  validarPaquete(paquete);
  const baseUrl = config.supersetUrl.replace(/\/$/, '');
  const senal = () => AbortSignal.timeout(timeout);

  const loginResponse = await fetch(`${baseUrl}/api/v1/security/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: config.username, password: config.password, provider: 'db', refresh: false }),
    signal: senal(),
  });
  if (!loginResponse.ok) throw new Error(`Login de Superset devolvió HTTP ${loginResponse.status}.`);
  const { access_token: accessToken } = await loginResponse.json();
  if (!accessToken) throw new Error('Superset no devolvió un token de acceso.');

  const csrfResponse = await fetch(`${baseUrl}/api/v1/security/csrf_token/`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: senal(),
  });
  if (!csrfResponse.ok) throw new Error(`Obtener el CSRF token de Superset devolvió HTTP ${csrfResponse.status}.`);
  const { result: csrfToken } = await csrfResponse.json();

  const formData = new FormData();
  formData.append('formData', new Blob([paquete]), 'dashboard_export.zip');
  formData.append('overwrite', 'true');
  if (passwords && Object.keys(passwords).length > 0) formData.append('passwords', JSON.stringify(passwords));

  const importResponse = await fetch(`${baseUrl}/api/v1/dashboard/import/`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'x-csrftoken': csrfToken },
    body: formData,
    signal: senal(),
  });
  if (!importResponse.ok) throw new Error(`Import de Superset devolvió HTTP ${importResponse.status}.`);
  return importResponse;
}

async function pedirJson(fetch, url, opciones) {
  const respuesta = await fetch(url, opciones);
  if (!respuesta.ok) throw new Error(`Supabase respondió HTTP ${respuesta.status}.`);
  const texto = await respuesta.text();
  return texto ? JSON.parse(texto) : null;
}

// Registro idempotente: upsert por `superset_dashboard_uuid` (no duplica al reimportar) y upsert de
// los roles por defecto por (reporte_id, rol_id). `administrador` nunca va: tiene acceso
// incondicional y la tabla lo prohíbe con un CHECK.
export async function registrarReportes({ reportes, fetch, config }) {
  const baseUrl = config.supabaseUrl.replace(/\/$/, '');
  const cabeceras = {
    apikey: config.serviceRoleKey,
    authorization: `Bearer ${config.serviceRoleKey}`,
    'content-type': 'application/json',
    prefer: 'resolution=merge-duplicates,return=representation',
  };
  const registrados = [];
  for (const reporte of reportes) {
    const [fila] = await pedirJson(fetch, `${baseUrl}/rest/v1/reportes?on_conflict=superset_dashboard_uuid`, {
      method: 'POST',
      headers: cabeceras,
      body: JSON.stringify({
        superset_dashboard_uuid: reporte.dashboard_uuid,
        nombre: reporte.nombre,
        seccion: reporte.seccion ?? null,
        creado_por: config.creadoPor,
      }),
    });
    if (!fila?.id) throw new Error(`Supabase no devolvió el reporte ${reporte.nombre}.`);

    const roles = (reporte.rolesPorDefecto ?? []).filter((rol) => rol && rol !== 'administrador');
    for (const rol of roles) {
      await pedirJson(fetch, `${baseUrl}/rest/v1/reportes_roles_default?on_conflict=reporte_id,rol_id`, {
        method: 'POST',
        headers: cabeceras,
        body: JSON.stringify({ reporte_id: fila.id, rol_id: rol }),
      });
    }
    registrados.push({ id: fila.id, nombre: reporte.nombre });
  }
  return registrados;
}

export async function ejecutar({ args, fetch = globalThis.fetch, env = process.env }) {
  const entorno = argumentValue(args, '--entorno');
  validarEntorno(entorno);

  const directorio = argumentValue(args, '--directorio');
  const origen = argumentValue(args, '--source');
  if (!directorio && !origen) throw new Error('Falta --source con la ruta al paquete exportado (.zip) o --directorio con los YAML versionados.');

  let paquete;
  let archivosConexion = [];
  let manifiesto = null;
  if (directorio) {
    let info;
    try {
      info = await stat(directorio);
    } catch {
      throw new Error(`No se pudo leer el paquete en ${directorio}.`);
    }
    if (!info.isDirectory()) throw new Error(`${directorio} no es un directorio.`);
    paquete = await empaquetarDashboards({
      directorio,
      variables: { SUPERSET_ANALITICA_DB_HOST: env.SUPERSET_ANALITICA_DB_HOST },
    });
    archivosConexion = await conexionesDelDirectorio(directorio);
    try {
      manifiesto = JSON.parse(await readFile(path.join(directorio, 'reportes.json'), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`No se pudo leer reportes.json: ${error.message}`);
    }
    // Se escribe el paquete al lado del directorio solo para inspección/auditoría local.
    const destino = argumentValue(args, '--salida');
    if (destino) await writeFile(destino, paquete);
  } else {
    try {
      paquete = await readFile(origen);
    } catch {
      throw new Error(`No se pudo leer el paquete en ${origen}.`);
    }
    const reportes = argumentValue(args, '--reportes');
    if (reportes) manifiesto = JSON.parse(await readFile(reportes, 'utf8'));
  }

  // Las credenciales se resuelven recién después de validar y leer el paquete: un archivo faltante
  // falla rápido con su propio mensaje (contrato del CLI), sin pedir nada a la red.
  const requerir = (nombre) => {
    const valor = env[nombre]?.trim();
    if (!valor) throw new Error(`Falta la variable de entorno requerida ${nombre}.`);
    return valor;
  };
  const config = {
    supersetUrl: requerir('SUPERSET_URL'),
    username: requerir('SUPERSET_USERNAME'),
    password: requerir('SUPERSET_PASSWORD'),
  };

  await importarPaquete({
    paquete,
    fetch,
    config,
    passwords: mapasDeContrasenas(archivosConexion, env.SUPERSET_ANALITICA_DB_PASSWORD),
  });
  console.log(`Paquete importado contra Superset de ${entorno}.`);

  if (!manifiesto) return { registrados: [] };
  const reportes = validarReportes(manifiesto);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.SUPERSET_REPORTE_CREADO_POR) {
    console.warn('reportes.json presente, pero faltan SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o SUPERSET_REPORTE_CREADO_POR: no se registraron reportes.');
    return { registrados: [] };
  }
  if (!UUID.test(env.SUPERSET_REPORTE_CREADO_POR)) {
    throw new Error('SUPERSET_REPORTE_CREADO_POR debe ser el UUID de un usuario existente.');
  }
  const registrados = await registrarReportes({
    reportes,
    fetch,
    config: {
      supabaseUrl: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      creadoPor: env.SUPERSET_REPORTE_CREADO_POR,
    },
  });
  console.log(`Reportes registrados/actualizados: ${registrados.map((reporte) => reporte.nombre).join(', ')}.`);
  return { registrados };
}

async function main() {
  try {
    await ejecutar({ args: process.argv.slice(2) });
  } catch (error) {
    console.error(redactError(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main();
}
