import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import type { TipoCliente } from '../lib/clientes'
import { normalizarFilaRanking, type FilaRanking } from './useRankingClientes'
import { useOrganizacionActiva } from './useOrganizacionActiva'

// Misma fila que el ranking básico: `public.ranking_clientes_por_dimension` (F-CLI-15) devuelve las
// mismas columnas, filtradas por producto, categoría y provincia.
export type FilaRankingPorDimension = FilaRanking

export type ParametrosRankingPorDimension = {
  desde: string
  hasta: string
  productoId: string | null
  categoriaId: string | null
  provincia: string | null
  tipo: TipoCliente | null
  incluirConsumidorFinal: boolean
  conIva: boolean
  /** Tienda (empresa) activa; null = todas. */
  empresaId: string | null
  pagina: number
  tamano: number
  /** No consulta (no hay ningún filtro de dimensión activo: lo atiende `ranking_clientes`). */
  pausado?: boolean
}

type FilaServidor = Parameters<typeof normalizarFilaRanking>[0]

export const argumentosRankingPorDimension = (p: ParametrosRankingPorDimension) => ({
  p_desde: p.desde,
  p_hasta: p.hasta,
  p_producto_id: p.productoId,
  p_categoria_id: p.categoriaId,
  p_provincia: p.provincia,
  p_tipo: p.tipo,
  p_incluir_consumidor_final: p.incluirConsumidorFinal,
  p_con_iva: p.conIva,
  p_pagina: p.pagina,
  p_tamano: p.tamano,
  p_empresa_id: p.empresaId,
})

// Mismo patrón que `useRankingClientes`: «última petición gana», filas previas mientras llega otra
// página y `isLoading` solo en la primera carga o al cambiar de organización. La autorización la
// resuelve la función en el servidor (sección `clientes`).
export function useRankingPorDimension(parametros: ParametrosRankingPorDimension) {
  const [filas, setFilas] = useState<FilaRankingPorDimension[]>([])
  const [total, setTotal] = useState(0)
  const [hayError, setHayError] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [respondidaPara, setRespondidaPara] = useState<string | null | undefined>(undefined)
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const ultimaPeticion = useRef(0)
  const { desde, hasta, productoId, categoriaId, provincia, tipo, incluirConsumidorFinal, conIva, empresaId, pagina, tamano, pausado = false } = parametros

  const cargar = useCallback(async () => {
    if (pausado) return
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    let resultado: { data: Array<FilaServidor & { total_filas: number | string }> | null; error: unknown }
    try {
      resultado = await supabaseClient.rpc('ranking_clientes_por_dimension', argumentosRankingPorDimension({
        desde, hasta, productoId, categoriaId, provincia, tipo, incluirConsumidorFinal, conIva, empresaId, pagina, tamano,
      }))
    } catch (excepcion) {
      resultado = { data: null, error: excepcion }
    }
    if (peticion !== ultimaPeticion.current) return

    const { data, error } = resultado
    setHayError(Boolean(error))
    if (error) {
      setFilas([])
      setTotal(0)
    } else {
      const recibidas = data ?? []
      setFilas(recibidas.map(normalizarFilaRanking))
      setTotal(recibidas.length > 0 ? Number(recibidas[0].total_filas) : 0)
    }
    setCargando(false)
    setRespondidaPara(organizacionId)
    // organizacionId solo dispara la recarga; la organización la resuelve el servidor.
  }, [desde, hasta, productoId, categoriaId, provincia, tipo, incluirConsumidorFinal, conIva, empresaId, pagina, tamano, pausado, organizacionId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const respondio = respondidaPara !== undefined && respondidaPara === organizacionId
  return {
    filas,
    total,
    isLoading: !respondio,
    isFetching: cargando,
    isError: hayError,
    refetch: cargar,
  }
}
