import { useCallback, useEffect, useRef, useState } from 'react'
import { type Alicuota, leerAlicuotas } from '../lib/iva'
import { supabaseClient } from '../lib/supabase'
import { useOrganizacionActiva } from './useOrganizacionActiva'

// Alícuotas de IVA activas de la organización (F-PRE-12, FR-015). RLS resuelve la organización.
// «Última petición gana» si cambia la organización activa mientras hay una carga en vuelo, y
// el resultado queda atado a la organización con que se pidió (nunca se ofrecen alícuotas de otra).
export function useAlicuotas({ habilitado = true }: { habilitado?: boolean } = {}) {
  const [leidas, setLeidas] = useState<{ organizacionId: string | null; alicuotas: Alicuota[]; error: boolean } | null>(null)
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    try {
      const alicuotas = await leerAlicuotas(supabaseClient)
      if (peticion === ultimaPeticion.current) setLeidas({ organizacionId, alicuotas, error: false })
    } catch (error) {
      console.error('No pudimos cargar las alícuotas de IVA.', error)
      if (peticion === ultimaPeticion.current) setLeidas({ organizacionId, alicuotas: [], error: true })
    }
  }, [organizacionId])

  useEffect(() => {
    if (habilitado) void cargar()
  }, [habilitado, cargar])

  const vigente = leidas !== null && leidas.organizacionId === organizacionId
  const alicuotas = vigente ? leidas.alicuotas : []
  return {
    alicuotas,
    porId: new Map(alicuotas.map((alicuota) => [alicuota.id, alicuota])),
    isLoading: habilitado && !vigente,
    isError: vigente && leidas.error,
    refetch: cargar,
  }
}
