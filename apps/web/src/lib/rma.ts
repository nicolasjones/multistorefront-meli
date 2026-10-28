import { supabaseClient } from './supabase'
import { definicionEstadoRma } from './estadoRma'
import { definicionForma, type FormaRma } from './formasRma'

// Devoluciones (RMA) por ítem (F-VTA-28, MSF-288, FR-002, FR-005, FR-006). `registrar_rma` y `listar_rma` (migraciones
// 20270113100100 y 20270113100200) son la autoridad: validan permiso, estado del comprobante y cantidades. Acá solo se
// nombran los parámetros, se normalizan las filas y se traducen los errores. Contrato en
// specs/20261027-100000-ventas-rma-devoluciones/contracts/ventas-rma-devoluciones.md.

export const TAMANO_PAGINA_RMA = 8
export const MOTIVO_RMA_MAXIMO = 200
export const OBSERVACIONES_RMA_MAXIMO = 1000

export const MENSAJE_ERROR_RMA = 'No pudimos registrar la devolución. No se guardó nada: probá de nuevo.'
export const MENSAJE_RMA_REGISTRADA = (forma: string) => `Devolución registrada · ${definicionForma(forma).etiqueta}`

export type RmaListado = {
  id: string
  numero: string
  creado_en: string
  /** Sello del bloqueo optimista de `cambiar_estado_rma`. */
  actualizado_en: string
  empresa_id: string
  empresa: string
  comprobante_id: string
  comprobante_numero: string
  cliente: string
  producto: string
  cantidad: number
  forma_rma: string
  motivo: string
  operador: string
  estado: string
}

export type PaginaRma = { devoluciones: RmaListado[]; total: number }

export type FiltrosRma = {
  busqueda: string
  /** '' = todas las formas. */
  formaRma: string
  /** Tienda: '' = todas. */
  empresaId: string
}

export const FILTROS_RMA_VACIOS: FiltrosRma = { busqueda: '', formaRma: '', empresaId: '' }

type FilaListado = Omit<RmaListado, 'cantidad'> & { cantidad: number | string; filas: number | string }

const nulo = (valor: string): string | null => (valor === '' ? null : valor)

export async function listarRma(filtros: FiltrosRma, pagina: number, tamano: number = TAMANO_PAGINA_RMA): Promise<PaginaRma> {
  const texto = filtros.busqueda.trim()
  const { data, error } = await supabaseClient.rpc('listar_rma', {
    p_busqueda: texto === '' ? null : texto,
    p_forma_rma: nulo(filtros.formaRma),
    p_estado: null,
    p_empresa_id: nulo(filtros.empresaId),
    p_pagina: pagina,
    p_tamano: tamano,
  })
  if (error) throw error
  const filas = (data ?? []) as FilaListado[]
  return {
    devoluciones: filas.map(({ filas: _filas, cantidad, ...resto }) => ({ ...resto, cantidad: Number(cantidad) })),
    total: filas.length > 0 ? Number(filas[0].filas) : 0,
  }
}

export type EntradaRma = {
  comprobanteId: string
  lineaId: string
  cantidad: number
  formaRma: FormaRma
  motivo: string
  observaciones: string
}

type ErrorDeBase = { code?: string; message?: string; hint?: string } | null

// Mensajes que la RPC escribe pensando en la persona: se muestran tal cual. Cualquier otro texto técnico se reemplaza.
const PREFIJOS_MENSAJE_DE_LA_RPC = [
  'Tu rol no puede',
  'La factura está',
  'La devolución se registra',
  'Elegí ',
  'Escribí el motivo',
  'El motivo no puede',
  'Las observaciones no pueden',
  'Cada ítem necesita',
  'Uno de los ítems',
  'Los ítems de la devolución',
  'No podés devolver más',
] as const

function esMensajeDeLaRpc(error: ErrorDeBase): error is { message: string } {
  const mensaje = error?.message
  return typeof mensaje === 'string' && PREFIJOS_MENSAJE_DE_LA_RPC.some((prefijo) => mensaje.startsWith(prefijo))
}

export function mensajeDeRma(error: unknown): string {
  const e = error as ErrorDeBase
  console.error(MENSAJE_ERROR_RMA, error)
  if ((e?.code === '42501' || e?.code === '55000' || e?.code === '22023' || e?.code === 'P0001') && esMensajeDeLaRpc(e)) return e.message
  if (e?.code === 'P0002') return 'Esa factura no existe o no pertenece a tu organización.'
  return MENSAJE_ERROR_RMA
}

export async function registrarRma(entrada: EntradaRma): Promise<{ id: string; numero: string }> {
  const observaciones = entrada.observaciones.trim()
  const { data, error } = await supabaseClient.rpc('registrar_rma', {
    p_comprobante_id: entrada.comprobanteId,
    p_lineas: [{ linea_id: entrada.lineaId, cantidad: entrada.cantidad }],
    p_forma_rma: entrada.formaRma,
    p_motivo: entrada.motivo.trim(),
    p_observaciones: observaciones === '' ? null : observaciones,
  })
  if (error) throw error
  const fila = data as { id?: string; numero?: string } | null
  if (!fila?.id || !fila.numero) throw new Error('La base no devolvió la devolución')
  return { id: fila.id, numero: fila.numero }
}

export type ComprobanteElegible = { id: string; numero: string; cliente: string; empresa: string }
export type LineaElegible = { id: string; descripcion: string; cantidad: number }

/** Lee las líneas del comprobante con `obtener_comprobante` (la misma lectura de la pantalla del comprobante). */
export async function lineasDeComprobante(comprobanteId: string): Promise<LineaElegible[]> {
  const { data, error } = await supabaseClient.rpc('obtener_comprobante', { p_id: comprobanteId })
  if (error) throw error
  const lineas = ((data as { lineas?: Array<{ id: string; descripcion: string; cantidad: number | string }> } | null)?.lineas ?? [])
  return lineas.map((l) => ({ id: l.id, descripcion: l.descripcion, cantidad: Number(l.cantidad) }))
}

export const MENSAJE_ERROR_CAMBIO_ESTADO_RMA = 'No pudimos cambiar el estado de la devolución. No se guardó nada: probá de nuevo.'
export const MENSAJE_CONFLICTO_ESTADO_RMA = 'Otra persona modificó esta devolución. Actualizamos el listado: revisá y volvé a intentar.'
export const MENSAJE_ESTADO_RMA_CAMBIADO = (numero: string, estado: string) =>
  `Devolución ${numero} · ${definicionEstadoRma(estado).etiqueta}`

export function mensajeDeCambioEstadoRma(error: unknown): string {
  const e = error as ErrorDeBase
  console.error(MENSAJE_ERROR_CAMBIO_ESTADO_RMA, error)
  if (e?.code === '40001') return MENSAJE_CONFLICTO_ESTADO_RMA
  if (e?.code === '42501' && typeof e.message === 'string' && e.message.startsWith('Tu rol no puede')) return e.message
  if (e?.code === 'P0002') return 'Esa devolución ya no existe. Actualizamos el listado.'
  return MENSAJE_ERROR_CAMBIO_ESTADO_RMA
}

/** Avanza el estado con `cambiar_estado_rma` (FR-011); `actualizadoEn` es el sello leído en el listado. */
export async function cambiarEstadoRma(id: string, estado: string, actualizadoEn: string): Promise<{ id: string; estado: string }> {
  const { data, error } = await supabaseClient.rpc('cambiar_estado_rma', {
    p_id: id,
    p_estado: estado,
    p_actualizado_en: actualizadoEn,
  })
  if (error) throw error
  const fila = data as { id?: string; estado?: string } | null
  if (!fila?.id || !fila.estado) throw new Error('La base no devolvió la devolución')
  return { id: fila.id, estado: fila.estado }
}
