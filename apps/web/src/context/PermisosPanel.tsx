import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useGetIdentity } from '@refinedev/core'
import { obtenerPermisosActuales, type PermisoSeccion } from '../lib/permisos'
import { useContextoPanel } from './ContextoPanel'

type ValorPermisosPanel = {
  // null mientras carga; [] si la consulta falla (se deniega, nunca se abre).
  permisos: PermisoSeccion[] | null
  isLoading: boolean
  // Vuelve a pedir los permisos (p. ej. tras cambiar de empresa activa, F-ROL-06).
  recargar: () => void
}

const PermisosPanelReact = createContext<ValorPermisosPanel | null>(null)

// Va dentro de ContextoPanelProvider: vuelve a pedir los permisos al cambiar
// de usuario o de organización activa (superadmin que entra/sale).
export function PermisosPanelProvider({ children }: { children: ReactNode }) {
  const identityQuery = useGetIdentity<{ id: string }>()
  const identity = identityQuery?.data
  // Mientras la identidad se resuelve aún no hay clave: cuenta como carga para
  // que el menú no se abra completo un instante (deny-by-default).
  const identidadPendiente = Boolean(identityQuery?.isLoading)
  const { contexto } = useContextoPanel()
  const organizacionId = contexto?.organizacion_id ?? null
  const [estado, setEstado] = useState<{ clave: string; permisos: PermisoSeccion[] } | null>(null)
  const [version, setVersion] = useState(0)
  const [recargando, setRecargando] = useState(false)
  const recargar = useCallback(() => {
    setRecargando(true)
    setVersion((v) => v + 1)
  }, [])
  const clave = identity?.id ? `${identity.id}:${organizacionId ?? ''}` : null

  useEffect(() => {
    if (!clave) {
      setRecargando(false)
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
      .finally(() => !cancelada && setRecargando(false))
    return () => { cancelada = true }
  }, [clave, version])

  // Si la identidad se está revalidando (data undefined con isLoading), se
  // conservan los permisos de la misma sesión para no vaciar el menú; un
  // cambio real de usuario/organización sí invalida `actual`.
  const actual = estado && (clave === null ? identidadPendiente : estado.clave === clave) ? estado : null
  const value = useMemo(
    () => ({ permisos: actual?.permisos ?? null, isLoading: identidadPendiente || Boolean(clave && !actual) || recargando, recargar }),
    [actual, clave, identidadPendiente, recargando, recargar],
  )

  return <PermisosPanelReact.Provider value={value}>{children}</PermisosPanelReact.Provider>
}

// Sin provider devuelve null en vez de lanzar: los consumidores que no
// dependen de la matriz (y sus tests) siguen funcionando.
export function usePermisosPanel() {
  return useContext(PermisosPanelReact)
}
