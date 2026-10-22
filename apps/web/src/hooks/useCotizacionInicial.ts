import { useCallback, useEffect, useRef, useState } from 'react'
import { type Cotizacion, leerCotizacionInicial } from '../lib/precios'
import { supabaseClient } from '../lib/supabase'

// Cotización inicial del dólar de la organización activa (F-PRE-01). «Última petición gana»;
// un error no se traga: queda en `hayError` y la cotización en null (no se asume ningún valor).
export function useCotizacionInicial() {
  const [cotizacion, setCotizacion] = useState<Cotizacion | null>(null)
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    setHayError(false)
    try {
      const resultado = await leerCotizacionInicial(supabaseClient)
      if (peticion === ultimaPeticion.current) setCotizacion(resultado)
    } catch (error) {
      console.error('No pudimos cargar la cotización.', error)
      if (peticion === ultimaPeticion.current) {
        setCotizacion(null)
        setHayError(true)
      }
    } finally {
      if (peticion === ultimaPeticion.current) setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return { cotizacion, cargando, hayError, recargar: cargar }
}
