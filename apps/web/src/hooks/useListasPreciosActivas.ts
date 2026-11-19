import { useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import { leerListaPorId, leerListasActivas, type ListaPrecios } from '../lib/listasPrecios'
import { useOrganizacionActiva } from './useOrganizacionActiva'

// Listas activas de la organización para el selector «Lista de precios» de la ficha del cliente. Si el cliente ya tiene una
// lista archivada (puede ocurrir si se archivó después de asignarla por otra vía) se la suma para mostrarla en el selector.
export function useListasPreciosActivas(listaActualId: string | null = null) {
  const [listas, setListas] = useState<ListaPrecios[]>([])
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const ultimaPeticion = useRef(0)

  useEffect(() => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    setHayError(false)
    ;(async () => {
      const activas = await leerListasActivas(supabaseClient)
      if (listaActualId && !activas.some((lista) => lista.id === listaActualId)) {
        const actual = await leerListaPorId(supabaseClient, listaActualId)
        if (actual) activas.push(actual)
      }
      return activas
    })()
      .then((resultado) => {
        if (peticion === ultimaPeticion.current) setListas(resultado)
      })
      .catch((error: unknown) => {
        console.error('No pudimos cargar las listas de precios.', error)
        if (peticion === ultimaPeticion.current) setHayError(true)
      })
      .finally(() => {
        if (peticion === ultimaPeticion.current) setCargando(false)
      })
  }, [organizacionId, listaActualId])

  return { listas, cargando, hayError }
}
