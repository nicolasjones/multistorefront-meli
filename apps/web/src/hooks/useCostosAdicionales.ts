import { useCallback, useEffect, useRef, useState } from 'react'
import { type CostoAdicional, listarCostosAdicionales } from '../lib/costosAdicionales'
import { supabaseClient } from '../lib/supabase'
import { useOrganizacionDeTrabajo } from './useOrganizacionDeTrabajo'

// Costos adicionales de la empresa elegida (o de todas las accesibles si `empresaId` es null), F-REN-08.
// Se recarga al cambiar la empresa o la organización de trabajo y nunca muestra la lista anterior
// mientras llega la nueva (Principio VIII). «Última petición gana»; un error no se traga: queda en
// `hayError` con la lista vacía.
export function useCostosAdicionales(empresaId: string | null, habilitado = true) {
  const { organizacionId } = useOrganizacionDeTrabajo()
  const [costos, setCostos] = useState<CostoAdicional[]>([])
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    try {
      const lista = await listarCostosAdicionales(supabaseClient, empresaId)
      if (peticion !== ultimaPeticion.current) return
      setCostos(lista)
      setHayError(false)
    } catch (error) {
      console.error('No pudimos cargar los costos adicionales.', error)
      if (peticion !== ultimaPeticion.current) return
      setCostos([])
      setHayError(true)
    }
    setCargando(false)
    // organizacionId solo dispara la recarga; la organización la resuelve la base.
  }, [empresaId, organizacionId])

  useEffect(() => {
    if (!habilitado) return
    // Vacía antes de cargar: jamás queda a la vista la lista de la empresa anterior.
    setCostos([])
    void cargar()
  }, [cargar, habilitado])

  return { costos, cargando, hayError, recargar: cargar }
}
