import { useCallback, useEffect, useRef, useState } from 'react'
import { listarCotizacionesRpc, type PaginaHistorialCotizaciones } from '../lib/cotizacionHistorial'
import { supabaseClient } from '../lib/supabase'
import { useOrganizacionDeTrabajo } from './useOrganizacionDeTrabajo'

// Historial de cargas de la cotización (F-PRE-04, FR-017/FR-018). Solo lectura, paginado por cursor:
// guarda la pila de cursores de las páginas ya recorridas para poder volver. (No es
// `useHistorialCotizaciones`, que lee las cotizaciones importadas del sistema anterior.) La cotización
// es de la ORGANIZACIÓN, no de la empresa activa (Principio VIII, no aplica): al cambiar la organización
// de trabajo vuelve a la primera página. «Última petición gana»; un error queda en `hayError`.
// `habilitado` en false (sin acceso a la sección) no llama a la RPC: la base respondería 42501.
export function useHistorialCargasCotizacion(habilitado = true) {
  const { organizacionId } = useOrganizacionDeTrabajo()
  const [cursores, setCursores] = useState<(string | null)[]>([null])
  const [pagina, setPagina] = useState<PaginaHistorialCotizaciones | null>(null)
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const [version, setVersion] = useState(0)
  const ultimaPeticion = useRef(0)
  const [organizacionDelRecorrido, setOrganizacionDelRecorrido] = useState(organizacionId)
  // Reinicia durante el render (no en un efecto): así nunca se pide con el cursor de la organización anterior.
  if (organizacionDelRecorrido !== organizacionId) {
    setOrganizacionDelRecorrido(organizacionId)
    setCursores([null])
    setPagina(null)
    setCargando(true) // sin esto, un cuadro mostraría «todavía no hay cargas» hasta que corra el efecto
  }
  const cursorActual = cursores[cursores.length - 1]

  useEffect(() => {
    if (!habilitado) return
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    setHayError(false)
    listarCotizacionesRpc(supabaseClient, cursorActual)
      .then((resultado) => {
        if (peticion === ultimaPeticion.current) setPagina(resultado)
      })
      .catch((error: unknown) => {
        console.error('No pudimos leer el historial de cargas de la cotización.', error)
        if (peticion === ultimaPeticion.current) {
          setPagina(null)
          setHayError(true)
        }
      })
      .finally(() => {
        if (peticion === ultimaPeticion.current) setCargando(false)
      })
  }, [cursorActual, organizacionId, version, habilitado])

  const siguiente = useCallback(() => {
    const proximo = pagina?.siguienteCursor
    if (proximo) setCursores((actuales) => [...actuales, proximo])
  }, [pagina])

  const anterior = useCallback(() => setCursores((actuales) => (actuales.length > 1 ? actuales.slice(0, -1) : actuales)), [])

  // Vuelve a la primera página y relee (p. ej. tras confirmar una cotización nueva).
  const recargar = useCallback(() => {
    setCursores([null])
    setVersion((v) => v + 1)
  }, [])

  return {
    filas: pagina?.filas ?? [],
    numeroPagina: cursores.length,
    haySiguiente: pagina?.siguienteCursor != null,
    hayAnterior: cursores.length > 1,
    cargando,
    hayError,
    siguiente,
    anterior,
    recargar,
  }
}
