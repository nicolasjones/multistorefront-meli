import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'

// Producto de la ficha del proveedor: lo que devuelve `public.productos_de_proveedor` (F-PRV-03).
export type ProductoDeProveedor = {
  id: string
  nombre: string
  codigo_proveedor: string | null
  activo: boolean
}

type FilaServidor = ProductoDeProveedor & { total_filas: number | string }

// Productos asignados a un proveedor, paginados en el servidor. El error queda aislado
// (la ficha sigue usable). La autorización la resuelve la función. «Última petición gana».
export function useProductosDeProveedor(proveedorId: string | undefined, pagina: number, tamano: number) {
  const [productos, setProductos] = useState<ProductoDeProveedor[]>([])
  const [total, setTotal] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    if (!proveedorId) return
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    setHayError(false)
    try {
      const { data, error } = await supabaseClient.rpc('productos_de_proveedor', {
        p_proveedor_id: proveedorId, p_pagina: pagina, p_tamano: tamano,
      })
      if (error) throw error
      if (peticion !== ultimaPeticion.current) return
      const filas = (data ?? []) as FilaServidor[]
      setProductos(filas.map(({ id, nombre, codigo_proveedor, activo }) => ({ id, nombre, codigo_proveedor, activo })))
      setTotal(filas.length > 0 ? Number(filas[0].total_filas) : 0)
    } catch (error) {
      console.error('No pudimos cargar los productos del proveedor.', error)
      if (peticion === ultimaPeticion.current) {
        setProductos([])
        setTotal(0)
        setHayError(true)
      }
    } finally {
      if (peticion === ultimaPeticion.current) setCargando(false)
    }
  }, [proveedorId, pagina, tamano])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return { productos, total, cargando, hayError, recargar: cargar }
}
