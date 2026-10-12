import type { AuthProvider } from '@refinedev/core'
import { supabaseClient } from '../lib/supabase'
import { limpiarRastroDeSesion, registrarActividad, sesionVencidaPorInactividad } from '../lib/vencimientoSesion'

// No hay registro propio (spec 003, US2/US4): toda cuenta llega invitada
// por email desde la Edge Function crear-organizacion, o cargada a mano
// como superadmin (ver quickstart.md). Este provider solo hace login/logout
// contra esas cuentas ya existentes.
export const authProvider: AuthProvider = {
  login: async ({ email, password }) => {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      return {
        success: false,
        error: { name: 'Error al iniciar sesión', message: error.message },
      }
    }

    if (data?.session) {
      registrarActividad()
      return { success: true, redirectTo: '/' }
    }

    return {
      success: false,
      error: {
        name: 'Error al iniciar sesión',
        message: 'No se pudo iniciar sesión con esas credenciales.',
      },
    }
  },

  logout: async () => {
    const cierre = await supabaseClient.auth.signOut().catch((falla: unknown) => ({ error: falla as Error }))
    // Si el cierre global falla (sin red), se descarta al menos la sesión local
    // antes de borrar la marca: sin sesión local, el siguiente check no la da por válida.
    if (cierre.error) await supabaseClient.auth.signOut({ scope: 'local' }).catch(() => undefined)
    limpiarRastroDeSesion()

    if (cierre.error) {
      return {
        success: false,
        // La sesión local ya se descartó: se redirige igual para no dejar a la persona en el panel.
        redirectTo: '/login',
        error: { name: 'Error al cerrar sesión', message: cierre.error.message },
      }
    }

    return { success: true, redirectTo: '/login' }
  },

  check: async () => {
    const { data, error } = await supabaseClient.auth.getSession()

    if (error || !data?.session) {
      limpiarRastroDeSesion()
      return { authenticated: false, redirectTo: '/login' }
    }

    if (sesionVencidaPorInactividad()) {
      // Si el cierre global falla (red, token ya inválido), se descarta al menos
      // la sesión local para que la persona no siga dentro con la sesión vencida.
      const cierre = await supabaseClient.auth.signOut().catch((falla: unknown) => ({ error: falla }))
      if (cierre?.error) await supabaseClient.auth.signOut({ scope: 'local' }).catch(() => undefined)
      limpiarRastroDeSesion()
      return { authenticated: false, redirectTo: '/login', logout: true }
    }

    registrarActividad()
    return { authenticated: true }
  },

  onError: async (error) => {
    const status = error?.status ?? error?.statusCode
    if (status === 401 || status === 403) {
      return { logout: true, redirectTo: '/login', error }
    }

    return { error }
  },

  getIdentity: async () => {
    const { data } = await supabaseClient.auth.getUser()

    if (!data?.user) {
      return null
    }

    return { id: data.user.id, email: data.user.email }
  },
}
