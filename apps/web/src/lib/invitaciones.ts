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

// Invoca la Edge Function y devuelve el mensaje legible del servidor, no el genérico del SDK.
export async function invocarInvitacion(cuerpo: CuerpoInvitacion): Promise<string | null> {
  const { error } = await supabaseClient.functions.invoke('invitar-miembro', { body: cuerpo })
  if (!error) return null
  if (error instanceof FunctionsHttpError) {
    return (await error.context.json().catch(() => null))?.error ?? error.message
  }
  return error.message
}

export const estaVencida = (invitacion: Pick<Invitacion, 'vence_en'>) => new Date(invitacion.vence_en).getTime() <= Date.now()
