import { useCallback, useEffect, useRef, useState } from 'react'
import { useOrganizacionActiva } from '../hooks/useOrganizacionActiva'
import { supabaseClient } from './supabase'

// Reparaciones de un cliente para la pestaña de su ficha (F-SVC-15). La paginación y el filtro por tienda
// viajan al servidor (`reparaciones_de_cliente`): el navegador nunca descarga la lista completa.

export const TAMANO_PAGINA_REPARACIONES_CLIENTE = 25

// Fila de la pestaña: lo que devuelve `public.reparaciones_de_cliente`. Sin costos internos.
export type ReparacionDeCliente = {
  id: string
  numero: string
  empresa: string
  equipo: string
  modelo: string
  estado: string
  estado_tono: string
  ingreso_en: string
  entrega_prevista: string | null
  total: number
}

type RespuestaServidor = { total_filas: number | string; filas: ReparacionDeCliente[] }

export async function listarReparacionesDeCliente(
  clienteId: string, empresaId: string | null, pagina: number, tamano: number,
): Promise<{ total: number; filas: ReparacionDeCliente[] }> {
  const { data, error } = await supabaseClient.rpc('reparaciones_de_cliente', {
    p_cliente: clienteId, p_empresa: empresaId, p_pagina: pagina, p_tamano: tamano,
  })
  if (error) throw error
  const respuesta = (data ?? { total_filas: 0, filas: [] }) as RespuestaServidor
  return {
    total: Number(respuesta.total_filas),
    filas: (respuesta.filas ?? []).map((fila) => ({ ...fila, total: Number(fila.total ?? 0) })),
  }
}

// «Última petición gana». Al cambiar de cliente, de empresa activa o de organización se descartan las
// filas anteriores (`isLoading`): nunca se muestran las de la empresa anterior (Principio VIII). Mientras
// llega otra página se conservan las actuales (`isFetching`).
export function useReparacionesDeCliente(clienteId: string, empresaId: string | null, pagina: number, tamano: number) {
  const [filas, setFilas] = useState<ReparacionDeCliente[]>([])
  const [total, setTotal] = useState(0)
  const [hayError, setHayError] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [respondidaPara, setRespondidaPara] = useState<{ organizacion: string | null; cliente: string; empresa: string | null } | undefined>(undefined)
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    try {
      const resultado = await listarReparacionesDeCliente(clienteId, empresaId, pagina, tamano)
      if (peticion !== ultimaPeticion.current) return
      setFilas(resultado.filas)
      setTotal(resultado.total)
      setHayError(false)
    } catch (excepcion) {
      if (peticion !== ultimaPeticion.current) return
      console.error('No pudimos cargar las reparaciones del cliente.', excepcion)
      setFilas([])
      setTotal(0)
      setHayError(true)
    }
    setCargando(false)
    setRespondidaPara({ organizacion: organizacionId, cliente: clienteId, empresa: empresaId })
    // organizacionId solo dispara la recarga; la organización la resuelve la base.
  }, [clienteId, empresaId, pagina, tamano, organizacionId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const respondio = respondidaPara !== undefined
    && respondidaPara.organizacion === organizacionId
    && respondidaPara.cliente === clienteId
    && respondidaPara.empresa === empresaId
  return {
    filas: respondio ? filas : [],
    total: respondio ? total : 0,
    isLoading: !respondio,
    isFetching: cargando,
    isError: hayError,
    refetch: cargar,
  }
}
