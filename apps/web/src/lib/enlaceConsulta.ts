import { supabaseClient } from './supabase'

// Enlace de seguimiento para el cliente (F-SVC-22, FR-046). La base es la autoridad: la RPC
// `obtener_enlace_consulta` exige `edicion` y devuelve siempre el mismo token de la reparación.

type ErrorDeBase = { code?: string } | null | undefined

export function urlEnlaceSeguimiento(origen: string, token: string): string {
  return `${origen.replace(/\/+$/, '')}/seguimiento/${encodeURIComponent(token)}`
}

export function mensajeDeErrorEnlace(error: unknown, porDefecto: string): string {
  console.error(porDefecto, error)
  const e = error as ErrorDeBase
  if (e?.code === '42501') return 'No tenés permiso para generar el enlace: puede que tu rol no tenga edición en Service técnico o que no tengas acceso a la tienda. Recargá la página.'
  if (e?.code === 'P0002') return 'Esa reparación ya no existe o no tenés acceso a su tienda. Volvé al listado.'
  return porDefecto
}

export async function obtenerEnlaceConsulta(reparacionId: string): Promise<string> {
  const { data, error } = await supabaseClient.rpc('obtener_enlace_consulta', { p_reparacion: reparacionId })
  if (error) throw error
  const token = (data as { token?: unknown } | null)?.token
  if (typeof token !== 'string' || token === '') throw new Error('La respuesta no trae el token del enlace')
  return token
}
