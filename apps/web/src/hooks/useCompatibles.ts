import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import { listarCompatibles } from '../lib/productosListado'

// Valores de «Compatible con» de la organización para el filtro del listado (F-CAT-09, FR-005/FR-007).
// `recargarCon` es la empresa activa: al cambiar se vuelven a pedir los valores. «Última petición gana».
// Mientras llega la respuesta nueva se conservan los valores previos; si falla, quedan vacíos y `hayError`.
export function useCompatibles(recargarCon: string | null) {
  const [valores, setValores] = useState<string[]>([])
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    try {
      const resultado = await listarCompatibles(supabaseClient)
      if (peticion !== ultimaPeticion.current) return
      setValores(resultado)
      setHayError(false)
    } catch (error) {
      console.error('No pudimos cargar los valores de «Compatible con».', error)
      if (peticion !== ultimaPeticion.current) return
      setValores([])
      setHayError(true)
    }
    setCargando(false)
  }, [])

  useEffect(() => {
    void recargarCon
    void cargar()
  }, [recargarCon, cargar])

  return { valores, cargando, hayError, recargar: cargar }
}
