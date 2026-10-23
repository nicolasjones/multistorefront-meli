import { useEffect, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import { type EscalaPrecio, leerEscalasPrecio } from '../lib/escalasPrecio'

// Escalas de precio del producto (F-CAT-16, FR-004). `escalas` es null si Precios no entrega datos
// (o falla la lectura): la ficha lo muestra como «No disponible».
export function useEscalasPrecio(productoId: string | null | undefined) {
  const [estado, setEstado] = useState<{ productoId: string; escalas: EscalaPrecio[] | null } | null>(null)

  useEffect(() => {
    if (!productoId) return
    let vigente = true
    leerEscalasPrecio(supabaseClient, productoId)
      .catch((error) => {
        console.error('No pudimos leer las escalas de precio.', error)
        return null
      })
      .then((escalas) => {
        if (vigente) setEstado({ productoId, escalas })
      })
    return () => {
      vigente = false
    }
  }, [productoId])

  const listo = estado !== null && estado.productoId === productoId
  return { escalas: listo ? estado.escalas : null, cargando: Boolean(productoId) && !listo }
}
