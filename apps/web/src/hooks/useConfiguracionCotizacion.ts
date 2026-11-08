import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type AlcanceCotizacion,
  type ConfiguracionCotizacion,
  type PrevisualizacionAlcance,
  cambiarAlcanceCotizacionRpc,
  guardarConfiguracionCotizacion,
  leerConfiguracionCotizacion,
  mensajeDeErrorAlcance,
  mensajeDeErrorConfiguracion,
  previsualizarCambioAlcanceRpc,
} from '../lib/cotizacion'
import { supabaseClient } from '../lib/supabase'
import { useOrganizacionDeTrabajo } from './useOrganizacionDeTrabajo'

// Configuración de la cotización del dólar (F-PRE-06, FR-008): alcance, redondeo, umbral, confirmación y aviso.
// Es de la ORGANIZACIÓN: se recarga solo si cambia la organización de trabajo (superadmin). «Última petición
// gana»; un error no se traga: queda en `hayError` y la configuración en null (no se asume ningún valor).
// `habilitado` en false (sin acceso a la sección) no llama a la base, que respondería 42501.
export function useConfiguracionCotizacion(habilitado = true) {
  const { organizacionId } = useOrganizacionDeTrabajo()
  const [configuracion, setConfiguracion] = useState<ConfiguracionCotizacion | null>(null)
  const [cargando, setCargando] = useState(habilitado)
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    setHayError(false)
    try {
      const resultado = await leerConfiguracionCotizacion(supabaseClient)
      if (peticion === ultimaPeticion.current) setConfiguracion(resultado)
    } catch (error) {
      console.error('No pudimos leer la configuración de la cotización.', error)
      if (peticion === ultimaPeticion.current) {
        setConfiguracion(null)
        setHayError(true)
      }
    } finally {
      if (peticion === ultimaPeticion.current) setCargando(false)
    }
  }, [])

  useEffect(() => {
    // Nunca muestra la configuración de la organización anterior mientras llega la nueva.
    setConfiguracion(null)
    if (habilitado) void cargar()
    else ultimaPeticion.current++
  }, [cargar, organizacionId, habilitado])

  return { configuracion, cargando: habilitado && cargando, hayError, recargar: cargar }
}

export type ResultadoGuardadoConfiguracion = { ok: true; actualizado: boolean } | { ok: false; mensaje: string }

// Guarda redondeo, umbral, confirmación y aviso (no el alcance). Traduce el error de la base.
export function useGuardarConfiguracionCotizacion() {
  const [guardando, setGuardando] = useState(false)

  const guardar = useCallback(async (valores: Omit<ConfiguracionCotizacion, 'alcance'>): Promise<ResultadoGuardadoConfiguracion> => {
    setGuardando(true)
    try {
      const { actualizado } = await guardarConfiguracionCotizacion(supabaseClient, valores)
      return { ok: true, actualizado }
    } catch (error) {
      console.error('No pudimos guardar la configuración de la cotización.', error)
      return { ok: false, mensaje: mensajeDeErrorConfiguracion(error as { code?: string }) }
    } finally {
      setGuardando(false)
    }
  }, [])

  return { guardar, guardando }
}

// Vista previa del cambio de alcance (FR-005) y el cambio en sí (FR-004). La vista previa solo lee; el cambio
// es una sola transacción en la base y exige haber visto la vista previa.
export function useCambioDeAlcance() {
  const [enviando, setEnviando] = useState(false)

  const previsualizar = useCallback((alcance: AlcanceCotizacion): Promise<PrevisualizacionAlcance> => (
    previsualizarCambioAlcanceRpc(supabaseClient, alcance)
  ), [])

  const cambiar = useCallback(async (alcance: AlcanceCotizacion): Promise<{ ok: true; preciosAfectados: number } | { ok: false; mensaje: string }> => {
    setEnviando(true)
    try {
      const { preciosAfectados } = await cambiarAlcanceCotizacionRpc(supabaseClient, alcance)
      return { ok: true, preciosAfectados }
    } catch (error) {
      console.error('No pudimos cambiar el alcance de la cotización.', error)
      return { ok: false, mensaje: mensajeDeErrorAlcance(error as { code?: string }) }
    } finally {
      setEnviando(false)
    }
  }, [])

  return { previsualizar, cambiar, enviando }
}
