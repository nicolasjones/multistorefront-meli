import type { AuthProvider } from '@refinedev/core'
import { getMantenerSesion, setIngresoEnCurso, setMantenerSesion, supabaseClient } from '../lib/supabase'
import { limpiarRastroDeSesion, registrarActividad, sesionVencidaPorInactividad } from '../lib/vencimientoSesion'

// No hay registro propio (spec 003, US2/US4): toda cuenta llega invitada
// por email desde la Edge Function crear-organizacion, o cargada a mano
// como superadmin (ver quickstart.md). Este provider solo hace login/logout
// contra esas cuentas ya existentes.
export const mensajeIngresoGenerico = 'Revisá el correo y la contraseña e intentá de nuevo.'
export const mensajeIngresoTecnico =
  'No pudimos verificar tu ingreso por un problema del servicio. Intentá de nuevo en unos minutos.'
export const mensajeIngresoBloqueado =
  'Demasiados intentos. Esperá unos minutos antes de volver a intentar.'

const errorIngreso = (message: string) => ({
  success: false as const,
  error: { name: 'Error al iniciar sesión', message },
})

// Auth también responde 400 por otras causas (email_not_confirmed, validación):
// solo el código invalid_credentials cuenta como fallo de credenciales.
function esCredencialInvalida(error: { code?: string }) {
  return error.code === 'invalid_credentials'
}

function esErrorTecnico(error: { status?: number }) {
  return !error.status || error.status === 429 || error.status >= 500
}

export const authProvider: AuthProvider = {
  login: async ({ email, password, remember }) => {
    const correo = String(email ?? '').trim().toLowerCase()

    // Bloqueo por correo (F-ACC-01, FR-003): se consulta antes de contactar a
    // Auth y no depende de que el correo exista.
    // Falla cerrado: si la consulta da error no se puede descartar el bloqueo,
    // así que se rechaza con el mensaje de servicio sin contactar a Auth.
    const { data: bloqueado, error: errorBloqueo } = await supabaseClient.rpc(
      'bloqueo_acceso_hasta',
      { p_correo: correo },
    )
    if (errorBloqueo) return errorIngreso(mensajeIngresoTecnico)
    if (bloqueado) return errorIngreso(mensajeIngresoBloqueado)

    // La preferencia debe estar fijada antes de autenticar porque Auth guarda
    // la sesión al responder; si el ingreso no prospera se revierte para no
    // dejar la marca persistida en localStorage. Se restaura el valor previo
    // (no se fuerza false) para no pisar una sesión «mantenida» de otra pestaña.
    const mantenerPrevio = getMantenerSesion()
    setMantenerSesion(Boolean(remember))
    let data: Awaited<ReturnType<typeof supabaseClient.auth.signInWithPassword>>['data'] | undefined
    let error: Awaited<ReturnType<typeof supabaseClient.auth.signInWithPassword>>['error'] | null = null
    let ingresoOk = false
    try {
      ;({ data, error } = await supabaseClient.auth.signInWithPassword({
        email: correo,
        password,
      }))
      ingresoOk = !error && Boolean(data?.session)
    } finally {
      // Si signInWithPassword lanza o falla, la marca no debe quedar puesta.
      if (!ingresoOk) setMantenerSesion(mantenerPrevio)
    }

    if (error || !data?.session) {
      // Solo las credenciales inválidas cuentan como fallo: una caída de red o
      // un 429 de Auth no deben bloquear el correo.
      if (error && !esCredencialInvalida(error)) {
        // El Auth Hook de bloqueo (MSF-470) puede rechazar durante el intento (el
        // 6.º con la contraseña correcta o un intento concurrente): Auth responde
        // con un código distinto de invalid_credentials. Se consulta el bloqueo
        // para mostrar el mensaje correcto; si la consulta falla se sigue con lo de abajo.
        const { data: bloqueadoPorHook } = await supabaseClient.rpc('bloqueo_acceso_hasta', {
          p_correo: correo,
        })
        if (bloqueadoPorHook) return errorIngreso(mensajeIngresoBloqueado)
        // Red caída, 429 o 5xx: mensaje de servicio; un 400 de otra causa conserva
        // el genérico para no revelar si el correo existe.
        return errorIngreso(esErrorTecnico(error) ? mensajeIngresoTecnico : mensajeIngresoGenerico)
      }
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
      // supabase-js emite SIGNED_OUT de forma asíncrona: el listener de
      // lib/supabase se silencia hasta que el evento haya pasado y recién
      // entonces se restaura la marca previa, para no pisar una sesión
      // «mantenida» de otra pestaña.
      setIngresoEnCurso(true)
      try {
        // Ante un fallo transitorio de la consulta (no una suspensión) solo se
        // descarta esta sesión: el usuario activo no pierde las de otros dispositivos.
        const { error: errorSalida } = await supabaseClient.auth.signOut(
          errorMembresia ? { scope: 'local' } : undefined,
        )
        // Con la red caída la revocación global falla: al menos se descarta
        // la sesión local para que no quede en el storage.
        if (errorSalida) await supabaseClient.auth.signOut({ scope: 'local' })
        // Cede un turno al event loop para que el SIGNED_OUT asíncrono llegue
        // al listener (silenciado por ingresoEnCurso) antes de restaurar la marca.
        await new Promise((resolver) => setTimeout(resolver, 0))
      } finally {
        setMantenerSesion(mantenerPrevio)
        setIngresoEnCurso(false)
      }
      return errorIngreso(mensajeIngresoGenerico)
    }

    // El ingreso ya fue exitoso: si no se puede limpiar el contador falla
    // abierto (queda el conteo, que vence solo) y no se bloquea al usuario.
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

    // La marca de «Mantener la sesión» no debe sobrevivir al cierre de sesión:
    // la siguiente persona en el navegador no la heredó (FR-005).
    setMantenerSesion(false)

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
