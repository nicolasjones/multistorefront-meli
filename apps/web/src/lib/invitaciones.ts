import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabaseClient } from './supabase'

export type Invitacion = {
  id: string
  email: string
  rol_id: string
  estado: 'pendiente' | 'aceptada' | 'cancelada'
  vence_en: string
}

type CuerpoInvitacion =
  | { accion: 'invitar'; email: string; rol: string }
  | { accion: 'cancelar'; invitacion_id: string }

const MENSAJE_GENERICO = 'No se pudo completar la operación. Intentá de nuevo.'

export type ResultadoInvitacion = { mensaje: string | null; resultado: string | null }

// Invoca la Edge Function y devuelve el mensaje legible del servidor (nunca el texto crudo del SDK: ese va a consola) o el
// `resultado` (`invitacion_enviada`, `invitacion_reenviada`, `miembro_agregado`, `invitacion_cancelada`).
export async function invocarInvitacion(cuerpo: CuerpoInvitacion): Promise<ResultadoInvitacion> {
  const { data, error } = await supabaseClient.functions.invoke('invitar-miembro', { body: cuerpo })
  if (!error) return { mensaje: null, resultado: (data as { resultado?: string } | null)?.resultado ?? null }
  if (error instanceof FunctionsHttpError) {
    const detalle = await error.context.json().catch(() => null)
    if (typeof detalle?.error === 'string') return { mensaje: detalle.error, resultado: null }
  }
  console.error('No se pudo invocar invitar-miembro', error)
  return { mensaje: MENSAJE_GENERICO, resultado: null }
}

// El enlace de Auth dura 1 h (`otp_expiry`, ver docs/invitar-usuarios.md); la invitación, 7 días.
export const VIGENCIA_INVITACION = 'La invitación vence en 7 días; el enlace del correo dura 1 hora y, si vence, se puede reenviar.'

export const estaVencida = (invitacion: Pick<Invitacion, 'vence_en'>) => new Date(invitacion.vence_en).getTime() <= Date.now()
