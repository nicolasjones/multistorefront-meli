import { useCallback, useState } from 'react'
import { supabaseClient } from '../lib/supabase'

// F-PRV-06: anula un ingreso registrado. La base valida permisos, estado, motivo y
// stock; el hook solo expone el estado de envío y el resultado.
export function useAnularIngreso() {
  const [enviando, setEnviando] = useState(false)

  const anular = useCallback(async (ingresoId: string, motivo: string) => {
    setEnviando(true)
    try {
      const { data, error } = await supabaseClient.rpc('anular_ingreso_mercaderia', {
        p_ingreso: ingresoId,
        p_motivo: motivo.trim(),
      })
      if (error) return { ok: false as const, error }
      return { ok: true as const, data }
    } catch (error) {
      return { ok: false as const, error }
    } finally {
      setEnviando(false)
    }
  }, [])

  return { anular, enviando }
}
