import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabaseClient } from './supabase'

const MENSAJE_GENERICO = 'No pudimos enviar tu solicitud. Intentá de nuevo.'

export type ResultadoSolicitudAcceso =
  | { ok: true; sinAdministradores: boolean }
  | { ok: false; mensaje: string }

// F-ROL-05 (FR-005…FR-008): invoca la Edge Function `solicitar-acceso`, que registra el pedido del día
// (RPC) y avisa por correo a los administradores. Devuelve el mensaje legible del servidor (nunca el
// texto crudo del SDK: ese va a consola). Repetir el mismo día devuelve el mismo `ok`.
export async function solicitarAcceso(seccion: string): Promise<ResultadoSolicitudAcceso> {
  const { data, error } = await supabaseClient.functions.invoke('solicitar-acceso', { body: { seccion } })
  if (!error) return { ok: true, sinAdministradores: (data as { resultado?: string } | null)?.resultado === 'sin_administradores' }
  if (error instanceof FunctionsHttpError) {
    const detalle = await error.context.json().catch(() => null)
    if (typeof detalle?.error === 'string') return { ok: false, mensaje: detalle.error }
  }
  console.error('No se pudo invocar solicitar-acceso', error)
  return { ok: false, mensaje: MENSAJE_GENERICO }
}
