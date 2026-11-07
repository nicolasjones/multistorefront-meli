import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import {
  COLUMNAS_PROCESO,
  REFRESCO_PROCESOS_MS,
  TAMANO_PAGINA_PROCESOS,
  estaAbierto,
  type ProcesoMasivo,
} from '../lib/procesosMasivos'

// Procesos masivos de la organización (RLS: solo administradores), acotados a la empresa activa
// cuando hay una (Principio VIII, D-6: un proceso sin empresa solo aparece en «Todas»). La empresa
// va en las dependencias de la carga: al cambiarla se recarga todo, con «última petición gana».
// Mientras haya procesos abiertos se vuelve a consultar cada REFRESCO_PROCESOS_MS (FR-012) sin
// mostrar el esqueleto de carga; al terminar todos, deja de consultar.
export function useProcesosMasivos(empresaId: string | null, pagina: number, habilitado = true) {
  const [procesos, setProcesos] = useState<ProcesoMasivo[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isError, setIsError] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async (silencioso: boolean) => {
    if (!habilitado) return
    const peticion = ++ultimaPeticion.current
    if (!silencioso) setIsLoading(true)
    const desde = (pagina - 1) * TAMANO_PAGINA_PROCESOS
    let consulta = supabaseClient
      .from('procesos_masivos')
      .select(COLUMNAS_PROCESO, { count: 'exact' })
    if (empresaId) consulta = consulta.eq('empresa_id', empresaId)
    let resultado: { data: unknown[] | null; count: number | null; error: unknown }
    try {
      resultado = await consulta
        .order('creado_en', { ascending: false })
        .range(desde, desde + TAMANO_PAGINA_PROCESOS - 1)
    } catch (excepcion) {
      resultado = { data: null, count: null, error: excepcion }
    }
    if (peticion !== ultimaPeticion.current) return
    if (resultado.error) {
      // Un refresco silencioso fallido no tapa la tabla que ya se ve.
      if (!silencioso) {
        setProcesos([])
        setTotal(0)
        setIsError(true)
      }
    } else {
      setProcesos((resultado.data ?? []) as ProcesoMasivo[])
      setTotal(resultado.count ?? 0)
      setIsError(false)
    }
    setIsLoading(false)
  }, [empresaId, pagina, habilitado])

  useEffect(() => {
    void cargar(false)
  }, [cargar])

  const hayAbiertos = procesos.some((proceso) => estaAbierto(proceso.estado))
  useEffect(() => {
    if (!hayAbiertos) return
    const intervalo = setInterval(() => void cargar(true), REFRESCO_PROCESOS_MS)
    return () => clearInterval(intervalo)
  }, [hayAbiertos, cargar])

  const refetch = useCallback(() => cargar(false), [cargar])
  const refrescar = useCallback(() => cargar(true), [cargar])

  return { procesos, total, isLoading, isError, refetch, refrescar }
}
