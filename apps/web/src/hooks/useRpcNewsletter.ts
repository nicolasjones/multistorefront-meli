import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import { useOrganizacionActiva } from './useOrganizacionActiva'

// Lectura de una RPC del panel de Newsletter (MSF-468). «Última petición gana»; `isLoading` vuelve a ser verdadero al cambiar la
// organización o los parámetros (la empresa incluida): nunca se muestran filas ni totales de la selección anterior (Principio VIII).
export function useRpcNewsletter<T>(nombre: string, parametros: Record<string, unknown>, habilitado = true) {
  const [datos, setDatos] = useState<T | null>(null)
  const [hayError, setHayError] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [respondidaPara, setRespondidaPara] = useState<string | undefined>(undefined)
  const { organizacionActiva } = useOrganizacionActiva()
  const clave = JSON.stringify(parametros)
  const contexto = `${organizacionActiva?.id ?? ''}|${nombre}|${clave}`
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    if (!habilitado) return
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    let respuesta: { data: T | null; error: unknown }
    try {
      respuesta = await supabaseClient.rpc(nombre, JSON.parse(clave) as Record<string, unknown>) as { data: T | null; error: unknown }
    } catch (excepcion) {
      respuesta = { data: null, error: excepcion }
    }
    if (peticion !== ultimaPeticion.current) return
    const error = Boolean(respuesta.error) || !respuesta.data
    setHayError(error)
    setDatos(error ? null : respuesta.data)
    setCargando(false)
    setRespondidaPara(contexto)
  }, [nombre, clave, contexto, habilitado])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return { datos, isLoading: habilitado && respondidaPara !== contexto, isFetching: cargando, isError: hayError, refetch: cargar }
}

// Llamada de escritura: devuelve `{ data, error }` sin lanzar (la pantalla traduce el error a un mensaje).
export async function llamarRpcNewsletter<T>(nombre: string, parametros: Record<string, unknown>): Promise<{ data: T | null; error: { message?: string; code?: string; hint?: string } | null }> {
  try {
    const { data, error } = await supabaseClient.rpc(nombre, parametros)
    return { data: (data as T | null) ?? null, error: error ?? null }
  } catch (excepcion) {
    return { data: null, error: { message: excepcion instanceof Error ? excepcion.message : 'error' } }
  }
}
