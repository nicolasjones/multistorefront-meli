import { useEffect, useState } from 'react'
import { esCotizacionSugerida, type CotizacionSugerida } from '../lib/cotizacion'
import { supabaseClient } from '../lib/supabase'

export type EstadoSugerida = { estado: 'cargando' } | { estado: 'lista'; sugerida: CotizacionSugerida } | { estado: 'no_disponible' }

// F-PRE-13: pide la cotización sugerida UNA vez al habilitarse (al abrir el diálogo). Si la fuente cae o responde
// algo inválido queda `no_disponible` y la carga a mano sigue igual (FR-002): nunca bloquea ni lanza.
export function useCotizacionSugerida(habilitado: boolean): EstadoSugerida {
  const [estado, setEstado] = useState<EstadoSugerida>({ estado: 'cargando' })
  useEffect(() => {
    if (!habilitado) return
    let vigente = true
    setEstado({ estado: 'cargando' })
    void (async () => {
      try {
        const { data, error } = await supabaseClient.functions.invoke('cotizacion-sugerida', { method: 'POST' })
        if (!vigente) return
        if (error || !esCotizacionSugerida(data)) {
          if (error) console.error('No se pudo obtener la cotización sugerida', error)
          setEstado({ estado: 'no_disponible' })
          return
        }
        setEstado({ estado: 'lista', sugerida: data })
      } catch (error) {
        console.error('No se pudo obtener la cotización sugerida', error)
        if (vigente) setEstado({ estado: 'no_disponible' })
      }
    })()
    return () => { vigente = false }
  }, [habilitado])
  return estado
}
