import { useCallback, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import { mensajeDeErrorStock, validarMinimo } from '../lib/stock'

export type ResultadoDefinirMinimo = { ok: true } | { ok: false; mensaje: string }

// Define el stock mínimo por la RPC `public.definir_minimo_stock` (F-STK-05, FR-013):
// la organización y el permiso los resuelve el servidor. Un segundo envío en el mismo
// tick se ignora (devuelve null); un mínimo inválido no viaja.
export function useDefinirMinimo() {
  const [guardando, setGuardando] = useState(false)
  const enCurso = useRef(false)

  const definir = useCallback(async (productoId: string, texto: string): Promise<ResultadoDefinirMinimo | null> => {
    if (enCurso.current) return null
    const validado = validarMinimo(texto)
    if ('error' in validado) return { ok: false, mensaje: validado.error }

    enCurso.current = true
    setGuardando(true)
    try {
      const { error } = await supabaseClient.rpc('definir_minimo_stock', { p_producto: productoId, p_minimo: validado.valor })
      if (error) throw error
      return { ok: true }
    } catch (error) {
      return { ok: false, mensaje: mensajeDeErrorStock(error, 'No pudimos guardar el mínimo. Intentá de nuevo.') }
    } finally {
      enCurso.current = false
      setGuardando(false)
    }
  }, [])

  return { definir, guardando }
}
