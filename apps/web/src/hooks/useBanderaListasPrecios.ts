import { useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import { leerBanderaListasPrecios } from '../lib/listasPrecios'
import { useOrganizacionActiva } from './useOrganizacionActiva'

// Bandera `listas_precios` (D13). Falla cerrada: si no se puede leer, se la considera apagada (`hayError`) y la pantalla no
// ofrece asignar ni guardar listas; archivar, restaurar y quitar siguen disponibles (la base decide).
export function useBanderaListasPrecios(): { activa: boolean; cargando: boolean; hayError: boolean } {
  const [activa, setActiva] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const ultimaPeticion = useRef(0)

  useEffect(() => {
    const peticion = ++ultimaPeticion.current
    setActiva(false)
    setCargando(true)
    setHayError(false)
    leerBanderaListasPrecios(supabaseClient)
      .then((valor) => {
        if (peticion === ultimaPeticion.current) setActiva(valor)
      })
      .catch((error: unknown) => {
        console.error('No pudimos leer la bandera de las listas de precios.', error)
        if (peticion === ultimaPeticion.current) setHayError(true)
      })
      .finally(() => {
        if (peticion === ultimaPeticion.current) setCargando(false)
      })
  }, [organizacionId])

  return { activa, cargando, hayError }
}
