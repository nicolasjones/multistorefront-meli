import { useCallback, useEffect, useRef, useState } from 'react'
import { leerBanderaPromociones } from '../lib/capacidadesPrecios'
import { supabaseClient } from '../lib/supabase'

export const INTERVALO_RELECTURA_BANDERA_MS = 60_000

// MSF-937: valor vivo de la bandera `promociones_precio`. Se lee al montar y, mientras `activo` (hay una venta abierta),
// al volver a la pestaña y cada minuto. `releer()` fuerza una lectura nueva y devuelve su valor (`null` si falló): sirve
// para fijar la base de comparación DESPUÉS de abrir una venta, no con un valor viejo del montaje. Si una lectura falla se
// conserva la última conocida.
export function useBanderaPromociones(activo: boolean): { valor: boolean | null; releer: () => Promise<boolean | null> } {
  const [valor, setValor] = useState<boolean | null>(null)
  const ultima = useRef(0)
  const montado = useRef(true)

  const releer = useCallback(async (): Promise<boolean | null> => {
    const peticion = ++ultima.current
    try {
      const resultado = await leerBanderaPromociones(supabaseClient)
      if (montado.current && peticion === ultima.current) setValor(resultado)
      return resultado
    } catch (error) {
      console.error('No pudimos leer la bandera de promociones.', error)
      return null
    }
  }, [])

  useEffect(() => {
    montado.current = true
    void releer()
    return () => {
      montado.current = false
    }
  }, [releer])

  useEffect(() => {
    if (!activo) return
    const alVolver = () => {
      if (document.visibilityState === 'visible') void releer()
    }
    const alEnfocar = () => void releer()
    const intervalo = window.setInterval(() => void releer(), INTERVALO_RELECTURA_BANDERA_MS)
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('focus', alEnfocar)
    return () => {
      window.clearInterval(intervalo)
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('focus', alEnfocar)
    }
  }, [activo, releer])

  return { valor, releer }
}
