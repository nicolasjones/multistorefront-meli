import { useEffect, useState } from 'react'
import { useGetIdentity } from '@refinedev/core'
import { checkFeatureHabilitada } from '../lib/features'

type Identity = { id: string; email?: string }

// Mismo esqueleto que useIsSuperadmin (hooks/useIsSuperadmin.ts): una
// funcionalidad futura lo usa para ocultar/mostrar su propia UI según si
// la organización efectiva del usuario tiene la feature habilitada — la
// verificación real de negocio sigue viviendo del lado del RLS/RPC de esa
// funcionalidad, esto es solo para no ofrecer la pantalla a quien no la
// puede usar (T014, recursosCondicionadosAFeature.ts).
export function useFeatureHabilitada(featureId: string) {
  const { data: identity, isLoading: identityLoading } = useGetIdentity<Identity>()
  const [checked, setChecked] = useState<{
    userId: string
    featureId: string
    habilitada: boolean
  } | null>(null)

  useEffect(() => {
    if (!identity?.id) {
      return
    }

    let cancelled = false

    checkFeatureHabilitada(featureId).then((habilitada) => {
      if (!cancelled) {
        setChecked({ userId: identity.id, featureId, habilitada })
      }
    })

    return () => {
      cancelled = true
    }
  }, [identity?.id, featureId])

  if (identityLoading) {
    return { habilitada: null, isLoading: true }
  }

  if (!identity?.id) {
    return { habilitada: false, isLoading: false }
  }

  if (checked?.userId !== identity.id || checked?.featureId !== featureId) {
    return { habilitada: null, isLoading: true }
  }

  return { habilitada: checked.habilitada, isLoading: false }
}
