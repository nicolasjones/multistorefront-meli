import { useContext } from 'react'
import { BorradorConservadoContext } from '../context/BorradorConservado'
import { usePermisosPanel } from '../context/PermisosPanel'
import { nivelDe, type NivelSeccion } from '../lib/permisos'

type ResultadoNivel = {
  nivel: NivelSeccion | null
  isLoading: boolean
  error: boolean
  recargar?: () => void
  // Clave `usuario:organización` vigente (undefined sin provider).
  clave?: string | null
  // true: el nivel es el ÚLTIMO CONFIRMADO de esta misma clave y el repedido falló (MSF-855). Solo lo devuelve el hook
  // dentro de una pantalla que conservó su borrador; esa pantalla está inerte (no se puede guardar ni editar).
  sinConfirmar?: boolean
}

// Nivel del usuario actual en una sección (edicion | lectura | ninguno), solo
// para gatear la UI; RLS (private.nivel_seccion) es la autorización real.
// `error` indica que no se pudieron cargar los permisos (no es «ninguno»).
// `nivel` es null mientras carga, si falló la carga o si no hay PermisosPanelProvider.
// Excepción acotada (MSF-855): dentro de `RequiereAccesoSeccion` con el borrador conservado (misma clave +
// falla del repedido) devuelve el último nivel confirmado de ESA clave con `sinConfirmar`, para que el formulario
// siga montado; la zona está inerte, así que no se ofrece editar ni guardar hasta confirmar el nivel.
export function useNivelSeccion(seccion: string): ResultadoNivel {
  const valor = usePermisosPanel()
  const conservado = useContext(BorradorConservadoContext)
  if (!valor || !valor.permisos) {
    const ultimos = valor?.ultimosConfirmados
    if (conservado && valor?.error && valor.clave && conservado.clave === valor.clave && ultimos?.clave === valor.clave) {
      return { nivel: nivelDe(ultimos.permisos, seccion), isLoading: false, error: false, clave: valor.clave, sinConfirmar: true }
    }
    return { nivel: null, isLoading: Boolean(valor?.isLoading), error: Boolean(valor?.error), recargar: valor?.recargar, clave: valor?.clave }
  }
  return { nivel: nivelDe(valor.permisos, seccion), isLoading: false, error: false, clave: valor.clave }
}
