// Vencimiento de sesión (spec 20261012-140000, FR-009): 12 h de inactividad,
// salvo que la persona haya elegido «Mantener la sesión iniciada»; el tope de
// 30 días lo impone el servidor (`[auth.sessions] timebox` en supabase/config.toml).
export const INACTIVIDAD_MAXIMA_MS = 12 * 60 * 60 * 1000
export const CLAVE_ULTIMA_ACTIVIDAD = 'sesion:ultima-actividad'
export const CLAVE_MANTENER_SESION = 'sesion:mantener'

const INTERVALO_REGISTRO_MS = 60 * 1000

export function registrarActividad(ahora = Date.now()) {
  localStorage.setItem(CLAVE_ULTIMA_ACTIVIDAD, String(ahora))
}

// Contrato: sin marca de actividad (localStorage limpiado o sesión previa al
// despliegue) NO se considera vencida; quien llama debe registrar actividad
// (`authProvider.check` lo hace en cada llamada) para que el reloj arranque.
export function sesionVencidaPorInactividad(ahora = Date.now()) {
  if (localStorage.getItem(CLAVE_MANTENER_SESION) === 'true') return false
  const ultima = Number(localStorage.getItem(CLAVE_ULTIMA_ACTIVIDAD))
  return Number.isFinite(ultima) && ultima > 0 && ahora - ultima > INACTIVIDAD_MAXIMA_MS
}

export function limpiarRastroDeSesion() {
  localStorage.removeItem(CLAVE_ULTIMA_ACTIVIDAD)
  localStorage.removeItem(CLAVE_MANTENER_SESION)
}

// Registra actividad de la persona (limitada a una escritura por minuto).
// Si la sesión ya venció por inactividad, no renueva la marca: avisa con
// `alVencer` para que se cierre la sesión (pestaña que quedó abierta > 12 h).
export function seguirActividad(alVencer?: () => void) {
  let ultimoRegistro = 0
  const alActuar = () => {
    const ahora = Date.now()
    if (sesionVencidaPorInactividad(ahora)) {
      alVencer?.()
      return
    }
    if (ahora - ultimoRegistro < INTERVALO_REGISTRO_MS) return
    ultimoRegistro = ahora
    registrarActividad(ahora)
  }
  const eventos = ['pointerdown', 'keydown'] as const
  eventos.forEach((evento) => window.addEventListener(evento, alActuar, { passive: true }))
  return () => eventos.forEach((evento) => window.removeEventListener(evento, alActuar))
}
