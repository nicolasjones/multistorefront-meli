import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'

export const TAMANO_PAGINA_MOVIMIENTOS = 25

export type Movimiento = {
  id: string
  fecha: string
  creado_en: string
  producto_id: string
  producto_nombre: string | null
  producto_sku: string | null
  tipo: 'entrada' | 'salida' | 'ajuste'
  motivo: string | null
  nota: string | null
  cantidad: number
  diferencia: number
  saldo: number
  responsable: string | null
  total: number
}

type Entrada = { productoId: string; pagina: number }

// Historial de movimientos de stock (F-STK-03, FR-012): paginación y filtro en servidor
// contra `listar_movimientos_stock` (security invoker: la RLS decide qué se ve).
// Una respuesta vieja no pisa a una más nueva (filtro o página cambiados mientras carga).
export function useMovimientos({ productoId, pagina }: Entrada) {
  const [movimientos, setMovimientos] = useState<Movimiento[] | null>(null)
  const [total, setTotal] = useState(0)
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setHayError(false)
    try {
      const { data, error } = await supabaseClient.rpc('listar_movimientos_stock', {
        p_producto: productoId || null,
        p_limite: TAMANO_PAGINA_MOVIMIENTOS,
        p_desplazamiento: (pagina - 1) * TAMANO_PAGINA_MOVIMIENTOS,
      })
      if (error) throw error
      if (peticion !== ultimaPeticion.current) return
      const filas = (data ?? []) as unknown as Movimiento[]
      setMovimientos(filas)
      // Página vacía: el total no viaja en ninguna fila; 0 si es la primera, o se reinicia fuera.
      setTotal(filas.length > 0 ? Number(filas[0].total) : 0)
    } catch (error) {
      console.error('No pudimos cargar el historial de movimientos.', error)
      if (peticion === ultimaPeticion.current) setHayError(true)
    }
  }, [productoId, pagina])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return { movimientos, total, hayError, recargar: cargar }
}
