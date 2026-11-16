import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import type { TipoCliente } from '../lib/clientes'
import { useOrganizacionActiva } from './useOrganizacionActiva'

// Fila de `public.ranking_clientes_comparado` (F-CLI-14): lo facturado en el
// período aplicado y en el de comparación, y la variación entre ambos.
export type FilaRankingComparado = {
  posicion: number
  cliente_id: string
  numero: number
  nombre: string
  tipo: TipoCliente
  comprobantes: number
  facturado: number
  comprobantes_comparacion: number
  facturado_comparacion: number
  variacion: number
  /** Nulo si la base de comparación es 0 o negativa: la pantalla muestra «—». */
  variacion_porcentaje: number | null
}

export type ParametrosRankingComparado = {
  desde: string
  hasta: string
  desdeComparacion: string
  hastaComparacion: string
  tipo: TipoCliente | null
  incluirConsumidorFinal: boolean
  conIva: boolean
  /** Tienda (empresa) activa; null = todas. */
  empresaId: string | null
  pagina: number
  tamano: number
}

type FilaServidor = {
  [K in keyof FilaRankingComparado]: FilaRankingComparado[K] | string
} & { total_filas: number | string }

export const argumentosRankingComparado = (p: ParametrosRankingComparado) => ({
  p_desde: p.desde,
  p_hasta: p.hasta,
  p_desde_comparacion: p.desdeComparacion,
  p_hasta_comparacion: p.hastaComparacion,
  p_tipo: p.tipo,
  p_incluir_consumidor_final: p.incluirConsumidorFinal,
  p_con_iva: p.conIva,
  p_pagina: p.pagina,
  p_tamano: p.tamano,
  p_empresa_id: p.empresaId,
})

// `numeric` y `bigint` pueden llegar como texto; el porcentaje nulo se conserva nulo.
export const normalizarFilaComparado = (fila: FilaServidor): FilaRankingComparado => ({
  posicion: Number(fila.posicion),
  cliente_id: String(fila.cliente_id),
  numero: Number(fila.numero),
  nombre: String(fila.nombre),
  tipo: fila.tipo as TipoCliente,
  comprobantes: Number(fila.comprobantes),
  facturado: Number(fila.facturado),
  comprobantes_comparacion: Number(fila.comprobantes_comparacion),
  facturado_comparacion: Number(fila.facturado_comparacion),
  variacion: Number(fila.variacion),
  variacion_porcentaje: fila.variacion_porcentaje === null || fila.variacion_porcentaje === undefined
    ? null
    : Number(fila.variacion_porcentaje),
})

// Mismo patrón que `useRankingClientes`: «última petición gana», filas previas
// mientras llega otra página y `isLoading` solo en la primera carga o al cambiar
// de organización. La autorización la resuelve la función en el servidor.
export function useRankingComparado(parametros: ParametrosRankingComparado) {
  const [filas, setFilas] = useState<FilaRankingComparado[]>([])
  const [total, setTotal] = useState(0)
  const [hayError, setHayError] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [respondidaPara, setRespondidaPara] = useState<string | null | undefined>(undefined)
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const ultimaPeticion = useRef(0)
  const { desde, hasta, desdeComparacion, hastaComparacion, tipo, incluirConsumidorFinal, conIva, empresaId, pagina, tamano } = parametros

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    let resultado: { data: FilaServidor[] | null; error: unknown }
    try {
      resultado = await supabaseClient.rpc('ranking_clientes_comparado', argumentosRankingComparado({
        desde, hasta, desdeComparacion, hastaComparacion, tipo, incluirConsumidorFinal, conIva, empresaId, pagina, tamano,
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
      setFilas(recibidas.map(normalizarFilaComparado))
      setTotal(recibidas.length > 0 ? Number(recibidas[0].total_filas) : 0)
    }
    setCargando(false)
    setRespondidaPara(organizacionId)
    // organizacionId solo dispara la recarga; la organización la resuelve el servidor.
  }, [desde, hasta, desdeComparacion, hastaComparacion, tipo, incluirConsumidorFinal, conIva, empresaId, pagina, tamano, organizacionId])

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
