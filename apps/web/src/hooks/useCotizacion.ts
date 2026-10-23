import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cargarCotizacionRpc,
  leerEstadoCotizacion,
  mensajeDeErrorCotizacion,
  type CotizacionCargada,
  type EstadoCotizacion,
} from '../lib/cotizacion'
import { supabaseClient } from '../lib/supabase'
import { useOrganizacionDeTrabajo } from './useOrganizacionDeTrabajo'

// Estado de la cotización de la organización (F-PRE-02, FR-004/FR-005). La cotización es de la
// ORGANIZACIÓN, no de la empresa activa: se recarga solo si cambia la organización de trabajo
// (superadmin). «Última petición gana»; un error no se traga: queda en `hayError`.
export function useEstadoCotizacion() {
  const { organizacionId } = useOrganizacionDeTrabajo()
  const [estado, setEstado] = useState<EstadoCotizacion | null>(null)
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    setHayError(false)
    try {
      const resultado = await leerEstadoCotizacion(supabaseClient)
      if (peticion === ultimaPeticion.current) setEstado(resultado)
    } catch (error) {
      console.error('No pudimos cargar la cotización del dólar.', error)
      if (peticion === ultimaPeticion.current) {
        setEstado(null)
        setHayError(true)
      }
    } finally {
      if (peticion === ultimaPeticion.current) setCargando(false)
    }
  }, [])

  useEffect(() => {
    // Nunca muestra la cotización de la organización anterior mientras llega la nueva.
    setEstado(null)
    void cargar()
  }, [cargar, organizacionId])

  return { estado, cargando, hayError, recargar: cargar }
}

export type ResultadoCarga = { ok: true; carga: CotizacionCargada } | { ok: false; mensaje: string }

// Carga el dólar del día como cotización PENDIENTE (FR-002/FR-006). No cambia ningún precio.
export function useCargarCotizacion() {
  const [enviando, setEnviando] = useState(false)

  const cargar = useCallback(async (valor: number): Promise<ResultadoCarga> => {
    setEnviando(true)
    try {
      return { ok: true, carga: await cargarCotizacionRpc(supabaseClient, valor) }
    } catch (error) {
      console.error('No pudimos cargar la cotización.', error)
      return { ok: false, mensaje: mensajeDeErrorCotizacion(error as { code?: string }) }
    } finally {
      setEnviando(false)
    }
  }, [])

  return { cargar, enviando }
}
