import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useGetIdentity } from '@refinedev/core'
import { obtenerPermisosActuales, type PermisoSeccion } from '../lib/permisos'
import { useContextoPanel } from './ContextoPanel'

type ValorPermisosPanel = {
  // null mientras carga; [] si la consulta falla (se deniega, nunca se abre).
  permisos: PermisoSeccion[] | null
  isLoading: boolean
}

const PermisosPanelReact = createContext<ValorPermisosPanel | null>(null)

// Va dentro de ContextoPanelProvider: vuelve a pedir los permisos al cambiar
// de usuario o de organización activa (superadmin que entra/sale).
export function PermisosPanelProvider({ children }: { children: ReactNode }) {
  const identity = useGetIdentity<{ id: string }>()?.data
  const { contexto } = useContextoPanel()
  const organizacionId = contexto?.organizacion_id ?? null
  const [estado, setEstado] = useState<{ clave: string; permisos: PermisoSeccion[] } | null>(null)
  const clave = identity?.id ? `${identity.id}:${organizacionId ?? ''}` : null

  useEffect(() => {
    if (!clave) {
      return
    }
    let cancelada = false
    obtenerPermisosActuales()
      .then((permisos) => !cancelada && setEstado({ clave, permisos }))
      .catch((error: unknown) => {
        // Deny-by-default, pero con traza: un menú vacío sin log es indiagnosticable.
        console.error('No se pudieron cargar los permisos del usuario', error instanceof Error ? error.message : error)
        if (!cancelada) {
          setEstado({ clave, permisos: [] })
        }
      })
    return () => { cancelada = true }
  }, [clave])

  const actual = clave && estado?.clave === clave ? estado : null
  const value = useMemo(
    () => ({ permisos: actual?.permisos ?? null, isLoading: Boolean(clave && !actual) }),
    [actual, clave],
  )

  return <PermisosPanelReact.Provider value={value}>{children}</PermisosPanelReact.Provider>
}

// Sin provider devuelve null en vez de lanzar: los consumidores que no
// dependen de la matriz (y sus tests) siguen funcionando.
export function usePermisosPanel() {
  return useContext(PermisosPanelReact)
}
