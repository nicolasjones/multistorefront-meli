import { useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import { leerBanderaMargenCostosFijos } from '../lib/costosFijos'

// Bandera `margen_costos_fijos` (RF-GAS-10; apagada por defecto; es de plataforma, no depende de la organización). Falla cerrada: si no se puede leer, cuenta como apagada y la
// pestaña «Después de costos fijos» no se muestra.
export function useBanderaMargenCostosFijos(): { activa: boolean; cargando: boolean } {
  const [activa, setActiva] = useState(false)
  const [cargando, setCargando] = useState(true)
  const ultimaPeticion = useRef(0)

  useEffect(() => {
    const peticion = ++ultimaPeticion.current
    leerBanderaMargenCostosFijos(supabaseClient)
      .then((valor) => {
        if (peticion === ultimaPeticion.current) setActiva(valor)
      })
      .catch((error: unknown) => {
        console.error('No pudimos leer la bandera del margen después de costos fijos.', error)
      })
      .finally(() => {
        if (peticion === ultimaPeticion.current) setCargando(false)
      })
  }, [])

  return { activa, cargando }
}
