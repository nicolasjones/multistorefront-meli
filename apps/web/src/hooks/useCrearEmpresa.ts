import { useCallback, useState } from 'react'
import { supabaseClient } from '../lib/supabase'

export type ResultadoCrearEmpresa =
  | { ok: true }
  | { ok: false; tipo: 'nombre'; mensaje: string }
  | { ok: false; tipo: 'servidor'; mensaje: string }

export const MENSAJE_NOMBRE_VACIO = 'Ingresá el nombre de la empresa.'
export const MENSAJE_NOMBRE_REPETIDO = 'Ya existe una empresa con ese nombre.'
export const MENSAJE_NOMBRE_LARGO = 'El nombre no puede superar los 120 caracteres.'
const MENSAJE_SERVIDOR = 'No pudimos crear la empresa. Probá de nuevo.'

// Alta por la RPC `public.crear_empresa` (FR-001): la organización la resuelve
// el servidor, nunca el navegador. La unicidad del nombre la garantiza un
// índice único (23505), también ante altas simultáneas (FR-002). La validación
// de nombre vacío se hace antes de llamar, para no gastar un viaje.
export function useCrearEmpresa() {
  const [guardando, setGuardando] = useState(false)

  const crear = useCallback(async (nombre: string, copiarDe: string | null): Promise<ResultadoCrearEmpresa> => {
    const recortado = nombre.trim()
    if (!recortado) return { ok: false, tipo: 'nombre', mensaje: MENSAJE_NOMBRE_VACIO }

    setGuardando(true)
    try {
      const { error } = await supabaseClient.rpc('crear_empresa', { p_nombre: recortado, p_copiar_de: copiarDe })
      if (!error) return { ok: true }
      if (error.code === '23505') return { ok: false, tipo: 'nombre', mensaje: MENSAJE_NOMBRE_REPETIDO }
      if (error.code === '22023' && /nombre/i.test(error.message)) {
        return { ok: false, tipo: 'nombre', mensaje: recortado.length > 120 ? MENSAJE_NOMBRE_LARGO : MENSAJE_NOMBRE_VACIO }
      }
      return { ok: false, tipo: 'servidor', mensaje: MENSAJE_SERVIDOR }
    } catch {
      return { ok: false, tipo: 'servidor', mensaje: MENSAJE_SERVIDOR }
    } finally {
      setGuardando(false)
    }
  }, [])

  return { crear, guardando }
}
