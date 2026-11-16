import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import type { EstadoOrdenCompra, ItemParaRpc } from '../lib/ordenesCompra'

export const TAMANO_PAGINA_ORDENES = 25

// Fila del listado de órdenes (`listar_ordenes_compra`): una por orden.
export type OrdenFila = {
  orden_id: string
  fecha: string
  estado: EstadoOrdenCompra
  proveedor: string
  empresa: string
  unidades: number
  fecha_recepcion: string | null
  motivo_anulacion: string | null
  total: number | string
}

// Detalle de la orden (`detalle_orden_compra`).
export type LineaOrdenDetalle = {
  producto_id: string
  producto_nombre: string
  producto_sku: string | null
  cantidad: number
}

export type DetalleOrden = {
  id: string
  fecha: string
  estado: EstadoOrdenCompra
  observaciones: string | null
  fecha_recepcion: string | null
  motivo_anulacion: string | null
  empresa: string | null
  proveedor: string
  lineas: LineaOrdenDetalle[]
}

// Producto en alerta de reposición de un proveedor (`productos_en_reposicion_de_proveedor`).
export type ProductoEnReposicion = {
  producto_id: string
  nombre: string
  sku: string | null
  disponible: number
  minimo: number
  estado: 'sin_stock' | 'stock_bajo'
  cantidad_sugerida: number
}

export type FiltrosOrdenes = {
  estado?: EstadoOrdenCompra | null
  empresaId?: string | null
  pagina: number
  tamano?: number
}

// Listado paginado en servidor (F-PRV-09). «Última petición gana»: una respuesta vieja
// no pisa a una más nueva cuando cambian el filtro o la página.
export function useOrdenesCompra({
  estado = null, empresaId = null, pagina, tamano = TAMANO_PAGINA_ORDENES,
}: FiltrosOrdenes) {
  const [filas, setFilas] = useState<OrdenFila[] | null>(null)
  const [total, setTotal] = useState(0)
  const [hayError, setHayError] = useState(false)
  const [cargando, setCargando] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setHayError(false)
    setCargando(true)
    try {
      const { data, error } = await supabaseClient.rpc('listar_ordenes_compra', {
        p_estado: estado,
        p_empresa: empresaId || null,
        p_pagina: pagina,
        p_tamano: tamano,
      })
      if (error) throw error
      if (peticion !== ultimaPeticion.current) return
      const resultado = (data ?? []) as unknown as OrdenFila[]
      setFilas(resultado)
      setTotal(resultado.length > 0 ? Number(resultado[0].total) : 0)
    } catch (error) {
      console.error('No pudimos cargar las órdenes de compra.', error)
      if (peticion === ultimaPeticion.current) setHayError(true)
    } finally {
      if (peticion === ultimaPeticion.current) setCargando(false)
    }
  }, [estado, empresaId, pagina, tamano])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return { filas, total, hayError, cargando, recargar: cargar }
}

// Detalle de una orden. `null` cuando no hay ninguna abierta: no se consulta nada.
export function useDetalleOrdenCompra(ordenId: string | null) {
  const [detalle, setDetalle] = useState<DetalleOrden | null>(null)
  const [hayError, setHayError] = useState(false)
  const [cargando, setCargando] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    if (!ordenId) {
      setDetalle(null)
      return
    }
    const peticion = ++ultimaPeticion.current
    setHayError(false)
    setCargando(true)
    try {
      const { data, error } = await supabaseClient.rpc('detalle_orden_compra', { p_orden: ordenId })
      if (error) throw error
      if (peticion !== ultimaPeticion.current) return
      setDetalle((data ?? null) as DetalleOrden | null)
    } catch (error) {
      console.error('No pudimos cargar el detalle de la orden.', error)
      if (peticion === ultimaPeticion.current) setHayError(true)
    } finally {
      if (peticion === ultimaPeticion.current) setCargando(false)
    }
  }, [ordenId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return { detalle, hayError, cargando, recargar: cargar }
}

// Productos del proveedor que están en alerta de reposición: el insumo del alta.
export function useProductosEnReposicion(proveedorId: string) {
  const [productos, setProductos] = useState<ProductoEnReposicion[]>([])
  const [cargando, setCargando] = useState(false)
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    if (!proveedorId) {
      setProductos([])
      return
    }
    const peticion = ++ultimaPeticion.current
    setHayError(false)
    setCargando(true)
    try {
      const { data, error } = await supabaseClient.rpc('productos_en_reposicion_de_proveedor', {
        p_proveedor: proveedorId,
      })
      if (error) throw error
      if (peticion !== ultimaPeticion.current) return
      setProductos((data ?? []) as unknown as ProductoEnReposicion[])
    } catch (error) {
      console.error('No pudimos cargar los productos en reposición.', error)
      if (peticion === ultimaPeticion.current) {
        setProductos([])
        setHayError(true)
      }
    } finally {
      if (peticion === ultimaPeticion.current) setCargando(false)
    }
  }, [proveedorId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return { productos, cargando, hayError, recargar: cargar }
}

// Alta de la orden. La base valida empresa, proveedor, fecha, productos y permiso.
export function useCrearOrdenCompra() {
  const [enviando, setEnviando] = useState(false)

  const crear = useCallback(async (datos: {
    empresa_id: string
    proveedor_id: string
    fecha: string
    observaciones: string
    items: ItemParaRpc[]
  }) => {
    setEnviando(true)
    try {
      const { data, error } = await supabaseClient.rpc('crear_orden_compra', {
        p_empresa: datos.empresa_id,
        p_proveedor: datos.proveedor_id,
        p_fecha: datos.fecha,
        p_observaciones: datos.observaciones.trim() || null,
        p_items: datos.items,
      })
      if (error) return { ok: false as const, error }
      return { ok: true as const, id: String(data) }
    } catch (error) {
      return { ok: false as const, error }
    } finally {
      setEnviando(false)
    }
  }, [])

  return { crear, enviando }
}

// Recepción y anulación. La base valida el estado actual y el motivo.
export function useCambiarEstadoOrdenCompra() {
  const [enviando, setEnviando] = useState(false)

  const cambiar = useCallback(async (ordenId: string, estado: 'recibida' | 'anulada', motivo?: string) => {
    setEnviando(true)
    try {
      const { error } = await supabaseClient.rpc('cambiar_estado_orden_compra', {
        p_orden: ordenId,
        p_estado: estado,
        p_fecha_recepcion: null,
        p_motivo: motivo?.trim() || null,
      })
      if (error) return { ok: false as const, error }
      return { ok: true as const }
    } catch (error) {
      return { ok: false as const, error }
    } finally {
      setEnviando(false)
    }
  }, [])

  return { cambiar, enviando }
}
