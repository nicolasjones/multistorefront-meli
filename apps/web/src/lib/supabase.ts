import { createClient } from '@supabase/supabase-js'
import { CLAVE_MANTENER_SESION } from './vencimientoSesion'

// Sin VITE_SUPABASE_URL/VITE_SUPABASE_PUBLISHABLE_KEY (falta el .env local,
// o CI corriendo pnpm build/test sin Supabase levantado) igual se construye
// el cliente para que la app no explote al importar este módulo — las
// llamadas reales simplemente van a fallar con un error de auth/red, que
// authProvider ya sabe convertir en "no autenticado" en vez de un crash.
// En CI el build recibe VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY (job `e2e-sesion` los exporta
// desde `supabase status -o env`); en local salen de `apps/web/.env`.
// E2E con sesión: el job `e2e-sesion` reinicia el stack de CI con kong/postgrest y exporta estas env al build.
// Smoke e2e-sesion: valida health-check ignorado + API.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'http://localhost:54321'
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'missing-anon-key'

/** @public */
export const supabaseConfigured = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
)

export const passwordDefinitionPath = '/acceso/definir-contrasena'
export const profilePath = '/cuenta/perfil'

export type PasswordFlowOrigin = 'invitacion' | 'recuperacion'

export function passwordDefinitionRedirectUrl(origin: PasswordFlowOrigin, appUrl: string) {
  const url = new URL(passwordDefinitionPath, appUrl)
  url.searchParams.set('origen', origin)
  return url.toString()
}

export function profileRedirectUrl(appUrl: string) {
  return new URL(profilePath, appUrl).toString()
}

// «Mantener la sesión iniciada» (F-ACC-01, FR-005): con la casilla marcada la
// sesión vive en localStorage (sobrevive al cierre del navegador); sin ella,
// en sessionStorage (muere con la pestaña). La preferencia se recuerda en
// localStorage para que el refresco de tokens escriba en el mismo lugar.
// Es la misma clave que lee el vencimiento por inactividad (vencimientoSesion):
// quien marca «mantener» queda exento de las 12 h.
const mantenerSesionKey = CLAVE_MANTENER_SESION

// Con el storage bloqueado (SecurityError, navegación privada, cuota) el acceso
// lanza: la app debe cargar igual, así que toda lectura/escritura pasa por aquí.
function conStorage<T>(accion: () => T, porDefecto: T): T {
  try {
    return accion()
  } catch {
    return porDefecto
  }
}

export function getMantenerSesion() {
  if (typeof window === 'undefined') return false
  return conStorage(() => window.localStorage.getItem(mantenerSesionKey) !== null, false)
}

export function setMantenerSesion(mantener: boolean) {
  if (typeof window === 'undefined') return
  conStorage(() => {
    if (mantener) {
      window.localStorage.setItem(mantenerSesionKey, 'true')
    } else {
      window.localStorage.removeItem(mantenerSesionKey)
    }
  }, undefined)
}

function almacenSesion(): Storage {
  return getMantenerSesion() ? window.localStorage : window.sessionStorage
}

// Sesión previa al deploy: supabase-js la guardaba en localStorage sin la
// marca. Sin esta migración, el primer refresh la movería a sessionStorage y
// se perdería al cerrar el navegador. Se ejecuta una sola vez (la marca queda).
export function migrarSesionLegacy() {
  if (typeof window === 'undefined') return
  if (getMantenerSesion()) return
  const esToken = (k: string) => k.startsWith('sb-') && k.endsWith('-auth-token')
  const enLocal = conStorage(() => Object.keys(window.localStorage).some(esToken), false)
  const enSesion = conStorage(() => Object.keys(window.sessionStorage).some(esToken), false)
  if (enLocal && !enSesion) setMantenerSesion(true)
}

if (typeof window !== 'undefined') migrarSesionLegacy()

export const almacenSesionAdapter = {
  // Cada acceso va aislado: si un almacén está bloqueado, el otro se sigue usando.
  getItem: (key: string) =>
    conStorage(() => window.sessionStorage.getItem(key), null) ??
    conStorage(() => window.localStorage.getItem(key), null),
  setItem: (key: string, value: string) => {
    // Cuota llena o navegación privada: la sesión sigue en memoria de supabase-js
    // durante esta carga; no se rompe el ingreso por no poder persistirla.
    // Primero se escribe en el destino; el otro almacén se limpia solo si esa
    // escritura funcionó, para no perder el token anterior ante un fallo.
    conStorage(() => {
      const destino = almacenSesion()
      const otro = destino === window.localStorage ? window.sessionStorage : window.localStorage
      destino.setItem(key, value)
      conStorage(() => otro.removeItem(key), undefined)
    }, undefined)
  },
  removeItem: (key: string) => {
    conStorage(() => window.sessionStorage.removeItem(key), undefined)
    conStorage(() => window.localStorage.removeItem(key), undefined)
  },
}

export const supabaseClient = createClient(supabaseUrl, supabaseKey, {
  auth: {
    detectSessionInUrl: true,
    storage: typeof window === 'undefined' ? undefined : almacenSesionAdapter,
  },
})

// La marca no debe sobrevivir a la sesión: si vence o se cierra por otra vía
// (otra pestaña, refresh fallido), la siguiente sesión creada sin el formulario
// (invitación, recuperación) no puede heredarla en un equipo compartido.
//
// Mientras un ingreso está en curso el listener no actúa: supabase-js emite
// SIGNED_OUT de forma asíncrona y podría pisar la marca que el login restaura
// tras rechazar a un suspendido (borraría la sesión «mantenida» de otra pestaña).
let ingresoEnCurso = false

export function setIngresoEnCurso(enCurso: boolean) {
  ingresoEnCurso = enCurso
}

if (typeof window !== 'undefined') {
  supabaseClient.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' && !ingresoEnCurso) setMantenerSesion(false)
  })
}

export function closeOtherSessions() {
  return supabaseClient.auth.signOut({ scope: 'others' })
}

export function verifyCurrentPassword(email: string, password: string) {
  const verificationClient = createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })

  return verificationClient.auth.signInWithPassword({ email, password })
}
