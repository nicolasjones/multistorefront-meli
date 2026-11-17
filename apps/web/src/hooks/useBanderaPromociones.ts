import { useEffect, useRef, useState } from 'react'
import { leerCapacidadesPrecios } from '../lib/capacidadesPrecios'
import { supabaseClient } from '../lib/supabase'

export const INTERVALO_RELECTURA_BANDERA_MS = 60_000

// MSF-937: valor vivo de la bandera `promociones_precio`. Se lee al montar, al volver a la pestaña y cada minuto
// mientras `activo` (hay una venta abierta). Si una lectura falla se conserva la última conocida (`null` si nunca hubo).
export function useBanderaPromociones(activo: boolean): boolean | null {
  const [valor, setValor] = useState<boolean | null>(null)
  const ultima = useRef(0)

  useEffect(() => {
    let vigente = true
    const leer = () => {
      const peticion = ++ultima.current
      leerCapacidadesPrecios(supabaseClient)
        .then((c) => {
          if (vigente && peticion === ultima.current) setValor(c.promociones)
        })
        .catch((error: unknown) => {
          console.error('No pudimos releer la bandera de promociones.', error)
        })
    }
    leer()
    if (!activo) return () => { vigente = false }
    const alVolver = () => {
      if (document.visibilityState === 'visible') leer()
    }
    const intervalo = window.setInterval(leer, INTERVALO_RELECTURA_BANDERA_MS)
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('focus', leer)
    return () => {
      vigente = false
      window.clearInterval(intervalo)
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('focus', leer)
    }
  }, [activo])

  return valor
}
