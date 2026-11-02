import { useCallback, useEffect, useRef, useState } from 'react'
import { type CostoAdicional, listarCostosAdicionales } from '../lib/costosAdicionales'
import { supabaseClient } from '../lib/supabase'
import { useOrganizacionDeTrabajo } from './useOrganizacionDeTrabajo'

type Resultado = { clave: string; costos: CostoAdicional[]; hayError: boolean }

// Costos adicionales de la empresa elegida (o de todas las accesibles si `empresaId` es null), F-REN-08.
// Cada respuesta lleva la clave (organización + empresa) con la que se pidió: si la clave actual es otra,
// el hook devuelve «cargando» y lista vacía, así que jamás queda a la vista la lista de la empresa o la
// organización anterior, ni siquiera en el render previo a que corra la recarga (Principio VIII).
// «Última petición gana»; un error no se traga: queda en `hayError` con la lista vacía.
export function useCostosAdicionales(empresaId: string | null) {
  const { organizacionId } = useOrganizacionDeTrabajo()
  const clave = `${organizacionId ?? ''}|${empresaId ?? ''}`
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    try {
      const costos = await listarCostosAdicionales(supabaseClient, empresaId)
      if (peticion === ultimaPeticion.current) setResultado({ clave, costos, hayError: false })
    } catch (error) {
      console.error('No pudimos cargar los costos adicionales.', error)
      if (peticion === ultimaPeticion.current) setResultado({ clave, costos: [], hayError: true })
    }
  }, [clave, empresaId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const vigente = resultado?.clave === clave ? resultado : null
  return { costos: vigente?.costos ?? [], cargando: vigente === null, hayError: vigente?.hayError ?? false, recargar: cargar }
}
