import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import { COLUMNAS_ERROR, TAMANO_TANDA_ERRORES, type ErrorProceso } from '../lib/procesosMasivos'

// Errores por fila de un proceso con carga infinita (FR-013, Principio VI). `cargarMas` agranda en una tanda
// lo que se pide (siempre desde el principio): al refrescarse por el avance del proceso se actualizan todas
// las filas mostradas. El motivo ya viene sanitizado de la base. `total` es el conteo exacto del servidor.
export function useErroresProceso(procesoId: string, refrescarCon?: unknown) {
  const [errores, setErrores] = useState<ErrorProceso[]>([])
  const [total, setTotal] = useState(0)
  const [cantidad, setCantidad] = useState(TAMANO_TANDA_ERRORES)
  const [isLoading, setIsLoading] = useState(true)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [isError, setIsError] = useState(false)
  const [errorMas, setErrorMas] = useState(false)
  const ultimaPeticion = useRef(0)
  const hayDatos = useRef(false)

  const cargar = useCallback(async (silencioso = false) => {
    const peticion = ++ultimaPeticion.current
    const agregando = !silencioso && hayDatos.current
    if (agregando) setCargandoMas(true)
    else if (!silencioso) setIsLoading(true)
    let resultado: { data: unknown[] | null; count: number | null; error: unknown }
    try {
      resultado = await supabaseClient
        .from('procesos_masivos_errores')
        .select(COLUMNAS_ERROR, { count: 'exact' })
        .eq('proceso_id', procesoId)
        .order('fila', { ascending: true, nullsFirst: true })
        .order('creado_en', { ascending: true })
        .range(0, cantidad - 1)
    } catch (excepcion) {
      resultado = { data: null, count: null, error: excepcion }
    }
    if (peticion !== ultimaPeticion.current) return
    if (resultado.error) {
      // Un refresco silencioso fallido no tapa los errores que ya se ven; «cargar más» fallido conserva lo cargado.
      if (agregando) setErrorMas(true)
      else if (!silencioso) {
        setIsError(true)
        setErrores([])
        setTotal(0)
      }
    } else {
      setIsError(false)
      setErrorMas(false)
      setErrores((resultado.data ?? []) as ErrorProceso[])
      setTotal(resultado.count ?? 0)
      hayDatos.current = true
    }
    setCargandoMas(false)
    setIsLoading(false)
  }, [procesoId, cantidad])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Con el proceso en curso la lista cambia: se vuelve a consultar cuando cambia su avance o su conteo de errores.
  const alCargar = useRef(cargar)
  alCargar.current = cargar
  const primera = useRef(true)
  useEffect(() => {
    if (primera.current) {
      primera.current = false
      return
    }
    void alCargar.current(true)
  }, [refrescarCon])

  const cargarMas = useCallback(() => {
    if (cargandoMas || isLoading) return
    if (errorMas) void cargar(false)
    else setCantidad((actual) => actual + TAMANO_TANDA_ERRORES)
  }, [cargandoMas, isLoading, errorMas, cargar])

  return { errores, total, hayMas: errores.length < total, cargandoMas, errorMas, cargarMas, isLoading, isError, refetch: () => cargar(false) }
}
