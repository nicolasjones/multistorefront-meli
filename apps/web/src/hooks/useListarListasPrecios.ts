import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import { leerListasPrecios, type EstadoListas, type ListaPrecios } from '../lib/listasPrecios'
import { useOrganizacionActiva } from './useOrganizacionActiva'

type Filtros = { estado: EstadoListas; pagina: number; tamano: number }

// Una tanda del listado de listas de precios (carga infinita sobre `useListadoAcumulado`). Estado y recorte viajan al
// servidor; «última petición gana». `isLoading` es solo la primera carga (o el cambio de organización); la empresa activa
// no interviene: las listas son de toda la organización.
export function useListarListasPrecios({ estado, pagina, tamano }: Filtros) {
  const [listas, setListas] = useState<ListaPrecios[]>([])
  const [total, setTotal] = useState(0)
  const [hayError, setHayError] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [respondidaPara, setRespondidaPara] = useState<string | null | undefined>(undefined)
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    try {
      const tanda = await leerListasPrecios(supabaseClient, { estado, pagina, tamano })
      if (peticion !== ultimaPeticion.current) return
      setHayError(false)
      setListas(tanda.listas)
      setTotal(tanda.total)
    } catch (error) {
      if (peticion !== ultimaPeticion.current) return
      console.error('No pudimos listar las listas de precios.', error)
      setHayError(true)
      setListas([])
      setTotal(0)
    }
    setCargando(false)
    setRespondidaPara(organizacionId)
    // organizacionId solo dispara la recarga; RLS resuelve la organización.
  }, [estado, pagina, tamano, organizacionId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const respondio = respondidaPara !== undefined && respondidaPara === organizacionId
  return { listas, total, isLoading: !respondio, isFetching: cargando, isError: hayError, refetch: cargar }
}
