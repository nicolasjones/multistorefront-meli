import { useCallback, useEffect, useRef, useState } from 'react'
import { listarVersiones, type VersionTienda } from '../lib/tiendaBorrador'

// Versiones publicadas de la tienda de la empresa activa (F-TDA-07, FR-071). La sección se monta de cero con cada
// empresa (key); además, una respuesta tardía de otra empresa nunca pisa la actual.
export function useVersionesTienda(empresaId: string) {
  const [versiones, setVersiones] = useState<VersionTienda[] | null>(null)
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    try {
      const resultado = await listarVersiones(empresaId)
      if (peticion !== ultimaPeticion.current) return
      setVersiones(resultado)
      setHayError(false)
    } catch (error) {
      if (peticion !== ultimaPeticion.current) return
      console.error('No se pudieron cargar las versiones de la tienda', error instanceof Error ? error.message : error)
      setVersiones(null)
      setHayError(true)
    }
    setCargando(false)
  }, [empresaId])

  useEffect(() => {
    void cargar()
    return () => { ultimaPeticion.current++ }
  }, [cargar])

  return { versiones, isLoading: cargando, isError: hayError, refetch: cargar }
}
