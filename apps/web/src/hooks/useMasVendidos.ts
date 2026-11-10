import { useCallback, useEffect, useRef, useState } from 'react'
import { listarMasVendidos, type FilaMasVendido, type FiltrosMasVendidos } from '../lib/masVendidos'
import { useOrganizacionActiva } from './useOrganizacionActiva'

// Ranking de productos más vendidos (F-STK-18, T043). Principio VIII: cada resultado queda atado a
// su ÁMBITO (organización + tienda + período). Si el ámbito cambia —se elige otra tienda, cambia la
// empresa activa de la barra superior o el período— lo anterior se descarta de inmediato: nunca se
// muestran filas ni totales de la empresa o del período anterior. Cambiar de página dentro del mismo
// ámbito conserva las filas mientras llega lo nuevo.
type Lectura = { ambito: string; filas: FilaMasVendido[]; total: number } | { ambito: string; error: true }

const SIN_FILAS: FilaMasVendido[] = []

export function useMasVendidos(filtros: FiltrosMasVendidos) {
  const { organizacionActiva } = useOrganizacionActiva()
  const { desde, hasta, empresaId, pagina, tamano } = filtros
  const ambito = `${organizacionActiva?.id ?? ''}|${empresaId ?? 'todas'}|${desde}|${hasta}`
  const [lectura, setLectura] = useState<Lectura | null>(null)
  const [cargando, setCargando] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    let resultado: Lectura
    try {
      resultado = { ambito, ...(await listarMasVendidos({ desde, hasta, empresaId, pagina, tamano })) }
    } catch (error) {
      console.error('No se pudo cargar el ranking de productos más vendidos', error instanceof Error ? error.message : error)
      resultado = { ambito, error: true }
    }
    // «Última petición gana»: una respuesta vieja no pisa a la nueva.
    if (peticion !== ultimaPeticion.current) return
    setLectura(resultado)
    setCargando(false)
  }, [ambito, desde, hasta, empresaId, pagina, tamano])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const vigente = lectura !== null && lectura.ambito === ambito
  const filas = vigente && 'filas' in lectura ? lectura.filas : SIN_FILAS
  const total = vigente && 'filas' in lectura ? lectura.total : 0

  return {
    ambito,
    filas,
    total,
    isLoading: !vigente,
    isFetching: cargando,
    isError: vigente && 'error' in lectura,
    refetch: cargar,
  }
}
