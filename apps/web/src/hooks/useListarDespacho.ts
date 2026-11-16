import { useCallback, useEffect, useRef, useState } from 'react'
import { CONTEOS_VACIOS, listarDespacho, type ConteosDespacho, type FilaDespacho, type FiltrosDespacho } from '../lib/ventasDespachoLista'
import { useOrganizacionActiva } from './useOrganizacionActiva'

// Cada lectura queda atada a su ÁMBITO (organización + tienda): si el ámbito cambia, lo que había se descarta
// de inmediato y nunca se muestran filas, totales ni conteos de la empresa anterior (Principio VIII, FR-033).
// «Última petición gana»: una respuesta vieja no pisa a la nueva. Mientras llega la siguiente página o el
// siguiente filtro se conservan las filas anteriores (`isFetching`); `isLoading` es solo la primera carga o el
// cambio de ámbito.
type Lectura =
  | { ambito: string; filas: FilaDespacho[]; total: number; conteos: ConteosDespacho }
  | { ambito: string; error: true }

const SIN_FILAS: FilaDespacho[] = []

export function useListarDespacho({ busqueda, estado, empresaId, pagina, tamano }: FiltrosDespacho) {
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
      resultado = { ambito, ...(await listarDespacho({ busqueda, estado, empresaId, pagina, tamano })) }
    } catch (excepcion) {
      console.error('No pudimos listar el despacho.', excepcion)
      resultado = { ambito, error: true }
    }
    if (peticion !== ultimaPeticion.current) return
    setLectura(resultado)
    setCargando(false)
    // organizacionId solo dispara la recarga; la base resuelve la organización desde la sesión.
  }, [ambito, busqueda, estado, empresaId, pagina, tamano])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const vigente = lectura !== null && lectura.ambito === ambito
  const ok = vigente && 'filas' in lectura
  return {
    ambito,
    filas: ok ? lectura.filas : SIN_FILAS,
    total: ok ? lectura.total : 0,
    conteos: ok ? lectura.conteos : CONTEOS_VACIOS,
    isLoading: !vigente,
    isFetching: cargando,
    isError: vigente && 'error' in lectura,
    refetch: cargar,
  }
}
