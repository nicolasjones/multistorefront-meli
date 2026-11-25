import { supabaseClient } from './supabase'
import { esCodigoDeConflicto, esCodigoDeEstado } from './mensajeErrorBase'

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

export const esConflictoDeAnulacion = (error: unknown): boolean => esCodigoDeConflicto((error as ErrorDeBase)?.code)

// Valida el motivo antes de llamar: devuelve el mensaje a mostrar o null si está bien.
export function validarMotivoAnulacion(motivo: string): string | null {
  const limpio = motivo.trim()
  if (limpio === '') return MENSAJE_MOTIVO_OBLIGATORIO
  if (limpio.length > MOTIVO_ANULACION_MAXIMO) return MENSAJE_MOTIVO_LARGO
  return null
}

// Solo los mensajes que levanta nuestra RPC `anular_comprobante` (migraciones 20261212120200 y 20270507180000) se traducen, y
// SIEMPRE con un texto fijo de este catálogo (como `mensajeDeAceptarPresupuesto`): se compara el prefijo del mensaje del servidor
// y se devuelve la constante, nunca `e.message`. Un 42501 de PostgREST («permission denied for function …») también trae `message`
// en inglés: no coincide con ningún prefijo y cae al genérico.
const MENSAJES_DE_LA_RPC: ReadonlyArray<readonly [prefijo: string, texto: string]> = [
  ['Necesitás una sesión con organización para anular', 'Necesitás una sesión con organización para anular comprobantes'],
  ['Tu rol no puede anular', 'Tu rol no puede anular comprobantes de esta tienda'],
  ['Una nota de crédito no se anula', 'Una nota de crédito no se anula'],
  ['Un presupuesto no se anula', 'Un presupuesto no se anula: solo las facturas confirmadas'],
  ['Escribí el motivo de la anulación', MENSAJE_MOTIVO_OBLIGATORIO],
  ['El motivo de la anulación', MENSAJE_MOTIVO_LARGO],
  ['La factura está en borrador', 'La factura está en borrador: no movió stock, no hace falta anularla'],
  ['La factura ya está cobrada', 'La factura ya está cobrada: corregila con una nota de crédito'],
  // Guardas de 20270507180000 (#1136): factura con despacho entregado y factura con cobros registrados.
  ['La factura ya fue entregada', 'La factura ya fue entregada: corregí con nota de crédito o RMA'],
  ['La factura tiene cobros registrados', 'La factura tiene cobros registrados: revertí el cobro o corregila con una nota de crédito'],
  ['La factura ya tiene una nota de crédito', 'La factura ya tiene una nota de crédito: corregila con otra nota de crédito'],
  // El texto de la RPC nombra el motivo de stock (variable): se muestra uno fijo.
  ['El motivo «', 'El motivo de movimiento de stock de la venta está inactivo o no aplica: activalo o corregilo en Motivos de movimiento'],
]

function textoDeLaRpc(error: ErrorDeBase): string | undefined {
  const mensaje = error?.message
  if (typeof mensaje !== 'string') return undefined
  return MENSAJES_DE_LA_RPC.find(([prefijo]) => mensaje.startsWith(prefijo))?.[1]
}

export function mensajeDeAnulacion(error: unknown): string {
  const e = error as ErrorDeBase
  console.error(MENSAJE_ERROR_ANULAR, error)
  if (esCodigoDeConflicto(e?.code)) return MENSAJE_CONFLICTO_ANULAR
  if (e?.code === '42501' || esCodigoDeEstado(e?.code) || e?.code === '22023') {
    const texto = textoDeLaRpc(e)
    if (texto) return texto
  }
  if (e?.code === 'P0002' || e?.code === 'PT404') return 'Ese comprobante no existe o no pertenece a tu organización.'
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
