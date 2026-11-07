import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import { TAMANO_PAGINA_ERRORES, type ErrorProceso } from '../lib/procesosMasivos'

// Errores por fila de un proceso, paginados en servidor (FR-013). El motivo ya viene sanitizado de la base.
export function useErroresProceso(procesoId: string, pagina: number) {
  const [errores, setErrores] = useState<ErrorProceso[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isError, setIsError] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setIsLoading(true)
    const desde = (pagina - 1) * TAMANO_PAGINA_ERRORES
    let resultado: { data: unknown[] | null; count: number | null; error: unknown }
    try {
      resultado = await supabaseClient
        .from('procesos_masivos_errores')
        .select('id, fila, referencia, motivo_sanitizado', { count: 'exact' })
        .eq('proceso_id', procesoId)
        .order('fila', { ascending: true, nullsFirst: true })
        .order('creado_en', { ascending: true })
        .range(desde, desde + TAMANO_PAGINA_ERRORES - 1)
    } catch (excepcion) {
      resultado = { data: null, count: null, error: excepcion }
    }
    if (peticion !== ultimaPeticion.current) return
    setIsError(Boolean(resultado.error))
    setErrores(resultado.error ? [] : ((resultado.data ?? []) as ErrorProceso[]))
    setTotal(resultado.error ? 0 : resultado.count ?? 0)
    setIsLoading(false)
  }, [procesoId, pagina])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return { errores, total, isLoading, isError, refetch: cargar }
}
