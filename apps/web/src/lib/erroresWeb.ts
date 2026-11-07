// Registro central de errores del panel (MSF-369, F-OPS-03, FR-021/FR-023). Cliente mínimo compatible con la
// API de GlitchTip/Sentry (endpoint `store`), sin dependencia nueva: envía los errores no manejados y de
// render con ambiente y versión, y FILTRA antes de enviar correos, teléfonos, tokens y cuerpos de formulario.
// Sin DSN (desarrollo local, CI) es un no-op silencioso. Un fallo del envío nunca rompe la aplicación.
// Los errores de render de React 18 sin boundary se re-lanzan y llegan por el evento `error` de window.

export interface ConfigErrores {
  dsn?: string
  ambiente?: string
  version?: string
  enviar?: (url: string, cuerpo: string) => Promise<unknown>
}

export interface EventoError {
  event_id: string
  timestamp: string
  platform: 'javascript'
  level: 'error'
  environment: string
  release: string
  exception: { values: { type: string; value: string }[] }
  request?: { url?: string }
  [clave: string]: unknown
}

const CORREO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const BEARER = /bearer\s+\S+/gi
const JWT = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g
const TOKEN_LARGO = /[A-Za-z0-9_-]{32,}/g
const TELEFONO = /\+?\d[\d\s().-]{6,}\d/g
const PARAMETRO_SENSIBLE = /([?&#](?:access_token|refresh_token|token|code|apikey|key|password|email)=)[^&#\s]*/gi

/** Quita de un texto libre correos, teléfonos y tokens. */
export function limpiarTexto(texto: string): string {
  return texto
    .replace(CORREO, '[correo]')
    .replace(BEARER, '[token]')
    .replace(JWT, '[token]')
    .replace(PARAMETRO_SENSIBLE, '$1[filtrado]')
    .replace(TOKEN_LARGO, '[token]')
    .replace(TELEFONO, '[numero]')
}

function limpiarUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`
  } catch {
    return limpiarTexto(url)
  }
}

/**
 * `beforeSend`: devuelve el evento sin datos personales, o `null` si no hay nada que enviar. Nunca incluye
 * cuerpos de formularios, cookies, cabeceras ni usuario; la URL se reduce a origen y ruta.
 */
export function filtrarEvento(evento: EventoError): EventoError | null {
  const valores = (evento.exception?.values ?? []).map((v) => ({
    type: limpiarTexto(String(v.type ?? 'Error')),
    value: limpiarTexto(String(v.value ?? '')),
  }))
  if (valores.length === 0) return null
  const filtrado: EventoError = {
    event_id: evento.event_id,
    timestamp: evento.timestamp,
    platform: 'javascript',
    level: 'error',
    environment: evento.environment,
    release: evento.release,
    exception: { values: valores },
    // Agrupa por tipo y mensaje ya limpios, no por datos que cambian en cada ocurrencia.
    fingerprint: [valores[0].type, valores[0].value],
  }
  if (evento.request?.url) filtrado.request = { url: limpiarUrl(evento.request.url) }
  return filtrado
}

/** Parte un DSN `https://<clave>@<host>/<proyecto>` en la URL de `store` y la clave pública. */
export function leerDsn(dsn: string | undefined): { url: string; clave: string } | null {
  if (!dsn) return null
  try {
    const u = new URL(dsn)
    const proyecto = u.pathname.replace(/^\/+|\/+$/g, '')
    if (!u.username || !/^\d+$/.test(proyecto)) return null
    return {
      url: `${u.protocol}//${u.host}/api/${proyecto}/store/?sentry_version=7&sentry_key=${encodeURIComponent(u.username)}`,
      clave: u.username,
    }
  } catch {
    return null
  }
}

export function crearEvento(error: unknown, config: { ambiente: string; version: string }, url?: string): EventoError {
  const e = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Error desconocido')
  return {
    event_id: crypto.randomUUID().replaceAll('-', ''),
    timestamp: new Date().toISOString(),
    platform: 'javascript',
    level: 'error',
    environment: config.ambiente,
    release: config.version,
    exception: { values: [{ type: e.name || 'Error', value: e.message }] },
    ...(url ? { request: { url } } : {}),
  }
}

export interface RegistroErrores {
  activo: boolean
  capturar: (error: unknown) => void
}

const INACTIVO: RegistroErrores = { activo: false, capturar: () => {} }

export function crearRegistroErrores(config: ConfigErrores): RegistroErrores {
  const destino = leerDsn(config.dsn)
  if (!destino) return INACTIVO
  const ambiente = config.ambiente || 'local'
  const version = config.version || 'dev'
  const enviar = config.enviar ?? ((url: string, cuerpo: string) =>
    fetch(url, { method: 'POST', body: cuerpo, keepalive: true, headers: { 'content-type': 'application/json' } }))
  return {
    activo: true,
    capturar(error) {
      try {
        const evento = filtrarEvento(crearEvento(error, { ambiente, version }, globalThis.location?.href))
        if (!evento) return
        Promise.resolve(enviar(destino.url, JSON.stringify(evento))).catch(() => {})
      } catch {
        // El monitoreo nunca rompe la aplicación.
      }
    },
  }
}

/** Instala los manejadores globales (errores no manejados y promesas rechazadas). Sin DSN no instala nada. */
export function iniciarErrores(config: ConfigErrores, destino: Window = window): RegistroErrores {
  const registro = crearRegistroErrores(config)
  if (!registro.activo) return registro
  destino.addEventListener('error', (e) => registro.capturar(e.error ?? e.message))
  destino.addEventListener('unhandledrejection', (e) => registro.capturar(e.reason))
  return registro
}
