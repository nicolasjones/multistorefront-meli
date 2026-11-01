import { esHostDeTienda, hostsDelPanel } from './tienda'
import { seguirActividadDelPanel } from './vencimientoSesion'

// Arranque de la app (MSF-673): el cierre de sesión por inactividad (12 h) es del PANEL.
// La tienda pública no tiene `/login` (su ingreso es `/ingresar`) y sus visitantes no tienen
// sesión de panel, así que en un host de tienda no se registra la marca de actividad ni se
// cierra la sesión al primer clic. En el panel el comportamiento queda igual que antes:
// la marca se registra y, al vencer, `alVencer` cierra la sesión y manda a `/login`.
// El panel de hosts sale de `VITE_PANEL_HOSTS` (por defecto, desarrollo local).
export function instalarVencimientoDeSesion(
  host: string,
  alVencer?: () => void,
  panel: Set<string> = hostsDelPanel(),
) {
  return seguirActividadDelPanel(esHostDeTienda(host, panel), alVencer)
}

// El aviso de vencimiento llega en cada clic o tecla mientras la pestaña queda abierta (la marca
// vencida no se renueva): sin esta guarda se encadenaban varios `signOut` y varias navegaciones a
// `/login`. Vive acá —y no en el arranque de la app— para que quede fijada por test.
export function cerrarSesionUnaVez(cerrar: () => void) {
  let cerrado = false
  return () => {
    if (cerrado) return
    cerrado = true
    cerrar()
  }
}
