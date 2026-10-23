import { useCallback, useEffect, useRef, useState } from 'react'
import { leerCotizacionDelDia, type CotizacionDelDia } from '../lib/cotizacion'
import { supabaseClient } from '../lib/supabase'
import { useOrganizacionDeTrabajo } from './useOrganizacionDeTrabajo'

// ¿Se confirmó una cotización hoy? (F-PRE-05, FR-019/FR-020). Como el resto de la cotización es de la
// ORGANIZACIÓN (no de la empresa activa): se recarga solo si cambia la organización de trabajo.
// «Última petición gana»; un error no se traga: queda en `hayError`.
export function useCotizacionDelDia(habilitado = true) {
  const { organizacionId } = useOrganizacionDeTrabajo()
  const [delDia, setDelDia] = useState<CotizacionDelDia | null>(null)
  const [cargando, setCargando] = useState(habilitado)
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    setHayError(false)
    try {
      const resultado = await leerCotizacionDelDia(supabaseClient)
      if (peticion === ultimaPeticion.current) setDelDia(resultado)
    } catch (error) {
      console.error('No pudimos saber si se cargó el dólar de hoy.', error)
      if (peticion === ultimaPeticion.current) {
        setDelDia(null)
        setHayError(true)
      }
    } finally {
      if (peticion === ultimaPeticion.current) setCargando(false)
    }
  }, [])

  useEffect(() => {
    // Nunca muestra el estado de la organización anterior mientras llega el nuevo.
    setDelDia(null)
    if (habilitado) void cargar()
    else ultimaPeticion.current++
  }, [cargar, organizacionId, habilitado])

  return { delDia, cargando: habilitado && cargando, hayError, recargar: cargar }
}
