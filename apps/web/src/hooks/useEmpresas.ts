import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import { useOrganizacionActiva } from './useOrganizacionActiva'

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
  const [cargando, setCargando] = useState(false)
  const [respondio, setRespondio] = useState(false)
  const [hayError, setHayError] = useState(false)
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const ultimaPeticion = useRef(0)

  // «Última petición gana»: si cambia la organización activa (superadmin) y
  // hay dos cargas en vuelo, la respuesta vieja se descarta.
  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    const { data, error } = await supabaseClient
      .schema('dominio')
      .from('empresas')
      .select('id, nombre, activa')
      .order('nombre')
      .returns<Empresa[]>()

    if (peticion !== ultimaPeticion.current) return
    setHayError(Boolean(error))
    setEmpresas(error ? [] : data ?? [])
    setCargando(false)
    setRespondio(true)
    // organizacionId solo dispara la recarga; RLS resuelve la organización.
  }, [organizacionId])

  useEffect(() => {
    if (habilitado) void cargar()
  }, [habilitado, cargar])

  // Sin primera respuesta cuenta como cargando: evita el parpadeo del estado
  // vacío en el render previo a que corra el efecto de carga.
  return { empresas, isLoading: habilitado && (cargando || !respondio), isError: hayError, refetch: cargar }
}
