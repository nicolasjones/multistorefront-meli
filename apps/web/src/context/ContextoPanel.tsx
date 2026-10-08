import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useGetIdentity } from '@refinedev/core'
import { supabaseClient } from '../lib/supabase'

type Identity = { id: string; email?: string }

export type ContextoPanel = {
  es_superadmin: boolean
  organizacion_id: string | null
  organizacion_nombre: string | null
  rol_efectivo: 'administrador' | 'miembro' | null
  puede_escribir: boolean
  puede_copiar_identificador_tecnico: boolean
}

type ValorContextoPanel = {
  contexto: ContextoPanel | null
  isLoading: boolean
  error: string | null
  invalidar: () => void
}

const ContextoPanelReact = createContext<ValorContextoPanel | null>(null)

export function ContextoPanelProvider({ children }: { children: ReactNode }) {
  const resultadoIdentidad = useGetIdentity<Identity>()
  const identity = resultadoIdentidad?.data
  const cargandoIdentidad = resultadoIdentidad?.isLoading ?? false
  const [version, setVersion] = useState(0)
  const [estado, setEstado] = useState<{ userId: string; contexto: ContextoPanel | null; error: string | null } | null>(null)

  useEffect(() => {
    if (!identity?.id) {
      return
    }
    let cancelada = false
    // .single(): la función es `returns table(...)` (siempre una fila), y sin
    // esto supabase-js/PostgREST devuelve un array de una fila en vez del
    // objeto — `contexto.es_superadmin` quedaba `undefined` en el array.
    void supabaseClient.rpc('contexto_panel_actual').single().then(({ data, error }) => {
      if (cancelada) return
      setEstado({ userId: identity.id, contexto: error ? null : (data as ContextoPanel | null), error: error?.message ?? null })
    })
    return () => { cancelada = true }
  }, [identity?.id, version])

  // Único punto de invalidación para entrar/salir de organización — vuelve a
  // pedir el contexto propio. Los recursos de Refine no necesitan
  // invalidación aparte: su QueryClient usa `staleTime` 0 por defecto, así
  // que el mount fresco que trae cada navegación SPA a una ruta nueva ya
  // dispara su propio refetch bajo el contexto (RLS) actualizado.
  const invalidar = useCallback(() => setVersion((actual) => actual + 1), [])
  const estadoActual = identity?.id && estado?.userId === identity.id ? estado : null
  const isLoading = cargandoIdentidad || Boolean(identity?.id && !estadoActual)
  const value = useMemo(() => ({ contexto: estadoActual?.contexto ?? null, isLoading, error: estadoActual?.error ?? null, invalidar }), [estadoActual, invalidar, isLoading])

  return <ContextoPanelReact.Provider value={value}>{children}</ContextoPanelReact.Provider>
}

export function useContextoPanel() {
  const value = useContext(ContextoPanelReact)
  if (!value) throw new Error('useContextoPanel requiere ContextoPanelProvider')
  return value
}
