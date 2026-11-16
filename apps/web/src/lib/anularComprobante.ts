import { supabaseClient } from './supabase'

// Anulación de la factura (F-VTA-11, MSF-377, FR-040…FR-042). La autoridad es la base: `anular_comprobante` valida el
// permiso `anular` en la tienda del comprobante, exige el motivo, rechaza lo cobrado o con nota de crédito, revierte
// el stock todo o nada y es idempotente. Acá solo se llama y se traducen sus errores a castellano llano.

export const MOTIVO_ANULACION_MAXIMO = 300
export const ETIQUETA_ANULAR = 'Anular'
export const TITULO_ANULAR = 'Anular factura'
export const MENSAJE_MOTIVO_OBLIGATORIO = 'Escribí el motivo de la anulación.'
export const MENSAJE_MOTIVO_LARGO = `El motivo no puede superar los ${MOTIVO_ANULACION_MAXIMO} caracteres.`
export const MENSAJE_ERROR_ANULAR = 'No pudimos anular la factura. No se devolvió nada: probá de nuevo.'
export const MENSAJE_CONFLICTO_ANULAR =
  'Otra persona modificó este comprobante mientras lo mirabas. Recargamos los datos: revisalo y volvé a intentar.'

type ErrorDeBase = { code?: string; message?: string; hint?: string } | null

export const esConflictoDeAnulacion = (error: unknown): boolean => (error as ErrorDeBase)?.code === '40001'

// Valida el motivo antes de llamar: devuelve el mensaje a mostrar o null si está bien.
export function validarMotivoAnulacion(motivo: string): string | null {
  const limpio = motivo.trim()
  if (limpio === '') return MENSAJE_MOTIVO_OBLIGATORIO
  if (limpio.length > MOTIVO_ANULACION_MAXIMO) return MENSAJE_MOTIVO_LARGO
  return null
}

// Solo los mensajes que levanta nuestra RPC llegan en castellano y se muestran tal cual. Un 42501 de PostgREST
// («permission denied for function …») también trae `message`, así que se filtra por prefijo conocido para no
// exponer detalle técnico en inglés.
const PREFIJOS_MENSAJE_DE_LA_RPC = [
  'Necesitás una sesión con organización para anular',
  'Tu rol no puede anular',
  'Una nota de crédito no se anula',
  'Un presupuesto no se anula',
  'Escribí el motivo de la anulación',
  'El motivo de la anulación',
  'La factura está en borrador',
  'La factura ya está cobrada',
  'La factura ya tiene una nota de crédito',
  'El motivo «',
] as const

function esMensajeDeLaRpc(error: ErrorDeBase): error is { message: string } {
  const mensaje = error?.message
  return typeof mensaje === 'string' && PREFIJOS_MENSAJE_DE_LA_RPC.some((prefijo) => mensaje.startsWith(prefijo))
}

export function mensajeDeAnulacion(error: unknown): string {
  const e = error as ErrorDeBase
  console.error(MENSAJE_ERROR_ANULAR, error)
  if (e?.code === '40001') return MENSAJE_CONFLICTO_ANULAR
  if ((e?.code === '42501' || e?.code === '55000' || e?.code === '22023') && esMensajeDeLaRpc(e)) return e.message
  if (e?.code === 'P0002') return 'Ese comprobante no existe o no pertenece a tu organización.'
  return MENSAJE_ERROR_ANULAR
}

// Anula la factura. Reintentar sobre una ya anulada es seguro (idempotente): devuelve el estado actual.
export async function anularComprobante(
  id: string,
  motivo: string,
  actualizadoEn: string,
): Promise<{ estado: string; updated_at: string }> {
  const { data, error } = await supabaseClient.rpc('anular_comprobante', {
    p_id: id,
    p_motivo: motivo.trim(),
    p_actualizado_en: actualizadoEn,
  })
  if (error) throw error
  const fila = data as { estado?: string; updated_at?: string } | null
  if (!fila?.estado || !fila.updated_at) throw new Error('La base no devolvió el comprobante anulado')
  return { estado: fila.estado, updated_at: fila.updated_at }
}
