import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import type { TipoCliente } from '../lib/clientes'
import { useOrganizacionActiva } from './useOrganizacionActiva'

// Fila de `public.clientes_inactivos` (F-CLI-16).
export type FilaInactivo = {
  cliente_id: string
  numero: number
  nombre: string
  tipo: TipoCliente
  ultima_compra: string
  dias_sin_comprar: number
  comprobantes: number
  facturado: number
}

export type ParametrosInactivos = {
  dias: number
  tipo: TipoCliente | null
  incluirConsumidorFinal: boolean
  /** Tienda (empresa) de la barra superior; null = todas. */
  empresaId: string | null
  pagina: number
  tamano: number
}

type FilaServidor = {
  [K in keyof FilaInactivo]: FilaInactivo[K] | string
} & { total_filas: number | string }

export const argumentosInactivos = (p: ParametrosInactivos) => ({
  p_dias: p.dias,
  p_tipo: p.tipo,
  p_incluir_consumidor_final: p.incluirConsumidorFinal,
  p_pagina: p.pagina,
  p_tamano: p.tamano,
  p_empresa_id: p.empresaId,
})

// `numeric` y `bigint` pueden llegar como texto: se normalizan a número.
export const normalizarFilaInactivo = (fila: FilaServidor): FilaInactivo => ({
  cliente_id: String(fila.cliente_id),
  numero: Number(fila.numero),
  nombre: String(fila.nombre),
  tipo: fila.tipo as TipoCliente,
  ultima_compra: String(fila.ultima_compra),
  dias_sin_comprar: Number(fila.dias_sin_comprar),
  comprobantes: Number(fila.comprobantes),
  facturado: Number(fila.facturado),
})

// Mismo patrón que `useRankingClientes`: «última petición gana», filas previas
// mientras llega la siguiente página y `isLoading` solo en la primera carga o al
// cambiar de organización o de tienda. La autorización la resuelve la función en el servidor.
export function useClientesInactivos(parametros: ParametrosInactivos) {
  const [filas, setFilas] = useState<FilaInactivo[]>([])
  const [total, setTotal] = useState(0)
  const [hayError, setHayError] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [respondidaPara, setRespondidaPara] = useState<string | undefined>(undefined)
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const ultimaPeticion = useRef(0)
  const { dias, tipo, incluirConsumidorFinal, empresaId, pagina, tamano } = parametros
  // Organización + tienda: cambiar cualquiera vuelve a la carga inicial (sin filas ajenas).
  const contexto = `${organizacionId ?? ''}|${empresaId ?? ''}`

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    let resultado: { data: FilaServidor[] | null; error: unknown }
    try {
      resultado = await supabaseClient.rpc('clientes_inactivos', argumentosInactivos({
        dias, tipo, incluirConsumidorFinal, empresaId, pagina, tamano,
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
      setFilas(recibidas.map(normalizarFilaInactivo))
      setTotal(recibidas.length > 0 ? Number(recibidas[0].total_filas) : 0)
    }
    setCargando(false)
    setRespondidaPara(contexto)
    // organizacionId solo dispara la recarga; la organización la resuelve el servidor.
  }, [dias, tipo, incluirConsumidorFinal, empresaId, pagina, tamano, contexto])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const respondio = respondidaPara === contexto
  return {
    filas: respondio ? filas : [],
    total: respondio ? total : 0,
    isLoading: !respondio,
    isFetching: cargando,
    isError: respondio && hayError,
    refetch: cargar,
  }
}
