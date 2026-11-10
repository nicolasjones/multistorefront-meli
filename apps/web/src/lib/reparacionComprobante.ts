import { supabaseClient } from './supabase'

// Cobro de la reparación mediante un comprobante de Ventas (F-SVC-13, MSF-418, FR-001, FR-004, FR-009). La autoridad es
// la base: `generar_comprobante_reparacion` valida permisos en Service y en Ventas, es idempotente y rechaza lo que
// no corresponde; `comprobante_de_reparacion` devuelve el comprobante vigente. Acá solo se llaman y se traducen los
// errores a castellano llano.

export type ComprobanteDeReparacion = {
  id: string
  numero: string
  tipo: string
  estado: string
  total: number
  empresa_id: string
  // Tienda del comprobante (la de la reparación): se muestra en la tarjeta.
  empresa: string
}

// Lo que devuelve `generar_comprobante_reparacion`: el comprobante (nuevo o el vigente) y si lo creó ahora.
export type ResultadoGenerar = { comprobante_id: string; creado: boolean }

export const MENSAJE_ERROR_CARGAR_COMPROBANTE = 'No pudimos cargar el comprobante asociado.'
export const MENSAJE_ERROR_GENERAR = 'No pudimos generar el comprobante. No se creó nada: probá de nuevo.'
export const MENSAJE_SIN_PERMISO_GENERAR = 'Tu rol no puede generar el comprobante de esta reparación.'
export const MENSAJE_REPARACION_ANULADA = 'La reparación está anulada: no se puede generar su comprobante.'
export const MENSAJE_REPARACION_INEXISTENTE = 'Esa reparación no existe o no pertenece a tu organización.'
export const MENSAJE_COMPROBANTE_YA_EXISTE = 'La reparación ya tenía un comprobante: lo mostramos acá.'

type ErrorDeBase = { code?: string; message?: string } | null

// Solo los mensajes que levanta nuestra RPC llegan en castellano y se muestran tal cual; un 42501 de PostgREST
// («permission denied for function …») también trae `message`, así que se filtra por prefijo conocido.
const PREFIJOS_MENSAJE_DE_LA_RPC = [
  'La reparación no tiene ítems',
  'La reparación está anulada',
  'La tienda de la reparación está desactivada',
  'El cliente de la reparación está archivado',
  'La reparación no existe',
] as const

function esMensajeDeLaRpc(error: ErrorDeBase): boolean {
  const mensaje = error?.message
  return typeof mensaje === 'string' && PREFIJOS_MENSAJE_DE_LA_RPC.some((prefijo) => mensaje.startsWith(prefijo))
}

// 22023 (no corresponde), 55000 (anulada) y 42501 (sin permiso) se traducen a un mensaje claro; el resto no muestra
// el texto técnico de la base.
export function mensajeDeGenerarComprobante(error: unknown): string {
  const e = error as ErrorDeBase
  if (esMensajeDeLaRpc(e)) return e?.message as string
  if (e?.code === '42501') return MENSAJE_SIN_PERMISO_GENERAR
  if (e?.code === '55000') return MENSAJE_REPARACION_ANULADA
  if (e?.code === 'P0002') return MENSAJE_REPARACION_INEXISTENTE
  return MENSAJE_ERROR_GENERAR
}

export function mensajeDeCargarComprobante(error: unknown): string {
  const e = error as ErrorDeBase
  if (e?.code === 'P0002') return MENSAJE_REPARACION_INEXISTENTE
  if (e?.code === '42501') return 'Tu rol no puede ver el comprobante de esta reparación.'
  return MENSAJE_ERROR_CARGAR_COMPROBANTE
}

export async function obtenerComprobanteDeReparacion(reparacionId: string): Promise<ComprobanteDeReparacion | null> {
  const { data, error } = await supabaseClient.rpc('comprobante_de_reparacion', { p_reparacion: reparacionId })
  if (error) throw error
  if (data === null || data === undefined) return null
  const fila = data as ComprobanteDeReparacion
  return { ...fila, total: Number(fila.total) }
}

export async function generarComprobanteDeReparacion(reparacionId: string): Promise<ResultadoGenerar> {
  const { data, error } = await supabaseClient.rpc('generar_comprobante_reparacion', { p_reparacion: reparacionId })
  if (error) throw error
  return data as ResultadoGenerar
}
