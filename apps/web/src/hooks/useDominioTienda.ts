import { useCallback, useEffect, useRef, useState } from 'react'
import { leerDominioTienda, type DominioTienda } from '../lib/tiendaDominio'

// Estado del dominio de la tienda de la empresa activa (F-TDA-05, FR-018). La sección se monta de cero con
// cada empresa (key); además, una respuesta tardía de otra empresa nunca pisa la actual.
export function useDominioTienda(empresaId: string) {
  const [dominio, setDominio] = useState<DominioTienda | null>(null)
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    try {
      const resultado = await leerDominioTienda(empresaId)
      if (peticion !== ultimaPeticion.current) return
      setDominio(resultado)
      setHayError(false)
    } catch (error) {
      if (peticion !== ultimaPeticion.current) return
      console.error('No se pudo cargar el dominio de la tienda', error instanceof Error ? error.message : error)
      setDominio(null)
      setHayError(true)
    }
    setCargando(false)
  }, [empresaId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return { dominio, isLoading: cargando, isError: hayError, refetch: cargar }
}
