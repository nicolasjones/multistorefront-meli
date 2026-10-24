import { supabaseClient } from './supabase'
import { MENSAJE_CERRADO, mensajeDeErrorComprobante, type Comprobante } from './ventas'
import { hayFaltante, type LineaComprobante } from './ventasLineas'

// Confirmación de la factura (F-VTA-07, MSF-317). La autoridad es la base: `confirmar_comprobante` descuenta el
// stock de cada línea en SU depósito, reserva las líneas «A pedido» y lo hace todo o nada (FR-030…FR-035). Acá
// solo se decide si se ofrece la acción y se traducen sus errores. Contrato en docs/ventas-comprobantes.md.

export const ETIQUETA_CONFIRMAR_FACTURA = 'Confirmar factura'
export const TITULO_CONFIRMAR_FACTURA = 'Confirmar factura'
export const MENSAJE_ERROR_CONFIRMAR = 'No pudimos confirmar la factura. No se descontó nada: probá de nuevo.'

// La acción se ofrece solo en una factura en borrador, editable por esta persona y con al menos una línea.
// Un presupuesto nunca se confirma (FR-030).
export function puedeConfirmarFactura(comprobante: Pick<Comprobante, 'tipo' | 'estado' | 'editable' | 'puede_editar' | 'lineas'>): boolean {
  return (
    comprobante.tipo === 'factura' &&
    comprobante.estado === 'borrador' &&
    comprobante.editable &&
    comprobante.puede_editar &&
    comprobante.lineas.length > 0
  )
}

// Líneas que hoy piden más que el disponible de su depósito: la confirmación fallaría (FR-034).
export const lineasConFaltante = (lineas: readonly LineaComprobante[]): LineaComprobante[] => lineas.filter(hayFaltante)

export const cantidadADejarReservada = (lineas: readonly LineaComprobante[]): number => lineas.filter((linea) => linea.a_pedido).length

type ErrorDeBase = { code?: string; message?: string } | null

// P0001 es el «sin stock suficiente» de la base: su mensaje ya nombra producto y depósito, en castellano.
export const esFaltanteDeStock = (error: unknown): boolean => (error as ErrorDeBase)?.code === 'P0001'

export function mensajeDeConfirmacion(error: unknown): string {
  const e = error as ErrorDeBase
  if (esFaltanteDeStock(error) && e?.message) {
    console.error('Confirmación rechazada por falta de stock.', error)
    return `${e.message}. No se descontó nada: elegí otro depósito o bajá la cantidad.`
  }
  if (e?.code === '55000') return MENSAJE_CERRADO
  return mensajeDeErrorComprobante(error, MENSAJE_ERROR_CONFIRMAR)
}

// Confirma la factura. Reintentar sobre una ya confirmada es seguro (idempotente): no duplica movimientos.
export async function confirmarComprobante(comprobanteId: string): Promise<void> {
  const { error } = await supabaseClient.rpc('confirmar_comprobante', { p_id: comprobanteId })
  if (error) throw error
}
