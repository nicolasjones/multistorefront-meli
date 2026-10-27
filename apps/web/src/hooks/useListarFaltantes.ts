import { useCallback, useEffect, useRef, useState } from 'react'
import { listarFaltantes, type FaltanteVenta } from '../lib/ventasFaltantes'
import { useOrganizacionActiva } from './useOrganizacionActiva'

export type FiltrosFaltantes = {
  // Id de la tienda por la que filtrar; null = todas.
  empresaId: string | null
  pagina: number
  tamano: number
}

// Faltantes abiertos de las empresas accesibles (F-VTA-18, FR-043). La tienda y la paginación
// viajan al servidor (`listar_faltantes`, RLS del llamador): el navegador nunca descarga la lista
// completa. «Última petición gana»: una respuesta vieja no pisa a la nueva. Mientras llega la
// siguiente página se conservan las filas anteriores (`isFetching`); `isLoading` es solo la primera
// carga (o el cambio de organización), para no parpadear.
export function useListarFaltantes({ empresaId, pagina, tamano }: FiltrosFaltantes) {
  const [faltantes, setFaltantes] = useState<FaltanteVenta[]>([])
  const [total, setTotal] = useState(0)
  const [hayError, setHayError] = useState(false)
  const [cargando, setCargando] = useState(true)
  // Organización para la que llegó la última respuesta (undefined = ninguna).
  const [respondidaPara, setRespondidaPara] = useState<string | null | undefined>(undefined)
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    let resultado: { faltantes: FaltanteVenta[]; total: number } | null = null
    let error: unknown = null
    try {
      resultado = await listarFaltantes({ empresaId, pagina, tamano })
    } catch (excepcion) {
      error = excepcion
    }
    if (peticion !== ultimaPeticion.current) return

    if (error) {
      console.error('No pudimos listar los faltantes.', error)
      setFaltantes([])
      setTotal(0)
      setHayError(true)
    } else {
      setFaltantes(resultado?.faltantes ?? [])
      setTotal(resultado?.total ?? 0)
      setHayError(false)
    }
    setCargando(false)
    setRespondidaPara(organizacionId)
    // organizacionId solo dispara la recarga; RLS resuelve la organización.
  }, [empresaId, pagina, tamano, organizacionId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const respondio = respondidaPara !== undefined && respondidaPara === organizacionId
  return {
    faltantes,
    total,
    isLoading: !respondio,
    isFetching: cargando,
    isError: hayError,
    refetch: cargar,
  }
}
