import { useCallback, useEffect, useRef, useState } from 'react'
import { type Previsualizacion, previsualizarCotizacionRpc } from '../lib/cotizacion'
import { supabaseClient } from '../lib/supabase'
import { useOrganizacionDeTrabajo } from './useOrganizacionDeTrabajo'

// Vista previa de la cotización pendiente (F-PRE-03, FR-009/FR-014). Solo lee: no cambia ningún
// precio. La cotización es de la ORGANIZACIÓN, no de la empresa activa (Principio VIII, no aplica):
// se recarga solo si cambia la organización de trabajo (superadmin). «Última petición gana»; un error
// no se traga: queda en `hayError`.
export function usePrevisualizarCotizacion() {
  const { organizacionId } = useOrganizacionDeTrabajo()
  const [previa, setPrevia] = useState<Previsualizacion | null>(null)
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    setHayError(false)
    try {
      const resultado = await previsualizarCotizacionRpc(supabaseClient)
      if (peticion === ultimaPeticion.current) setPrevia(resultado)
    } catch (error) {
      console.error('No pudimos calcular la vista previa de la cotización.', error)
      if (peticion === ultimaPeticion.current) {
        setPrevia(null)
        setHayError(true)
      }
    } finally {
      if (peticion === ultimaPeticion.current) setCargando(false)
    }
  }, [])

  useEffect(() => {
    // Nunca muestra la vista previa de la organización anterior mientras llega la nueva.
    setPrevia(null)
    void cargar()
  }, [cargar, organizacionId])

  return { previa, cargando, hayError, recargar: cargar }
}
