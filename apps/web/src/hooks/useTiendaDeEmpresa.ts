import { useCallback, useEffect, useRef, useState } from 'react'
import { leerTiendaDeEmpresa, type TiendaDeEmpresa } from '../lib/tienda'

// Tienda (dominio) de la empresa activa para la gestión (F-TDA-01, FR-008). RLS de
// `dominio.tiendas` limita la lectura a la organización de la sesión; cambiar de
// empresa (empresaId) rehace la consulta, así nunca queda el dominio de la anterior.
export function useTiendaDeEmpresa(empresaId: string | null) {
  const [tienda, setTienda] = useState<TiendaDeEmpresa | null>(null)
  const [cargando, setCargando] = useState(Boolean(empresaId))
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    if (!empresaId) {
      ultimaPeticion.current++
      setTienda(null)
      setCargando(false)
      setHayError(false)
      return
    }
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    try {
      const resultado = await leerTiendaDeEmpresa(empresaId)
      if (peticion !== ultimaPeticion.current) return
      setTienda(resultado)
      setHayError(false)
    } catch (error) {
      if (peticion !== ultimaPeticion.current) return
      console.error('No se pudo cargar la tienda de la empresa', error instanceof Error ? error.message : error)
      setTienda(null)
      setHayError(true)
    }
    setCargando(false)
  }, [empresaId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return { tienda, isLoading: cargando, isError: hayError, refetch: cargar }
}
