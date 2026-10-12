import type { AuthProvider } from '@refinedev/core'
import { getMantenerSesion, setMantenerSesion, supabaseClient } from '../lib/supabase'
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

function esCredencialInvalida(error: { code?: string; status?: number }) {
  return error.code === 'invalid_credentials' || error.status === 400
}

export const authProvider: AuthProvider = {
  login: async ({ email, password, remember }) => {
    const correo = String(email ?? '').trim().toLowerCase()

    // Bloqueo por correo (F-ACC-01, FR-003): se consulta antes de contactar a
    // Auth y no depende de que el correo exista.
    // Falla cerrado: si la consulta da error no se puede descartar el bloqueo,
    // así que se rechaza con el mensaje genérico sin contactar a Auth.
    const { data: bloqueado, error: errorBloqueo } = await supabaseClient.rpc(
      'bloqueo_acceso_hasta',
      { p_correo: correo },
    )
    if (errorBloqueo) return errorIngreso(mensajeIngresoGenerico)
    if (bloqueado) return errorIngreso(mensajeIngresoBloqueado)

    // La preferencia debe estar fijada antes de autenticar porque Auth guarda
    // la sesión al responder; si el ingreso no prospera se revierte para no
    // dejar la marca persistida en localStorage. Se restaura el valor previo
    // (no se fuerza false) para no pisar una sesión «mantenida» de otra pestaña.
    const mantenerPrevio = getMantenerSesion()
    setMantenerSesion(Boolean(remember))
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: correo,
      password,
    })

    if (error || !data?.session) {
      setMantenerSesion(mantenerPrevio)
      // Solo las credenciales inválidas cuentan como fallo: una caída de red o
      // un 429 de Auth no deben bloquear el correo.
      if (error && !esCredencialInvalida(error)) return errorIngreso(mensajeIngresoGenerico)
      const { data: bloqueadoAhora, error: errorRegistro } = await supabaseClient.rpc(
        'registrar_fallo_acceso',
        { p_correo: correo },
      )
      // Si no se pudo contar el fallo igual se rechaza con el mensaje genérico.
      if (errorRegistro) return errorIngreso(mensajeIngresoGenerico)
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
      setMantenerSesion(false)
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
