import type { AuthProvider } from '@refinedev/core'
import { supabaseClient } from '../lib/supabase'

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
    const { error } = await supabaseClient.auth.signOut()

    if (error) {
      return {
        success: false,
        error: { name: 'Error al cerrar sesión', message: error.message },
      }
    }

    return { success: true, redirectTo: '/login' }
  },

  check: async () => {
    const { data, error } = await supabaseClient.auth.getSession()

    if (error || !data?.session) {
      return { authenticated: false, redirectTo: '/login' }
    }

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
