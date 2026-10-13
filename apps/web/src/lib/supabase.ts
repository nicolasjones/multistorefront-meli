import { createClient } from '@supabase/supabase-js'

// Sin VITE_SUPABASE_URL/VITE_SUPABASE_PUBLISHABLE_KEY (falta el .env local,
// o CI corriendo pnpm build/test sin Supabase levantado) igual se construye
// el cliente para que la app no explote al importar este módulo — las
// llamadas reales simplemente van a fallar con un error de auth/red, que
// authProvider ya sabe convertir en "no autenticado" en vez de un crash.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'http://localhost:54321'
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'missing-anon-key'

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
const mantenerSesionKey = 'msf.mantener-sesion'

export function getMantenerSesion() {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(mantenerSesionKey) !== null
}

export function setMantenerSesion(mantener: boolean) {
  if (typeof window === 'undefined') return
  if (mantener) {
    window.localStorage.setItem(mantenerSesionKey, '1')
  } else {
    window.localStorage.removeItem(mantenerSesionKey)
  }
}

function almacenSesion(): Storage {
  return getMantenerSesion() ? window.localStorage : window.sessionStorage
}

export const sessionStorageAdapter = {
  getItem: (key: string) => window.sessionStorage.getItem(key) ?? window.localStorage.getItem(key),
  setItem: (key: string, value: string) => {
    const destino = almacenSesion()
    const otro = destino === window.localStorage ? window.sessionStorage : window.localStorage
    otro.removeItem(key)
    destino.setItem(key, value)
  },
  removeItem: (key: string) => {
    window.sessionStorage.removeItem(key)
    window.localStorage.removeItem(key)
  },
}

export const supabaseClient = createClient(supabaseUrl, supabaseKey, {
  auth: {
    detectSessionInUrl: true,
    storage: typeof window === 'undefined' ? undefined : sessionStorageAdapter,
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
