import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'

export const TAMANO_PAGINA_ARCHIVO_INGRESOS = 25

// Fila del archivo anterior al sistema (F-MIG-03): producto, proveedor y operador son texto.
export type ArchivoIngresoFila = {
  id: string
  fecha: string
  producto: string
  cantidad: number
  proveedor: string | null
  operador: string | null
}

// Archivo de ingresos paginado en servidor (FR-033). Es de la organización, no de una
// empresa (FR-034): no depende de la empresa activa, así que cambiarla no recarga ni mezcla.
// «Última petición gana»: una respuesta vieja no pisa a una más nueva.
export function useArchivoIngresos(pagina: number, tamano = TAMANO_PAGINA_ARCHIVO_INGRESOS) {
  const [filas, setFilas] = useState<ArchivoIngresoFila[] | null>(null)
  const [total, setTotal] = useState(0)
  const [hayError, setHayError] = useState(false)
  const [cargando, setCargando] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setHayError(false)
    setCargando(true)
    try {
      const desde = (pagina - 1) * tamano
      const { data, error, count } = await supabaseClient
        .schema('dominio')
        .from('archivo_ingresos_mercaderia')
        .select('id, fecha, producto, cantidad, proveedor, operador', { count: 'exact' })
        .order('fecha', { ascending: false })
        .order('id', { ascending: true })
        .range(desde, desde + tamano - 1)
        .returns<ArchivoIngresoFila[]>()
      if (error) throw error
      if (peticion !== ultimaPeticion.current) return
      setFilas(data ?? [])
      setTotal(count ?? 0)
    } catch (error) {
      console.error('No pudimos cargar el archivo de ingresos.', error)
      if (peticion === ultimaPeticion.current) setHayError(true)
    } finally {
      if (peticion === ultimaPeticion.current) setCargando(false)
    }
  }, [pagina, tamano])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return { filas, total, hayError, cargando, recargar: cargar }
}
