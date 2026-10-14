import { usePermisosPanel } from '../context/PermisosPanel'
import { puedeAccionEn, type AccionPermiso } from '../lib/permisos'

// Espejo en UI de private.puede_accion(seccion, accion). `puede` es null
// mientras carga o si no hay PermisosPanelProvider.
export function usePuedeAccion(seccion: string, accion: AccionPermiso): { puede: boolean | null; isLoading: boolean } {
  const valor = usePermisosPanel()
  if (!valor || !valor.permisos) {
    return { puede: null, isLoading: Boolean(valor?.isLoading) }
  }
  return { puede: puedeAccionEn(valor.permisos, seccion, accion), isLoading: false }
}
