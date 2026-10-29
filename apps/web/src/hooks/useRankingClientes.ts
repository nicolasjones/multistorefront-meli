import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import type { TipoCliente } from '../lib/clientes'
import { useOrganizacionActiva } from './useOrganizacionActiva'

// Fila del ranking: lo que devuelve `public.ranking_clientes` (F-CLI-08).
export type FilaRanking = {
  posicion: number
  cliente_id: string
  numero: number
  nombre: string
  tipo: TipoCliente
  comprobantes: number
  facturado: number
  participacion: number
}

export type ParametrosRanking = {
  desde: string
  hasta: string
  tipo: TipoCliente | null
  incluirConsumidorFinal: boolean
  conIva: boolean
  /** Tienda (empresa) por la que se filtra el ranking (F-CLI-11); null = todas. */
  empresaId: string | null
  pagina: number
  tamano: number
}

type FilaServidor = {
  [K in keyof FilaRanking]: FilaRanking[K] | string
} & { total_filas: number | string }

// Argumentos de la RPC: los usa también la exportación (F-CLI-09) para llamar a
// la misma función por lotes.
export const argumentosRanking = (p: ParametrosRanking) => ({
  p_desde: p.desde,
  p_hasta: p.hasta,
  p_tipo: p.tipo,
  p_incluir_consumidor_final: p.incluirConsumidorFinal,
  p_con_iva: p.conIva,
  p_pagina: p.pagina,
  p_tamano: p.tamano,
  p_empresa_id: p.empresaId,
})

// `numeric` y `bigint` pueden llegar como texto: se normalizan a número.
export const normalizarFilaRanking = (fila: FilaServidor): FilaRanking => ({
  posicion: Number(fila.posicion),
  cliente_id: String(fila.cliente_id),
  numero: Number(fila.numero),
  nombre: String(fila.nombre),
  tipo: fila.tipo as TipoCliente,
  comprobantes: Number(fila.comprobantes),
  facturado: Number(fila.facturado),
  participacion: Number(fila.participacion),
})

// Mismo patrón que `useBuscarClientes`: «última petición gana», filas previas
// mientras llega la siguiente página (`isFetching`) y `isLoading` solo en la
// primera carga o al cambiar de organización. La autorización la resuelve la
// función en el servidor (sección `clientes`); acá solo se muestran errores.
export function useRankingClientes(parametros: ParametrosRanking) {
  const [filas, setFilas] = useState<FilaRanking[]>([])
  const [total, setTotal] = useState(0)
  const [hayError, setHayError] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [respondidaPara, setRespondidaPara] = useState<string | null | undefined>(undefined)
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const ultimaPeticion = useRef(0)
  const { desde, hasta, tipo, incluirConsumidorFinal, conIva, empresaId, pagina, tamano } = parametros

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    let resultado: { data: FilaServidor[] | null; error: unknown }
    try {
      resultado = await supabaseClient.rpc('ranking_clientes', argumentosRanking({
        desde, hasta, tipo, incluirConsumidorFinal, conIva, empresaId, pagina, tamano,
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
  }, [desde, hasta, tipo, incluirConsumidorFinal, conIva, empresaId, pagina, tamano, organizacionId])

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
