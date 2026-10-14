import { usePermisosPanel } from '../context/PermisosPanel'
import { nivelDe, type NivelSeccion } from '../lib/permisos'

// Nivel del usuario actual en una sección (edicion | lectura | ninguno), solo
// para gatear la UI; RLS (private.nivel_seccion) es la autorización real.
// `nivel` es null mientras carga o si no hay PermisosPanelProvider.
export function useNivelSeccion(seccion: string): { nivel: NivelSeccion | null; isLoading: boolean } {
  const valor = usePermisosPanel()
  if (!valor || !valor.permisos) {
    return { nivel: null, isLoading: Boolean(valor?.isLoading) }
  }
  return { nivel: nivelDe(valor.permisos, seccion), isLoading: false }
}
