import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'

// Punto de la evolución del costo: lo que devuelve `public.historial_costos_producto` (F-PRV-07).
export type PuntoCosto = {
  proveedor_id: string
  proveedor_razon_social: string
  ingreso_id: string
  fecha: string
  comprobante: string | null
  costo_unitario_usd: number
}

type FilaServidor = Omit<PuntoCosto, 'costo_unitario_usd'> & { costo_unitario_usd: number | string }

// Evolución del costo de un producto según los ingresos registrados con costo. Solo consulta
// con `activo`; la autorización la resuelve la función. «Última petición gana».
export function useHistorialCostos(productoId: string | undefined, proveedorId: string | null, activo: boolean) {
  const [puntos, setPuntos] = useState<PuntoCosto[]>([])
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    if (!productoId || !activo) return
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    setHayError(false)
    try {
      const { data, error } = await supabaseClient.rpc('historial_costos_producto', {
        p_producto_id: productoId, p_proveedor_id: proveedorId,
      })
      if (error) throw error
      if (peticion !== ultimaPeticion.current) return
      setPuntos(((data ?? []) as FilaServidor[]).map((fila) => ({ ...fila, costo_unitario_usd: Number(fila.costo_unitario_usd) })))
    } catch (error) {
      console.error('No pudimos cargar la evolución del costo.', error)
      if (peticion === ultimaPeticion.current) {
        setPuntos([])
        setHayError(true)
      }
    } finally {
      if (peticion === ultimaPeticion.current) setCargando(false)
    }
  }, [productoId, proveedorId, activo])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return { puntos, cargando, hayError, recargar: cargar }
}
