import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'

// Correo para avisos de consultas (F-CON-03, FR-009/FR-010, épica MSF-122). La escritura va
// siempre por `public.guardar_correo_avisos_consultas`: la dirección de avisos no se toca con un
// update directo. La lectura de `dominio.consultas_configuracion` la filtra la RLS.
export const CORREO_AVISOS_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type FilaConfiguracion = { correo_avisos: string | null; updated_at: string | null }

export type ResultadoGuardarCorreoAvisos =
  | { ok: true; correoAvisos: string | null }
  | { ok: false; mensaje: string; conflicto: boolean }

type ErrorPostgrest = { message?: string; code?: string }

const ERROR_CONFLICTO = 'Otra persona modificó la dirección de avisos mientras la editabas. Recargá para ver los cambios y volvé a intentar.'
const ERROR_PERMISO = 'No tenés permiso para editar la dirección de avisos.'
const ERROR_FORMATO = 'Ingresá un correo con formato válido.'
const ERROR_POR_DEFECTO = 'No pudimos guardar la dirección de avisos. Intentá de nuevo.'

function codigoDeError(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const codigo = (error as ErrorPostgrest).code
    return typeof codigo === 'string' ? codigo : null
  }
  return null
}

export function mensajeDeErrorCorreoAvisos(error: unknown): string {
  const codigo = codigoDeError(error)
  if (codigo === '40001') return ERROR_CONFLICTO
  if (codigo === '42501') return ERROR_PERMISO
  if (codigo === '22023') return ERROR_FORMATO
  return ERROR_POR_DEFECTO
}

function mismoCorreo(uno: string, otro: string): boolean {
  return uno.toLowerCase() === otro.toLowerCase()
}

export function useCorreoAvisosConsultas(empresaId: string | undefined) {
  const [correoAvisos, setCorreoAvisos] = useState<string | null>(null)
  const [actualizadoEn, setActualizadoEn] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    if (!empresaId) {
      setCargando(false)
      return
    }
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    setHayError(false)
    try {
      const { data, error } = await supabaseClient
        .schema('dominio')
        .from('consultas_configuracion')
        .select('correo_avisos, updated_at')
        .eq('empresa_id', empresaId)
        .maybeSingle<FilaConfiguracion>()
      if (peticion !== ultimaPeticion.current) return
      if (error) throw error
      setCorreoAvisos(data?.correo_avisos ?? null)
      setActualizadoEn(data?.updated_at ?? null)
    } catch (error) {
      if (peticion !== ultimaPeticion.current) return
      console.error('No se pudo cargar la dirección de avisos de consultas', error instanceof Error ? error.message : error)
      setHayError(true)
    } finally {
      if (peticion === ultimaPeticion.current) setCargando(false)
    }
  }, [empresaId])

  useEffect(() => {
    // Al cambiar de empresa se descarta lo de la anterior: nunca se muestra su dirección.
    setCorreoAvisos(null)
    setActualizadoEn(null)
    void cargar()
  }, [cargar])

  const guardar = useCallback(
    async (texto: string, correoContacto: string | null): Promise<ResultadoGuardarCorreoAvisos> => {
      if (!empresaId) return { ok: false, mensaje: ERROR_POR_DEFECTO, conflicto: false }
      const valor = texto.trim()
      if (valor !== '' && !CORREO_AVISOS_VALIDO.test(valor)) {
        return { ok: false, mensaje: ERROR_FORMATO, conflicto: false }
      }
      const contacto = correoContacto?.trim() ?? ''
      // Vacío o igual al contacto: sin dirección propia, el aviso sigue al correo de contacto.
      const pCorreo = valor === '' || (contacto !== '' && mismoCorreo(valor, contacto)) ? null : valor

      try {
        const { data, error } = await supabaseClient.rpc('guardar_correo_avisos_consultas', {
          p_empresa_id: empresaId,
          p_correo: pCorreo,
          p_updated_at: actualizadoEn,
        })
        if (error) throw error
        setCorreoAvisos(pCorreo)
        setActualizadoEn(typeof data === 'string' ? data : null)
        setHayError(false)
        return { ok: true, correoAvisos: pCorreo }
      } catch (error) {
        const conflicto = codigoDeError(error) === '40001'
        // Con un conflicto, la próxima vez hace falta el sello vigente para poder guardar.
        if (conflicto) void cargar()
        return { ok: false, mensaje: mensajeDeErrorCorreoAvisos(error), conflicto }
      }
    },
    [empresaId, actualizadoEn, cargar],
  )

  return { correoAvisos, actualizadoEn, isLoading: cargando, isError: hayError, refetch: cargar, guardar }
}
