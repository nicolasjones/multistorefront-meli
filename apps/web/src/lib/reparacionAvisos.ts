import { supabaseClient } from './supabase'

// Aviso por correo al cliente por el estado de su reparación (F-SVC-14, MSF-424, FR-021, FR-023, FR-026). La autoridad
// es la base: `avisar_cliente_reparacion` valida permiso y tienda, no encola sin correo y es idempotente;
// `avisos_de_reparacion` devuelve el historial. Acá solo se llaman y se traducen los errores a castellano llano.

export type EstadoEnvioAviso = 'pendiente' | 'enviado' | 'fallido'

export type AvisoReparacion = {
  id: string
  estado_id: string
  estado_nombre: string
  destinatario: string
  estado_envio: EstadoEnvioAviso
  error: string | null
  solicitado_en: string
  enviado_en: string | null
  // Nombre visible de quien lo pidió; nunca su correo.
  solicitado_por_nombre: string | null
}

export type ResultadoAviso = { resultado: 'encolado' | 'sin_correo'; aviso_id: string | null }

export const MENSAJE_AVISO_ENCOLADO = 'Aviso enviado al cliente'
export const MENSAJE_CLIENTE_SIN_CORREO = 'El cliente no tiene correo'
export const MENSAJE_ERROR_CARGAR_AVISOS = 'No pudimos cargar los avisos al cliente.'
export const MENSAJE_ERROR_AVISAR = 'No pudimos avisar al cliente. El estado ya quedó cambiado: probá avisar de nuevo.'
export const MENSAJE_SIN_PERMISO_AVISAR = 'Tu rol no puede avisar a los clientes de las reparaciones.'
export const MENSAJE_AVISOS_SIN_CONEXION = 'El envío de avisos todavía no está habilitado para tu organización. Pedile a un administrador que lo active.'

type ErrorDeBase = { code?: string; message?: string; hint?: string } | null

// 42501 de PostgREST también trae `message` técnico: se traduce por código; solo se muestran tal cual los mensajes
// que levanta nuestra RPC con un prefijo conocido.
const PREFIJOS_MENSAJE_DE_LA_RPC = ['La reparación está anulada', 'La reparación no existe', 'El estado no existe'] as const

export function mensajeDeAvisar(error: unknown): string {
  const e = error as ErrorDeBase
  if (typeof e?.message === 'string' && PREFIJOS_MENSAJE_DE_LA_RPC.some((prefijo) => e.message?.startsWith(prefijo))) {
    return e.message
  }
  if (e?.code === '42501') return MENSAJE_SIN_PERMISO_AVISAR
  if (e?.code === 'P0001' && e.hint === 'sin_conexion') return MENSAJE_AVISOS_SIN_CONEXION
  if (e?.code === '55000') return 'La reparación está anulada: no se puede avisar al cliente.'
  return MENSAJE_ERROR_AVISAR
}

export function mensajeDeCargarAvisos(error: unknown): string {
  const e = error as ErrorDeBase
  if (e?.code === 'P0002') return 'Esa reparación no existe o no pertenece a tu organización.'
  if (e?.code === '42501') return 'Tu rol no puede ver los avisos de esta reparación.'
  return MENSAJE_ERROR_CARGAR_AVISOS
}

export async function avisarClienteDeReparacion(reparacionId: string, estadoId?: string): Promise<ResultadoAviso> {
  const { data, error } = await supabaseClient.rpc('avisar_cliente_reparacion', {
    p_reparacion: reparacionId,
    p_estado_id: estadoId ?? null,
  })
  if (error) throw error
  return data as ResultadoAviso
}

export async function listarAvisosDeReparacion(reparacionId: string): Promise<AvisoReparacion[]> {
  const { data, error } = await supabaseClient.rpc('avisos_de_reparacion', { p_reparacion: reparacionId })
  if (error) throw error
  return (data ?? []) as AvisoReparacion[]
}

// ¿El cliente tiene correo? `true`/`false` si la persona puede leer la ficha del cliente; `null` si no se puede saber
// (sin acceso a Clientes o error): en ese caso decide la base al pedir el aviso (`sin_correo`).
export async function clienteTieneCorreo(clienteId: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabaseClient.from('clientes').select('correo').eq('id', clienteId).maybeSingle()
    if (error || !data) return null
    const correo = (data as { correo: string | null }).correo
    return typeof correo === 'string' && correo.trim() !== ''
  } catch {
    return null
  }
}
