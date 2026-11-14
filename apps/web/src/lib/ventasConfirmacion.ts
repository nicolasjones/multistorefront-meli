import { supabaseClient } from './supabase'
import { MENSAJE_CERRADO, mensajeDeErrorComprobante, obtenerComprobante, type Comprobante } from './ventas'
import { aEntradas, guardarLineasComprobante, hayFaltante, type LineaComprobante } from './ventasLineas'

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

type ErrorDeBase = { code?: string; message?: string; hint?: string } | null

// El «sin stock suficiente» de la base es P0001 con hint 'stock': su mensaje ya nombra producto y depósito.
// P0001 solo es el errcode por defecto de cualquier `raise exception`, así que no alcanza para distinguirlo.
export const esFaltanteDeStock = (error: unknown): boolean => {
  const e = error as ErrorDeBase
  return e?.code === 'P0001' && e?.hint === 'stock'
}

// MSF-816 (FR-018): la guarda del servidor rechazó la confirmación porque el precio de alguna línea ya no es
// el que se mostró (promoción vencida o nueva). Es un 40001 con hint 'precios_cambiaron': se reconoce ANTES
// del mapeo genérico de 40001 («otra persona modificó…»).
export const esPreciosCambiaron = (error: unknown): boolean => {
  const e = error as ErrorDeBase
  return e?.code === '40001' && e?.hint === 'precios_cambiaron'
}

export const MENSAJE_PRECIOS_CAMBIARON = 'Los precios cambiaron: revisá el total y cobrá de nuevo.'

export function mensajeDeConfirmacion(error: unknown): string {
  const e = error as ErrorDeBase
  if (esPreciosCambiaron(error)) return MENSAJE_PRECIOS_CAMBIARON
  if (esFaltanteDeStock(error) && e?.message) {
    console.error('Confirmación rechazada por falta de stock.', error)
    return `${e.message}. No se descontó nada: elegí otro depósito o bajá la cantidad.`
  }
  if (e?.code === '55000') return MENSAJE_CERRADO
  return mensajeDeErrorComprobante(error, MENSAJE_ERROR_CONFIRMAR)
}

// MSF-816 (FR-018): reprecia el comprobante. Se re-guardan las líneas con las MISMAS cantidades y los MISMOS
// precios manuales (la base vuelve a calcular precio, escala, IVA y totales) y se relee el comprobante. El
// cobro no se reintenta desde acá: la persona lo dispara de nuevo con el total nuevo.
export async function repreciarComprobante(comprobante: Comprobante): Promise<Comprobante> {
  await guardarLineasComprobante(comprobante.id, aEntradas(comprobante.lineas), comprobante.updated_at)
  return obtenerComprobante(comprobante.id)
}

// Confirma la factura. Reintentar sobre una ya confirmada es seguro (idempotente): no duplica movimientos.
export async function confirmarComprobante(comprobanteId: string): Promise<void> {
  const { error } = await supabaseClient.rpc('confirmar_comprobante', { p_id: comprobanteId })
  if (error) throw error
}
