import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cargarCotizacionRpc,
  confirmarCotizacionRpc,
  descartarCotizacionRpc,
  leerEstadoCotizacion,
  mensajeDeErrorCotizacion,
  mensajeDeErrorConfirmacion,
  type CotizacionCargada,
  type CotizacionConfirmada,
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

export type ResultadoConfirmacion = { ok: true; confirmada: CotizacionConfirmada } | { ok: false; mensaje: string }
export type ResultadoDescarte = { ok: true } | { ok: false; mensaje: string }

// Confirma o descarta la cotización pendiente (F-PRE-03, FR-010/FR-012/FR-015). La base decide si
// recalcula (umbral de 1 %) en una sola transacción; acá solo se llama y se traduce el error.
export function useConfirmarCotizacion() {
  const [enviando, setEnviando] = useState(false)

  const confirmar = useCallback(async (): Promise<ResultadoConfirmacion> => {
    setEnviando(true)
    try {
      return { ok: true, confirmada: await confirmarCotizacionRpc(supabaseClient) }
    } catch (error) {
      console.error('No pudimos confirmar la cotización.', error)
      return { ok: false, mensaje: mensajeDeErrorConfirmacion(error as { code?: string }) }
    } finally {
      setEnviando(false)
    }
  }, [])

  const descartar = useCallback(async (): Promise<ResultadoDescarte> => {
    setEnviando(true)
    try {
      await descartarCotizacionRpc(supabaseClient)
      return { ok: true }
    } catch (error) {
      console.error('No pudimos descartar la cotización.', error)
      return { ok: false, mensaje: 'No pudimos descartar la cotización. Intentá de nuevo.' }
    } finally {
      setEnviando(false)
    }
  }, [])

  return { confirmar, descartar, enviando }
}
