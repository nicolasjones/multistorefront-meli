import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import { type Categoria, leerCategoriasSelector } from '../lib/categorias'
import { useOrganizacionActiva } from './useOrganizacionActiva'

// Categorías de la organización para el selector del producto (F-CAT-08, FR-022). RLS resuelve la
// organización (y exige lectura en Categorías: sin ella la lista llega vacía). «Última petición gana»
// si cambia la organización activa mientras hay una carga en vuelo.
export function useCategorias({ habilitado = true }: { habilitado?: boolean } = {}) {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [cargando, setCargando] = useState(false)
  const [respondidaPara, setRespondidaPara] = useState<string | null | undefined>(undefined)
  const [hayError, setHayError] = useState(false)
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    let resultado: { datos: Categoria[]; error: boolean }
    try {
      resultado = { datos: await leerCategoriasSelector(supabaseClient), error: false }
    } catch (error) {
      console.error('No pudimos cargar las categorías.', error)
      resultado = { datos: [], error: true }
    }
    if (peticion !== ultimaPeticion.current) return
    setHayError(resultado.error)
    setCategorias(resultado.datos)
    setCargando(false)
    setRespondidaPara(organizacionId)
  }, [organizacionId])

  useEffect(() => {
    if (habilitado) void cargar()
  }, [habilitado, cargar])

  const respondio = respondidaPara !== undefined && respondidaPara === organizacionId
  return { categorias, isLoading: habilitado && (cargando || !respondio), isError: hayError, refetch: cargar }
}
