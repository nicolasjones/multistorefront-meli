import { useCallback, useEffect, useRef, useState } from 'react'
import { listarRespuestasRapidas, type RespuestaRapida } from '../lib/respuestasRapidas'
import { useOrganizacionActiva } from './useOrganizacionActiva'

type Lectura = { ambito: string; datos: RespuestaRapida[] } | { ambito: string; error: true }

// Respuestas rápidas de una empresa. «Última petición gana» y cada resultado queda atado a su ÁMBITO
// (organización + empresa): al cambiar de empresa lo anterior se descarta de inmediato y nunca se
// muestran textos de la empresa anterior (Principio VIII).
export function useRespuestasRapidas(empresaId: string | null) {
  const { organizacionActiva } = useOrganizacionActiva()
  const ambito = `${organizacionActiva?.id ?? ''}|${empresaId ?? ''}`
  const [lectura, setLectura] = useState<Lectura | null>(null)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    if (!empresaId) return
    const peticion = ++ultimaPeticion.current
    let resultado: Lectura
    try {
      resultado = { ambito, datos: await listarRespuestasRapidas(empresaId) }
    } catch (error) {
      console.error('No se pudieron cargar las respuestas rápidas', error instanceof Error ? error.message : error)
      resultado = { ambito, error: true }
    }
    if (peticion === ultimaPeticion.current) setLectura(resultado)
  }, [empresaId, ambito])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const vigente = empresaId !== null && lectura !== null && lectura.ambito === ambito
  return {
    respuestas: vigente && 'datos' in lectura ? lectura.datos : [],
    isLoading: empresaId !== null && !vigente,
    isError: vigente && 'error' in lectura,
    refetch: cargar,
  }
}
