import { useCallback, useEffect, useRef, useState } from 'react'
import { listarFaltantes, type FaltanteVenta } from '../lib/ventasFaltantes'
import { useOrganizacionActiva } from './useOrganizacionActiva'

export type FiltrosFaltantes = {
  // Id de la tienda por la que filtrar; null = todas.
  empresaId: string | null
  pagina: number
  tamano: number
}

// Cada lectura queda atada a su ÁMBITO (organización + tienda): si el ámbito cambia, lo que había se
// descarta de inmediato y nunca se muestran filas ni totales de la empresa anterior (Principio VIII,
// FR-046). «Última petición gana»: una respuesta vieja no pisa a la nueva. Mientras llega la siguiente
// página se conservan las filas anteriores (`isFetching`); `isLoading` es solo la primera carga o el
// cambio de ámbito, para no parpadear.
type Lectura = { ambito: string; faltantes: FaltanteVenta[]; total: number } | { ambito: string; error: true }

const SIN_FILAS: FaltanteVenta[] = []

export function useListarFaltantes({ empresaId, pagina, tamano }: FiltrosFaltantes) {
  const [lectura, setLectura] = useState<Lectura | null>(null)
  const [cargando, setCargando] = useState(true)
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const ambito = `${organizacionId ?? ''}|${empresaId ?? 'todas'}`
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    let resultado: Lectura
    try {
      resultado = { ambito, ...(await listarFaltantes({ empresaId, pagina, tamano })) }
    } catch (excepcion) {
      console.error('No pudimos listar los faltantes.', excepcion)
      resultado = { ambito, error: true }
    }
    if (peticion !== ultimaPeticion.current) return
    setLectura(resultado)
    setCargando(false)
    // organizacionId solo dispara la recarga; RLS resuelve la organización.
  }, [ambito, empresaId, pagina, tamano])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Solo vale lo que llegó para el ámbito vigente: al cambiar de tienda (barra superior o filtro) no
  // se dibuja ni una fila de la empresa anterior.
  const vigente = lectura !== null && lectura.ambito === ambito
  return {
    ambito,
    faltantes: vigente && 'faltantes' in lectura ? lectura.faltantes : SIN_FILAS,
    total: vigente && 'faltantes' in lectura ? lectura.total : 0,
    isLoading: !vigente,
    isFetching: cargando,
    isError: vigente && 'error' in lectura,
    refetch: cargar,
  }
}
