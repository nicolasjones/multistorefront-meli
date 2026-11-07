// Captura de errores de workers (MSF-369, F-OPS-03, FR-022/FR-023). Cliente mínimo compatible con
// GlitchTip/Sentry, sin dependencias: el evento lleva `EJECUCION_ID` (tag) para enlazarlo con `/ejecuciones`.
// Sin ERRORES_DSN es un no-op. Nunca lanza ni espera más de unos segundos: un fallo del envío no cambia el
// código de salida del worker. El mensaje se limpia (correos, teléfonos, tokens) antes de enviarse.
import { randomUUID } from 'node:crypto';

const CORREO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER = /bearer\s+\S+/gi;
const TOKEN_LARGO = /[A-Za-z0-9_-]{32,}/g;
const TELEFONO = /\+?\d[\d\s().-]{6,}\d/g;
const URL_CON_CLAVE = /(\w+:\/\/)[^\s/@]+@/g;

export function limpiarTexto(texto) {
  return String(texto ?? '')
    .replace(URL_CON_CLAVE, '$1[credencial]@')
    .replace(CORREO, '[correo]')
    .replace(BEARER, '[token]')
    .replace(TOKEN_LARGO, '[token]')
    .replace(TELEFONO, '[numero]');
}

export function leerDsn(dsn) {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const proyecto = u.pathname.replace(/^\/+|\/+$/g, '');
    if (!u.username || !/^\d+$/.test(proyecto)) return null;
    return `${u.protocol}//${u.host}/api/${proyecto}/store/?sentry_version=7&sentry_key=${encodeURIComponent(u.username)}`;
  } catch {
    return null;
  }
}

export function crearEvento(error, { worker, env = process.env, version } = {}) {
  const e = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Error desconocido');
  const tipo = limpiarTexto(e.name || 'Error');
  const valor = limpiarTexto(e.message);
  return {
    event_id: randomUUID().replaceAll('-', ''),
    timestamp: new Date().toISOString(),
    platform: 'node',
    level: 'error',
    environment: env.ERRORES_AMBIENTE || 'local',
    release: version || env.ERRORES_VERSION || 'dev',
    server_name: worker,
    tags: { worker: worker ?? 'desconocido', EJECUCION_ID: env.EJECUCION_ID ?? 'sin_ejecucion' },
    exception: { values: [{ type: tipo, value: valor }] },
    fingerprint: [worker ?? 'worker', tipo, valor],
  };
}

/** Envía el error a la herramienta de errores. Resuelve siempre; devuelve true si lo envió. */
export async function capturarError(error, { worker, env = process.env, enviar, version } = {}) {
  const url = leerDsn(env.ERRORES_DSN);
  if (!url) return false;
  try {
    const cuerpo = JSON.stringify(crearEvento(error, { worker, env, version }));
    const hacer = enviar ?? ((u, b) => fetch(u, {
      method: 'POST', body: b, headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(3000),
    }));
    await hacer(url, cuerpo);
    return true;
  } catch {
    return false;
  }
}
