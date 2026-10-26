import { supabaseClient } from './supabase'

// Líneas de los comprobantes de venta (F-VTA-06, MSF-295). La autoridad es la base: `guardar_lineas_comprobante`
// reemplaza las líneas en una transacción y CALCULA el precio, la escala y el IVA (el navegador nunca fija un
// precio salvo `precio_manual`, que la base acepta solo con la acción `editar_precio`). Acá solo se arma la lista
// que se envía y se interpreta lo que vuelve. Contrato en docs/ventas-comprobantes.md.

export type EscalaLinea = 'x1' | 'x5' | 'x10' | 'x50'

export type LineaComprobante = {
  id: string
  orden: number
  producto_id: string
  descripcion: string
  codigo: string | null
  cantidad: number
  precio_unitario: number
  escala: EscalaLinea
  precio_manual: boolean
  alicuota_porcentaje: number
  deposito_id: string
  deposito: string
  a_pedido: boolean
  stock: number
  reservado: number
  subtotal_sin_iva: number
  iva: number
}

// Lo que se envía por línea. `precio_manual` null = que lo calcule la base.
export type EntradaLinea = {
  producto_id: string
  cantidad: number
  deposito_id: string | null
  precio_manual: number | null
}

export const CANTIDAD_MAXIMA_LINEA = 99_999
export const PRECIO_MAXIMO_LINEA = 99_999_999.99

export const TEXTO_AYUDA_LINEAS =
  'El precio sale de la escala del producto según el tipo de cliente y la cantidad. Disp. = stock del depósito elegido menos lo reservado. El stock se reserva al vender y se descuenta recién al marcar el comprobante como Entregado.'
export const ETIQUETA_A_PEDIDO = 'A pedido · no descuenta stock'
export const MENSAJE_SIN_LINEAS = 'Todavía no agregaste productos. Usá «Agregar producto» para empezar.'
export const MENSAJE_CANTIDAD_LINEA = `Ingresá una cantidad entera de 1 a ${CANTIDAD_MAXIMA_LINEA}.`
export const MENSAJE_PRECIO_LINEA = 'Ingresá un precio de cero o más, con hasta dos decimales.'
export const MENSAJE_SIN_PERMISO_PRECIO = 'Tu rol no puede editar precios: el precio sale de la escala del producto.'

export const rotuloEscalaLinea = (linea: Pick<LineaComprobante, 'escala' | 'precio_manual'>) =>
  linea.precio_manual ? 'precio manual' : `escala ${linea.escala}`

// Disponible = stock del depósito menos lo reservado (FR-017); nunca negativo.
export const disponibleDeLinea = (linea: Pick<LineaComprobante, 'stock' | 'reservado'>) => Math.max(0, linea.stock - linea.reservado)

// Faltante (FR-018): una cantidad mayor al disponible. Los productos «A pedido» no descuentan stock: no hay faltante.
export const hayFaltante = (linea: Pick<LineaComprobante, 'a_pedido' | 'cantidad' | 'stock' | 'reservado'>) =>
  !linea.a_pedido && linea.cantidad > disponibleDeLinea(linea)

export function mensajeFaltante(linea: Pick<LineaComprobante, 'cantidad' | 'stock' | 'reservado' | 'deposito'>): string {
  return `Hay ${disponibleDeLinea(linea)} disponibles en ${linea.deposito} y la línea pide ${linea.cantidad}. Para confirmar la factura elegí otro depósito o bajá la cantidad.`
}

export function parsearCantidadLinea(texto: string): number | null {
  const limpio = texto.trim()
  if (!/^\d{1,5}$/.test(limpio)) return null
  const valor = Number(limpio)
  return valor >= 1 && valor <= CANTIDAD_MAXIMA_LINEA ? valor : null
}

// Vacío = quitar el precio manual (vuelve el de la escala): devuelve null. Inválido: `undefined`.
export function parsearPrecioLinea(texto: string): number | null | undefined {
  const limpio = texto.trim()
  if (limpio === '') return null
  if (!/^\d{1,8}([.,]\d{1,2})?$/.test(limpio)) return undefined
  const valor = Number(limpio.replace(',', '.'))
  return valor <= PRECIO_MAXIMO_LINEA ? valor : undefined
}

// --- Edición de la lista (puras: devuelven una lista nueva para enviar) ---

export function aEntradas(lineas: readonly LineaComprobante[]): EntradaLinea[] {
  return lineas.map((linea) => ({
    producto_id: linea.producto_id,
    cantidad: linea.cantidad,
    deposito_id: linea.deposito_id,
    precio_manual: linea.precio_manual ? linea.precio_unitario : null,
  }))
}

// Agregar el mismo producto desde el mismo depósito suma una unidad a la línea existente en vez de duplicarla.
export function conProductoAgregado(entradas: readonly EntradaLinea[], productoId: string, depositoId: string | null): EntradaLinea[] {
  const indice = entradas.findIndex(
    (entrada) => entrada.producto_id === productoId && entrada.deposito_id === depositoId && entrada.precio_manual === null,
  )
  if (indice >= 0) {
    return entradas.map((entrada, i) => (i === indice ? { ...entrada, cantidad: Math.min(entrada.cantidad + 1, CANTIDAD_MAXIMA_LINEA) } : entrada))
  }
  return [...entradas, { producto_id: productoId, cantidad: 1, deposito_id: depositoId, precio_manual: null }]
}

export const conCambio = (entradas: readonly EntradaLinea[], indice: number, cambio: Partial<EntradaLinea>): EntradaLinea[] =>
  entradas.map((entrada, i) => (i === indice ? { ...entrada, ...cambio } : entrada))

export const sinLinea = (entradas: readonly EntradaLinea[], indice: number): EntradaLinea[] => entradas.filter((_, i) => i !== indice)

// --- Base ---

function numero(valor: unknown): number {
  return Number(valor ?? 0)
}

export function aLineas(dato: unknown): LineaComprobante[] {
  if (!Array.isArray(dato)) return []
  return dato.map((bruto) => {
    const linea = bruto as Record<string, unknown>
    return {
      ...(linea as unknown as LineaComprobante),
      cantidad: numero(linea.cantidad),
      precio_unitario: numero(linea.precio_unitario),
      alicuota_porcentaje: numero(linea.alicuota_porcentaje),
      stock: numero(linea.stock),
      reservado: numero(linea.reservado),
      subtotal_sin_iva: numero(linea.subtotal_sin_iva),
      iva: numero(linea.iva),
    }
  })
}

// Reemplaza todas las líneas del comprobante. Quien llama relee el comprobante después (los precios, la escala y
// los totales los calcula la base). `actualizadoEn` es el bloqueo optimista: un cambio ajeno da 40001.
export async function guardarLineasComprobante(comprobanteId: string, entradas: readonly EntradaLinea[], actualizadoEn: string): Promise<void> {
  const { error } = await supabaseClient.rpc('guardar_lineas_comprobante', {
    p_id: comprobanteId,
    p_lineas: entradas,
    p_actualizado_en: actualizadoEn,
  })
  if (error) throw error
}

// Stock vendible de un producto en un depósito (existencias − reservado). null si no es de la organización.
export async function disponibleParaVenta(productoId: string, depositoId: string): Promise<number | null> {
  const { data, error } = await supabaseClient.rpc('disponible_para_venta', { p_producto_id: productoId, p_deposito_id: depositoId })
  if (error) throw error
  return data === null || data === undefined ? null : Number(data)
}
