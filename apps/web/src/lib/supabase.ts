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

export const supabaseClient = createClient(supabaseUrl, supabaseKey, {
  auth: { detectSessionInUrl: true },
})

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
