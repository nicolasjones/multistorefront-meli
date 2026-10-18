import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'

// Comprobante de la ficha: lo que devuelve `public.compras_de_cliente` (F-CLI-10).
export type CompraCliente = {
  numero: string
  fecha: string
  tipo: string
  estado: string
  total_sin_iva: number
}

type FilaServidor = {
  facturado_anio: number | string
  numero: string | null
  fecha: string | null
  tipo: string | null
  estado: string | null
  total_sin_iva: number | string | null
  total_filas: number | string
}

// Historial de compras del cliente. Un cliente sin comprobantes llega como una
// fila centinela (`numero` nulo) que lleva el total del año y la cantidad real de
// comprobantes (0 si no tiene; >0 si la página pedida quedó más allá del final). La
// autorización y el aislamiento por organización los resuelve la función en el
// servidor; acá solo se muestran errores. «Última petición gana».
export function useComprasCliente(clienteId: string | undefined, pagina: number, tamano: number) {
  const [compras, setCompras] = useState<CompraCliente[]>([])
  const [total, setTotal] = useState(0)
  const [facturadoAnio, setFacturadoAnio] = useState(0)
  const [hayError, setHayError] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [respondidaPara, setRespondidaPara] = useState<string | undefined>(undefined)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    if (!clienteId) return
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    let resultado: { data: FilaServidor[] | null; error: unknown }
    try {
      resultado = await supabaseClient.rpc('compras_de_cliente', {
        p_cliente_id: clienteId, p_pagina: pagina, p_tamano: tamano,
      })
    } catch (excepcion) {
      resultado = { data: null, error: excepcion }
    }
    if (peticion !== ultimaPeticion.current) return

    const { data, error } = resultado
    setHayError(Boolean(error))
    if (error) {
      setCompras([])
      setTotal(0)
      setFacturadoAnio(0)
    } else {
      const recibidas = data ?? []
      setCompras(recibidas.filter((f) => f.numero !== null).map((f) => ({
        numero: String(f.numero),
        fecha: String(f.fecha),
        tipo: String(f.tipo),
        estado: String(f.estado),
        total_sin_iva: Number(f.total_sin_iva),
      })))
      setTotal(recibidas.length > 0 ? Number(recibidas[0].total_filas) : 0)
      setFacturadoAnio(recibidas.length > 0 ? Number(recibidas[0].facturado_anio) : 0)
    }
    setCargando(false)
    setRespondidaPara(clienteId)
  }, [clienteId, pagina, tamano])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return {
    compras,
    total,
    facturadoAnio,
    isLoading: respondidaPara !== clienteId,
    isFetching: cargando,
    isError: hayError,
    refetch: cargar,
  }
}
