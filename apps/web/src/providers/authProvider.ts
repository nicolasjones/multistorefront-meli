import type { AuthProvider } from '@refinedev/core'
import { setMantenerSesion, supabaseClient } from '../lib/supabase'
import { limpiarRastroDeSesion, registrarActividad, sesionVencidaPorInactividad } from '../lib/vencimientoSesion'

// No hay registro propio (spec 003, US2/US4): toda cuenta llega invitada
// por email desde la Edge Function crear-organizacion, o cargada a mano
// como superadmin (ver quickstart.md). Este provider solo hace login/logout
// contra esas cuentas ya existentes.
export const mensajeIngresoGenerico = 'Revisá el correo y la contraseña e intentá de nuevo.'
export const mensajeIngresoBloqueado =
  'Demasiados intentos. Esperá 15 minutos antes de volver a intentar.'

const errorIngreso = (message: string) => ({
  success: false as const,
  error: { name: 'Error al iniciar sesión', message },
})

export const authProvider: AuthProvider = {
  login: async ({ email, password, remember }) => {
    const correo = String(email ?? '').trim().toLowerCase()

    // Bloqueo por correo (F-ACC-01, FR-003): se consulta antes de contactar a
    // Auth y no depende de que el correo exista.
    const { data: bloqueado } = await supabaseClient.rpc('bloqueo_acceso_hasta', {
      p_correo: correo,
    })
    if (bloqueado) return errorIngreso(mensajeIngresoBloqueado)

    setMantenerSesion(Boolean(remember))
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: correo,
      password,
    })

    if (error || !data?.session) {
      const { data: bloqueadoAhora } = await supabaseClient.rpc('registrar_fallo_acceso', {
        p_correo: correo,
      })
      return errorIngreso(bloqueadoAhora ? mensajeIngresoBloqueado : mensajeIngresoGenerico)
    }

    // Un suspendido (FR-004) no conserva sesión utilizable y recibe el mismo
    // mensaje no revelador. Un superadmin sin membresía no tiene fila: pasa.
    // Si la consulta falla no se puede descartar la suspensión: se cierra la
    // sesión y se rechaza (falla cerrado).
    const { data: membresia, error: errorMembresia } = await supabaseClient
      .from('usuarios_organizacion')
      .select('estado')
      .eq('user_id', data.session.user.id)
      .maybeSingle()
    if (errorMembresia || membresia?.estado === 'suspendido') {
      await supabaseClient.auth.signOut()
      return errorIngreso(mensajeIngresoGenerico)
    }

    await supabaseClient.rpc('limpiar_intentos_acceso')
    registrarActividad()
    return { success: true, redirectTo: '/' }
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
