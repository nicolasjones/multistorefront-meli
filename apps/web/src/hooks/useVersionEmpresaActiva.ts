import { useSyncExternalStore } from 'react'
import { suscribirCambioEmpresaActiva, versionActualEmpresaActiva } from '../lib/cambioEmpresaActiva'

// Cambia cuando se elige otra empresa activa. Se usa para reencuadrar la
// pantalla (remontar el contenido) sin recargar el navegador.
export function useVersionEmpresaActiva(): number {
  return useSyncExternalStore(
    suscribirCambioEmpresaActiva,
    versionActualEmpresaActiva,
    versionActualEmpresaActiva,
  )
}
