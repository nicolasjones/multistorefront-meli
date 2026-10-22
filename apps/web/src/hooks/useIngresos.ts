import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'

export const TAMANO_PAGINA_INGRESOS = 25

// Fila del historial: una por producto del ingreso (`listar_ingresos_mercaderia`).
export type IngresoFila = {
  ingreso_id: string
  fecha: string
  creado_en: string
  estado: 'registrado' | 'anulado'
  comprobante: string | null
  motivo_anulacion: string | null
  anulado_en: string | null
  producto_id: string
  producto_nombre: string
  producto_sku: string | null
  cantidad: number
  costo_unitario_usd: number | string
  destino: string
  empresa: string
  proveedor: string
  operador: string
  total: number | string
}

export type FiltrosIngresos = {
  desde?: string | null
  hasta?: string | null
  proveedorId?: string | null
  empresaId?: string | null
  productoId?: string | null
  operadorId?: string | null
  pagina: number
  tamano?: number
}

// Historial paginado en servidor (F-PRV-05). «Última petición gana»: una respuesta
// vieja no pisa a una más nueva cuando cambian filtros o página.
export function useIngresos({
  desde = null, hasta = null, proveedorId = null, empresaId = null,
  productoId = null, operadorId = null, pagina, tamano = TAMANO_PAGINA_INGRESOS,
}: FiltrosIngresos) {
  const [filas, setFilas] = useState<IngresoFila[] | null>(null)
  const [total, setTotal] = useState(0)
  const [hayError, setHayError] = useState(false)
  const [cargando, setCargando] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setHayError(false)
    setCargando(true)
    try {
      const { data, error } = await supabaseClient.rpc('listar_ingresos_mercaderia', {
        p_desde: desde || null,
        p_hasta: hasta || null,
        p_proveedor: proveedorId || null,
        p_empresa: empresaId || null,
        p_producto: productoId || null,
        p_operador: operadorId || null,
        p_pagina: pagina,
        p_tamano: tamano,
      })
      if (error) throw error
      if (peticion !== ultimaPeticion.current) return
      const resultado = (data ?? []) as unknown as IngresoFila[]
      setFilas(resultado)
      setTotal(resultado.length > 0 ? Number(resultado[0].total) : 0)
    } catch (error) {
      console.error('No pudimos cargar el historial de ingresos.', error)
      if (peticion === ultimaPeticion.current) setHayError(true)
    } finally {
      if (peticion === ultimaPeticion.current) setCargando(false)
    }
  }, [desde, hasta, proveedorId, empresaId, productoId, operadorId, pagina, tamano])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return { filas, total, hayError, cargando, recargar: cargar }
}
