import { useCallback, useEffect, useState } from 'react'
import { supabaseClient } from '../lib/supabase'

export type Empresa = {
  id: string
  nombre: string
  activa: boolean
}

// `dominio.empresas` no está en el esquema por defecto del cliente (public),
// así que se consulta con `.schema('dominio')` por consulta; RLS por
// organización (private.organizacion_id()) filtra del lado del servidor.
// No asume cuántas empresas hay: devuelve 1..N (FR-003).
export function useEmpresas({ habilitado = true }: { habilitado?: boolean } = {}) {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [cargando, setCargando] = useState(habilitado)
  const [hayError, setHayError] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data, error } = await supabaseClient
      .schema('dominio')
      .from('empresas')
      .select('id, nombre, activa')
      .order('nombre')
      .returns<Empresa[]>()

    setHayError(Boolean(error))
    setEmpresas(error ? [] : data ?? [])
    setCargando(false)
  }, [])

  useEffect(() => {
    if (habilitado) void cargar()
  }, [habilitado, cargar])

  return { empresas, isLoading: habilitado && cargando, isError: hayError, refetch: cargar }
}
