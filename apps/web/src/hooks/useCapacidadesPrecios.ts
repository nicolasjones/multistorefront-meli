import { useEffect, useRef, useState } from 'react'
import { CAPACIDADES_APAGADAS, leerCapacidadesPrecios, type CapacidadesPrecios } from '../lib/capacidadesPrecios'
import { supabaseClient } from '../lib/supabase'
import { useOrganizacionDeTrabajo } from './useOrganizacionDeTrabajo'

// MSF-363: banderas de apagado y permiso de `productos` por tienda. Se vuelve a pedir al cambiar la organización de
// trabajo. Si falla la lectura (`hayError`), se asume TODO apagado: ante la duda la pantalla no ofrece la función.
export function useCapacidadesPrecios(): { capacidades: CapacidadesPrecios; cargando: boolean; hayError: boolean } {
  const { organizacionId } = useOrganizacionDeTrabajo()
  const [capacidades, setCapacidades] = useState<CapacidadesPrecios>(CAPACIDADES_APAGADAS)
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)

  useEffect(() => {
    const peticion = ++ultimaPeticion.current
    // Al cambiar de organización no se muestran ni un instante las capacidades de la anterior.
    setCapacidades(CAPACIDADES_APAGADAS)
    setCargando(true)
    setHayError(false)
    leerCapacidadesPrecios(supabaseClient)
      .then((resultado) => {
        if (peticion === ultimaPeticion.current) setCapacidades(resultado)
      })
      .catch((error: unknown) => {
        console.error('No pudimos leer las banderas de precios.', error)
        if (peticion === ultimaPeticion.current) {
          setCapacidades(CAPACIDADES_APAGADAS)
          setHayError(true)
        }
      })
      .finally(() => {
        if (peticion === ultimaPeticion.current) setCargando(false)
      })
  }, [organizacionId])

  return { capacidades, cargando, hayError }
}
