import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import {
  COLUMNAS_PROCESO,
  REFRESCO_PROCESOS_MS,
  TAMANO_TANDA_PROCESOS,
  estaAbierto,
  type ProcesoMasivo,
} from '../lib/procesosMasivos'

// Procesos masivos de la organización (RLS: solo administradores), acotados a la empresa activa
// cuando hay una (Principio VIII, D-6: un proceso sin empresa solo aparece en «Todas»). La empresa
// va en las dependencias de la carga: al cambiarla se recarga todo, con «última petición gana».
//
// Carga infinita (Constitución, Principio VI): `cargarMas` agranda en una tanda lo que se pide
// (siempre desde el principio, `range(0, cantidad - 1)`), así el refresco periódico mantiene al día
// TODAS las filas ya mostradas y no solo la última tanda. `total` es el conteo exacto del servidor.
// Mientras haya procesos abiertos se vuelve a consultar cada REFRESCO_PROCESOS_MS (FR-012) sin
// mostrar el esqueleto de carga; al terminar todos, deja de consultar.
export function useProcesosMasivos(empresaId: string | null, habilitado = true) {
  const [procesos, setProcesos] = useState<ProcesoMasivo[]>([])
  const [total, setTotal] = useState(0)
  const [cantidad, setCantidad] = useState(TAMANO_TANDA_PROCESOS)
  const [isLoading, setIsLoading] = useState(true)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [isError, setIsError] = useState(false)
  const [errorMas, setErrorMas] = useState(false)
  const [empresaVista, setEmpresaVista] = useState(empresaId)
  const ultimaPeticion = useRef(0)
  // Empresa para la que ya hay filas cargadas: pedir más de la misma no vuelve al esqueleto.
  const cargadoPara = useRef<string | null | undefined>(undefined)

  // Otra empresa: vuelve a la primera tanda (se ajusta durante el render, patrón de React).
  if (empresaVista !== empresaId) {
    setEmpresaVista(empresaId)
    setCantidad(TAMANO_TANDA_PROCESOS)
  }

  const cargar = useCallback(async (silencioso: boolean) => {
    if (!habilitado) return
    const peticion = ++ultimaPeticion.current
    const agregando = !silencioso && cargadoPara.current === empresaId
    if (agregando) setCargandoMas(true)
    else if (!silencioso) setIsLoading(true)
    let consulta = supabaseClient
      .from('procesos_masivos')
      .select(COLUMNAS_PROCESO, { count: 'exact' })
    if (empresaId) consulta = consulta.eq('empresa_id', empresaId)
    let resultado: { data: unknown[] | null; count: number | null; error: unknown }
    try {
      resultado = await consulta
        .order('creado_en', { ascending: false })
        .range(0, cantidad - 1)
    } catch (excepcion) {
      resultado = { data: null, count: null, error: excepcion }
    }
    if (peticion !== ultimaPeticion.current) return
    if (resultado.error) {
      // Un refresco silencioso fallido no tapa la tabla que ya se ve; un «cargar más» fallido conserva lo cargado.
      if (agregando) setErrorMas(true)
      else if (!silencioso) {
        setProcesos([])
        setTotal(0)
        setIsError(true)
      }
    } else {
      setProcesos((resultado.data ?? []) as ProcesoMasivo[])
      setTotal(resultado.count ?? 0)
      setIsError(false)
      setErrorMas(false)
      cargadoPara.current = empresaId
    }
    setCargandoMas(false)
    setIsLoading(false)
  }, [empresaId, cantidad, habilitado])

  useEffect(() => {
    void cargar(false)
  }, [cargar])

  const hayAbiertos = procesos.some((proceso) => estaAbierto(proceso.estado))
  useEffect(() => {
    if (!hayAbiertos) return
    const intervalo = setInterval(() => void cargar(true), REFRESCO_PROCESOS_MS)
    return () => clearInterval(intervalo)
  }, [hayAbiertos, cargar])

  const cargarMas = useCallback(() => {
    if (cargandoMas || isLoading) return
    if (errorMas) void cargar(false)
    else setCantidad((actual) => actual + TAMANO_TANDA_PROCESOS)
  }, [cargandoMas, isLoading, errorMas, cargar])

  const refetch = useCallback(() => cargar(false), [cargar])
  const refrescar = useCallback(() => cargar(true), [cargar])

  return { procesos, total, hayMas: procesos.length < total, cargandoMas, errorMas, cargarMas, isLoading, isError, refetch, refrescar }
}
