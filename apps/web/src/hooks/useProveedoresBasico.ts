import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'

// Fila de `public.proveedores_basico` (F-PRV-03): solo id, razón social y estado.
// La vista filtra por organización y nivel; no entrega CUIT ni datos de contacto.
export type ProveedorBasico = { id: string; razon_social: string; activo: boolean }

// Proveedores para el selector de producto. «Última petición gana»; un error no se
// traga: queda en `hayError` para que el formulario avise y permita reintentar.
export function useProveedoresBasico() {
  const [proveedores, setProveedores] = useState<ProveedorBasico[]>([])
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    setHayError(false)
    try {
      const { data, error } = await supabaseClient
        .from('proveedores_basico')
        .select('id, razon_social, activo')
        .order('razon_social', { ascending: true })
        .returns<ProveedorBasico[]>()
      if (error) throw error
      if (peticion === ultimaPeticion.current) setProveedores(data ?? [])
    } catch (error) {
      console.error('No pudimos cargar los proveedores.', error)
      if (peticion === ultimaPeticion.current) {
        setProveedores([])
        setHayError(true)
      }
    } finally {
      if (peticion === ultimaPeticion.current) setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return { proveedores, cargando, hayError, recargar: cargar }
}
