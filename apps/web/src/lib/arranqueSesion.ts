import { authProvider } from '../providers/authProvider'
import { seguirActividad } from './vencimientoSesion'

// MSF-740: el vencimiento por inactividad es una regla del PANEL (FR-009 de la épica de acceso): 12 h sin
// actividad → cierre de sesión y vuelta a `/login`. La tienda pública NO tiene regla propia: la sesión de un
// cliente con cuenta web termina solo por salida explícita («Salir» de la tienda) o por el tope de 30 días del
// servidor (`[auth.sessions] timebox`). Por eso el control no se instala en un host de tienda: el visitante
// anónimo no ve cierre ni redirección, y el cliente no pierde la sesión en silencio al volver al día siguiente.
// Devuelve la función para dejar de escuchar (la usa el test); en la app no hace falta.
export function instalarVencimientoDeSesion(esTiendaPublica: boolean) {
  if (esTiendaPublica) return
  let cerrando = false
  return seguirActividad(() => {
    if (cerrando) return
    cerrando = true
    void authProvider.logout?.({}).finally(() => window.location.assign('/login'))
  })
}
