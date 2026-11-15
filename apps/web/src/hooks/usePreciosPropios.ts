import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import {
  type PrecioPropio,
  fijarPrecioPropio,
  leerNetosProducto,
  leerPreciosPropios,
  quitarPrecioPropio,
} from '../lib/preciosPropios'
import type { Moneda } from '../lib/productos'

type Carga = { productoId: string; precios: PrecioPropio[]; netos: Map<string, number | null>; error: boolean }

// Precios propios de un producto, uno por empresa (F-PRE-08, FR-018). Los datos quedan atados al producto que
// los pidió: al cambiar de producto no se arrastran importes del anterior (SC-008) y una respuesta tardía de otro
// producto se descarta.
export function usePreciosPropios(productoId: string | null | undefined) {
  const [carga, setCarga] = useState<Carga | null>(null)
  const peticion = useRef(0)

  const cargar = useCallback(async () => {
    if (!productoId) return
    const numero = ++peticion.current
    let precios: PrecioPropio[] = []
    let error = false
    try {
      precios = await leerPreciosPropios(supabaseClient, productoId)
    } catch (excepcion) {
      console.error('No pudimos leer los precios propios.', excepcion)
      error = true
    }
    // El neto es solo un ejemplo: sin la sección Empresas no hay ejemplo, no es un error del bloque.
    const netos = await leerNetosProducto(supabaseClient, productoId).catch(() => new Map<string, number | null>())
    if (numero === peticion.current) setCarga({ productoId, precios, netos, error })
  }, [productoId])

  useEffect(() => {
    void cargar()
    return () => {
      peticion.current += 1
    }
  }, [cargar])

  const fijar = useCallback(
    async (empresaId: string, moneda: Moneda, importe: number) => {
      if (!productoId) return
      await fijarPrecioPropio(supabaseClient, productoId, empresaId, moneda, importe)
      await cargar()
    },
    [productoId, cargar],
  )

  const quitar = useCallback(
    async (empresaId: string) => {
      if (!productoId) return
      await quitarPrecioPropio(supabaseClient, productoId, empresaId)
      await cargar()
    },
    [productoId, cargar],
  )

  const lista = Boolean(productoId) && carga !== null && carga.productoId === productoId
  return {
    precios: lista ? carga.precios : [],
    netos: lista ? carga.netos : new Map<string, number | null>(),
    cargando: Boolean(productoId) && !lista,
    hayError: lista ? carga.error : false,
    fijar,
    quitar,
  }
}
