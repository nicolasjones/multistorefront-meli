import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cargarCotizacionRpc,
  confirmarCotizacionRpc,
  descartarCotizacionRpc,
  leerEstadoCotizacion,
  mensajeDeErrorCotizacion,
  mensajeDeErrorConfirmacion,
  requiereRevisarDeNuevo,
  type CotizacionCargada,
  type CotizacionConfirmada,
  type EstadoCotizacion,
} from '../lib/cotizacion'
import { supabaseClient } from '../lib/supabase'
import { useOrganizacionDeTrabajo } from './useOrganizacionDeTrabajo'

// Estado de la cotización (F-PRE-02, FR-004/FR-005). Con alcance «sistema» es de la ORGANIZACIÓN y se
// recarga solo si cambia la organización de trabajo (superadmin); con alcance «una por empresa» (F-PRE-06)
// es el de `empresaId` y se recarga también al cambiar de empresa (Principio VIII). `habilitado` en false
// no llama a la base (la pantalla todavía no sabe de qué empresa es). «Última petición gana»; un error no
// se traga: queda en `hayError`.
export function useEstadoCotizacion(empresaId: string | null = null, habilitado = true) {
  const { organizacionId } = useOrganizacionDeTrabajo()
  const [estado, setEstado] = useState<EstadoCotizacion | null>(null)
  const [cargando, setCargando] = useState(habilitado)
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    setHayError(false)
    try {
      const resultado = await leerEstadoCotizacion(supabaseClient, empresaId)
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
  }, [empresaId])

  useEffect(() => {
    // Nunca muestra la cotización de la organización (o empresa) anterior mientras llega la nueva.
    setEstado(null)
    if (habilitado) void cargar()
    else ultimaPeticion.current++
  }, [cargar, organizacionId, habilitado])

  return { estado, cargando: habilitado && cargando, hayError, recargar: cargar }
}

export type ResultadoCarga = { ok: true; carga: CotizacionCargada } | { ok: false; mensaje: string }

// Carga el dólar del día como cotización PENDIENTE (FR-002/FR-006). No cambia ningún precio.
export function useCargarCotizacion() {
  const [enviando, setEnviando] = useState(false)

  const cargar = useCallback(async (valor: number, empresaId?: string | null): Promise<ResultadoCarga> => {
    setEnviando(true)
    try {
      return { ok: true, carga: await cargarCotizacionRpc(supabaseClient, valor, empresaId) }
    } catch (error) {
      console.error('No pudimos cargar la cotización.', error)
      return { ok: false, mensaje: mensajeDeErrorCotizacion(error as { code?: string }) }
    } finally {
      setEnviando(false)
    }
  }, [])

  return { cargar, enviando }
}

// `revisar`: la base rechazó porque la variación real ya no es la que el usuario vio ⇒ hay que recalcular la vista previa.
export type ResultadoConfirmacion = { ok: true; confirmada: CotizacionConfirmada } | { ok: false; mensaje: string; revisar?: boolean }
export type ResultadoDescarte = { ok: true } | { ok: false; mensaje: string }

// Confirma o descarta la cotización pendiente (F-PRE-03, FR-010/FR-012/FR-015). La base decide si
// recalcula (con el umbral configurado) en una sola transacción; acá solo se llama y se traduce el error.
export function useConfirmarCotizacion() {
  const [enviando, setEnviando] = useState(false)

  // `variacionVista`: la variación del aviso de variación inusual que el usuario tenía a la vista (null si no había aviso).
  const confirmar = useCallback(async (empresaId?: string | null, variacionVista: number | null = null): Promise<ResultadoConfirmacion> => {
    setEnviando(true)
    try {
      return { ok: true, confirmada: await confirmarCotizacionRpc(supabaseClient, empresaId, variacionVista) }
    } catch (error) {
      console.error('No pudimos confirmar la cotización.', error)
      const e = error as { code?: string; hint?: string | null }
      return { ok: false, mensaje: mensajeDeErrorConfirmacion(e), revisar: requiereRevisarDeNuevo(e) }
    } finally {
      setEnviando(false)
    }
  }, [])

  const descartar = useCallback(async (empresaId?: string | null): Promise<ResultadoDescarte> => {
    setEnviando(true)
    try {
      await descartarCotizacionRpc(supabaseClient, empresaId)
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
