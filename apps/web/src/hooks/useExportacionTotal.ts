import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import { REFRESCO_PROCESOS_MS, estaAbierto } from '../lib/procesosMasivos'
import { COLUMNAS_EXPORTACION_TOTAL, FUNCIONALIDAD_EXPORTACION_TOTAL, type ProcesoExportacionTotal } from '../lib/exportacionTotal'

// Última exportación total de la organización (RLS: solo administradores). NO se acota a la empresa activa:
// la exportación es de toda la organización (FR-039, Principio VIII declarado «no aplica»). Mientras esté
// abierta se vuelve a consultar cada REFRESCO_PROCESOS_MS sin mostrar el esqueleto de carga.
export function useExportacionTotal(habilitado = true) {
  const [ultima, setUltima] = useState<ProcesoExportacionTotal | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isError, setIsError] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async (silencioso: boolean) => {
    if (!habilitado) return
    const peticion = ++ultimaPeticion.current
    if (!silencioso) setIsLoading(true)
    let resultado: { data: unknown[] | null; error: unknown }
    try {
      resultado = await supabaseClient
        .from('procesos_masivos')
        .select(COLUMNAS_EXPORTACION_TOTAL)
        .eq('funcionalidad', FUNCIONALIDAD_EXPORTACION_TOTAL)
        .order('creado_en', { ascending: false })
        .limit(1)
    } catch (excepcion) {
      resultado = { data: null, error: excepcion }
    }
    if (peticion !== ultimaPeticion.current) return
    if (resultado.error) {
      // Un refresco silencioso fallido no tapa el estado que ya se ve.
      if (!silencioso) setIsError(true)
    } else {
      setUltima(((resultado.data ?? [])[0] as ProcesoExportacionTotal | undefined) ?? null)
      setIsError(false)
    }
    setIsLoading(false)
  }, [habilitado])

  useEffect(() => {
    void cargar(false)
  }, [cargar])

  const abierta = ultima !== null && estaAbierto(ultima.estado)
  useEffect(() => {
    if (!abierta) return
    const intervalo = setInterval(() => void cargar(true), REFRESCO_PROCESOS_MS)
    return () => clearInterval(intervalo)
  }, [abierta, cargar])

  const refetch = useCallback(() => cargar(false), [cargar])
  const refrescar = useCallback(() => cargar(true), [cargar])

  return { ultima, isLoading, isError, refetch, refrescar }
}
