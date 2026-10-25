import { useCallback, useEffect, useRef, useState } from 'react'
import { listarFaltantes, type Faltante, type FiltrosFaltantes } from '../lib/faltantes'
import { useOrganizacionActiva } from './useOrganizacionActiva'

// Lista de faltantes. Dos reglas (Principio VIII):
//  * «Última petición gana»: una respuesta vieja no pisa a la nueva.
//  * Cada resultado queda atado a su ÁMBITO (organización + empresa): si cambia, lo que había se descarta
//    de inmediato y nunca se muestran filas ni totales de la empresa anterior. Cambiar de página dentro
//    del mismo ámbito conserva las filas mientras llega lo nuevo.
type Lectura = { ambito: string; filas: Faltante[]; total: number } | { ambito: string; error: true }

export function useFaltantes(filtros: FiltrosFaltantes, { habilitado = true }: { habilitado?: boolean } = {}) {
  const { organizacionActiva } = useOrganizacionActiva()
  const { empresaId, pagina, tamano } = filtros
  const ambito = `${organizacionActiva?.id ?? ''}|${empresaId ?? 'todas'}`
  const [lectura, setLectura] = useState<Lectura | null>(null)
  const [cargando, setCargando] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    let resultado: Lectura
    try {
      resultado = { ambito, ...(await listarFaltantes({ empresaId, pagina, tamano })) }
    } catch (error) {
      console.error('No se pudo cargar la lista de faltantes', error instanceof Error ? error.message : error)
      resultado = { ambito, error: true }
    }
    if (peticion !== ultimaPeticion.current) return
    setLectura(resultado)
    setCargando(false)
  }, [ambito, empresaId, pagina, tamano])

  useEffect(() => {
    if (habilitado) void cargar()
  }, [habilitado, cargar])

  const vigente = lectura !== null && lectura.ambito === ambito
  return {
    ambito,
    faltantes: vigente && 'filas' in lectura ? lectura.filas : [],
    total: vigente && 'filas' in lectura ? lectura.total : 0,
    isLoading: !habilitado || !vigente,
    isFetching: cargando,
    isError: vigente && 'error' in lectura,
    refetch: cargar,
  }
}
