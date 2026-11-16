import { useCallback, useEffect, useRef, useState } from 'react'
import { obtenerBorrador, type BorradorTienda } from '../lib/tiendaBorrador'

// Borrador, versión vigente y estado en línea de la tienda de la empresa activa (F-TDA-06, FR-053). La sección
// se monta de cero con cada empresa (key); además, una respuesta tardía de otra empresa nunca pisa la actual.
export function useBorradorTienda(empresaId: string) {
  const [borrador, setBorrador] = useState<BorradorTienda | null>(null)
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    try {
      const resultado = await obtenerBorrador(empresaId)
      if (peticion !== ultimaPeticion.current) return
      setBorrador(resultado)
      setHayError(false)
    } catch (error) {
      if (peticion !== ultimaPeticion.current) return
      console.error('No se pudo cargar el borrador de la tienda', error instanceof Error ? error.message : error)
      setBorrador(null)
      setHayError(true)
    }
    setCargando(false)
  }, [empresaId])

  useEffect(() => {
    void cargar()
    return () => { ultimaPeticion.current++ }
  }, [cargar])

  return { borrador, isLoading: cargando, isError: hayError, refetch: cargar }
}
