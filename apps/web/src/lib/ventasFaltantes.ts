import { supabaseClient } from './supabase'
import { ESTADOS_STOCK, type EstadoStock } from './stock'
import type { VarianteEtiqueta } from '../components/base/EtiquetaEstado'

// Faltantes de venta (F-VTA-18, MSF-201, épica MSF-135, FR-043, FR-044 y FR-047).
//
// La autoridad es la base: `listar_faltantes` (migración 20261214130300) trae los faltantes ABIERTOS con
// cliente, producto, SKU, cantidad, comprobante, fecha del pedido, «desde» y el stock de hoy; y
// `registrar_faltantes_despacho` (migración 20261214130200) registra los faltantes de una factura en Armando
// y la deja Incompleta. Acá solo se nombran los tipos, se rotula el stock de hoy y se envuelven las dos RPC.

/** Una fila del listado de faltantes (una línea de una factura que quedó sin stock). */
export type FaltanteVenta = {
  id: string
  empresa_id: string
  /** Tienda del faltante. */
  empresa: string
  cliente: string
  producto: string
  sku: string | null
  /** Unidades que faltaron de lo pedido. */
  cantidad_faltante: number
  /** Línea de la factura (1..n). */
  linea_orden: number
  comprobante_id: string
  /** Número del comprobante («0003-00001251»). */
  comprobante: string
  /** Fecha del pedido. */
  fecha: string
  /** Cuándo se registró el faltante (columna «Desde»). */
  desde: string
  /** Estado del stock del producto hoy: `sin_stock`, `stock_bajo` o `disponible`. */
  stock_estado: EstadoStock | null
  /** Unidades disponibles del producto hoy. */
  stock_disponible: number | null
}

export type PaginaFaltantes = {
  faltantes: FaltanteVenta[]
  /** Total de faltantes que cumplen el filtro (todas las páginas). */
  total: number
}

type FilaListado = Omit<FaltanteVenta, 'cantidad_faltante' | 'linea_orden' | 'stock_disponible'> & {
  cantidad_faltante: number | string
  linea_orden: number | string
  stock_disponible: number | string | null
  filas: number | string
}

// «Stock hoy»: el estado del producto con la misma lectura de Stock que usa la pantalla de Stock
// (`public.stock_estados`). El prototipo lo muestra como etiqueta.
export function estadoStockHoy(estado: EstadoStock | null | undefined): { texto: string; variante: VarianteEtiqueta } {
  if (!estado) return { texto: 'Sin dato', variante: 'neutral' }
  const encontrado = ESTADOS_STOCK.find((e) => e.valor === estado)
  return { texto: encontrado?.etiqueta ?? estado, variante: encontrado?.variante ?? 'neutral' }
}

/** Las unidades disponibles de hoy, con la unidad en singular o plural. */
export function unidadesDisponibles(disponible: number | null | undefined): string {
  if (disponible === null || disponible === undefined) return '—'
  return `${disponible} ${disponible === 1 ? 'unidad' : 'unidades'}`
}

// Faltantes de una factura: línea y cantidad faltante (FR-047).
export type FaltanteARegistrar = {
  linea_orden: number
  cantidad: number
}

export const MENSAJE_CANTIDAD_VACIA = 'Ingresá la cantidad faltante.'
export const MENSAJE_CANTIDAD_NO_NUMERO = 'La cantidad faltante tiene que ser un número entero.'
export const MENSAJE_CANTIDAD_CERO = 'La cantidad faltante tiene que ser mayor a cero.'
export const MENSAJE_CANTIDAD_EXCEDE = 'La cantidad faltante no puede ser mayor a lo pedido.'

/**
 * Valida la cantidad faltante de una línea contra lo pedido en esa línea (mismo límite que la RPC:
 * entre 1 y lo pedido). Devuelve el mensaje de error o `null` si está bien.
 */
export function validarCantidadFaltante(texto: string, cantidadPedida: number): string | null {
  const limpio = texto.trim()
  if (limpio === '') return MENSAJE_CANTIDAD_VACIA
  if (!/^\d{1,7}$/.test(limpio)) return MENSAJE_CANTIDAD_NO_NUMERO
  const valor = Number(limpio)
  if (valor < 1) return MENSAJE_CANTIDAD_CERO
  if (valor > cantidadPedida) return MENSAJE_CANTIDAD_EXCEDE
  return null
}

export const MENSAJE_ERROR_LISTADO = 'No pudimos cargar los faltantes. Probá de nuevo.'
export const MENSAJE_ERROR_REGISTRAR = 'No pudimos registrar los faltantes. No se guardó nada: probá de nuevo.'
export const MENSAJE_CONFLICTO =
  'Otra persona modificó este comprobante mientras lo mirabas. Recargamos los datos: volvé a registrar los faltantes.'
export const MENSAJE_SIN_PERMISO = 'Tu rol no puede registrar faltantes en esta tienda.'
export const MENSAJE_FUERA_DE_ESTADO = 'Los faltantes se registran con la factura en Armando o Incompleto.'
export const MENSAJE_COMPROBANTE_INEXISTENTE = 'Ese comprobante no existe o no pertenece a tu organización.';

// Los mensajes que levanta la RPC llegan en castellano y se muestran tal cual; el resto se traduce por código.
const PREFIJOS_MENSAJE_DE_LA_RPC = [
  'Necesitás una sesión',
  'Elegí al menos una línea faltante',
  'Una factura admite hasta',
  'La línea',
  'La cantidad faltante',
  'Solo las facturas',
  'Esta factura todavía no tiene estado de despacho',
  'Los faltantes se registran',
  'Tu rol no puede registrar faltantes',
  'Alguien modificó',
] as const

type ErrorDeBase = { code?: string; message?: string } | null

function esMensajeDeLaRpc(error: ErrorDeBase): error is { message: string } {
  const mensaje = error?.message
  return typeof mensaje === 'string' && PREFIJOS_MENSAJE_DE_LA_RPC.some((prefijo) => mensaje.startsWith(prefijo))
}

/** Traduce el error de la RPC a un mensaje en castellano para la persona. */
export function mensajeDeErrorFaltantes(error: unknown, porDefecto: string): string {
  const e = error as ErrorDeBase
  console.error(porDefecto, e?.code ?? 'sin código')
  if (e?.code === '40001') return MENSAJE_CONFLICTO
  if (e?.code === 'P0002') return MENSAJE_COMPROBANTE_INEXISTENTE
  if (e?.code === '55000') return MENSAJE_FUERA_DE_ESTADO
  if (e?.code === '42501') return MENSAJE_SIN_PERMISO
  if (e?.code === '22023' && esMensajeDeLaRpc(e)) return e.message
  return porDefecto
}

/**
 * Faltantes abiertos de las empresas accesibles, paginados en el servidor.
 * `empresaId` filtra por tienda; `null` muestra todas (el valor por defecto de la pantalla).
 */
export async function listarFaltantes({
  empresaId,
  pagina,
  tamano,
}: {
  empresaId: string | null
  pagina: number
  tamano: number
}): Promise<PaginaFaltantes> {
  const { data, error } = await supabaseClient.rpc('listar_faltantes', {
    p_empresa_id: empresaId,
    p_pagina: pagina,
    p_tamano: tamano,
  })
  if (error) throw error
  const filas = (data ?? []) as FilaListado[]
  return {
    faltantes: filas.map(({ filas: _filas, ...faltante }) => ({
      ...faltante,
      cantidad_faltante: Number(faltante.cantidad_faltante),
      linea_orden: Number(faltante.linea_orden),
      stock_disponible:
        faltante.stock_disponible === null || faltante.stock_disponible === undefined
          ? null
          : Number(faltante.stock_disponible),
    })),
    total: filas.length > 0 ? Number(filas[0].filas) : 0,
  }
}

/**
 * Registra los faltantes de una factura y la deja Incompleto (FR-041).
 * `actualizadoEn` es el `updated_at` leído al abrir el comprobante (bloqueo optimista, 40001 ante conflicto).
 */
export async function registrarFaltantes({
  comprobanteId,
  actualizadoEn,
  faltantes,
}: {
  comprobanteId: string
  actualizadoEn: string
  faltantes: FaltanteARegistrar[]
}): Promise<void> {
  const { error } = await supabaseClient.rpc('registrar_faltantes_despacho', {
    p_id: comprobanteId,
    p_faltantes: faltantes.map((faltante) => ({
      linea_orden: faltante.linea_orden,
      cantidad: faltante.cantidad,
    })),
    p_actualizado_en: actualizadoEn,
  })
  if (error) throw error
}
