import { useEffect, useState } from 'react'
import { useGetIdentity } from '@refinedev/core'
import { supabaseClient } from '../lib/supabase'

type Identity = { id: string; email?: string }

export type ReporteAsignado = { id: string; nombre: string }

// Reportes visibles para el usuario actual (US2). Usa el RPC
// reportes_visibles_para_mi() en vez de un select directo a `reportes`:
// ese select se apoyaba en la RLS de la tabla (private.puede_ver_reporte
// / is_superadmin), y el bypass de is_superadmin() ahí — necesario para
// que el superadmin vea el catálogo completo en administrar.tsx (US1) —
// hacía que también lo viera acá, ofreciendo en el dropdown reportes de
// organizaciones que no tenía activa (bug real, ver data-model.md). El
// RPC no tiene ese bypass: un superadmin con organización activa se trata
// igual que su administrador, ni más ni menos.
export function useReportesAsignados() {
  const { data: identity, isLoading: identityLoading } = useGetIdentity<Identity>()
  const [checked, setChecked] = useState<{
    userId: string
    reportes: ReporteAsignado[]
  } | null>(null)

  useEffect(() => {
    if (!identity?.id) {
      return
    }

    let cancelled = false

    supabaseClient
      .rpc('reportes_visibles_para_mi')
      .then(({ data }) => {
        if (!cancelled) {
          setChecked({ userId: identity.id, reportes: data ?? [] })
        }
      })

    return () => {
      cancelled = true
    }
  }, [identity?.id])

  if (identityLoading) {
    return { reportes: [], isLoading: true }
  }

  if (!identity?.id) {
    return { reportes: [], isLoading: false }
  }

  if (checked?.userId !== identity.id) {
    return { reportes: [], isLoading: true }
  }

  return { reportes: checked.reportes, isLoading: false }
}
