import { supabaseClient } from './supabase'
import { ESTADOS_COMPROBANTE, type EstadoComprobante } from './estadosComprobante'

// Listado de comprobantes (F-VTA-09, MSF-346, FR-001…FR-003). `listar_comprobantes` y `operadores_de_comprobantes`
// (migración 20261207110000) son la autoridad: acá solo se nombran los parámetros y se normalizan las filas.
// Contrato en specs/20261024-130000-ventas-listado-estados-y-anulacion/contracts y docs/ventas-listado-comprobantes.md.

export type TipoListado = 'factura' | 'nota_credito'

export const ETIQUETA_TIPO_LISTADO: Readonly<Record<TipoListado, string>> = { factura: 'Factura', nota_credito: 'Nota de crédito' }

export type ComprobanteListado = {
  id: string
  numero: string
  tipo: TipoListado
  empresa_id: string
  empresa: string
  fecha: string
  cliente: string
  operador: string
  estado: string
  forma_pago: string | null
  envio: string | null
  /** Con signo: la nota de crédito resta. */
  total: number
}

export type PaginaComprobantes = { comprobantes: ComprobanteListado[]; total: number }

export type FiltrosComprobantes = {
  busqueda: string
  /** '' = todos. */
  estado: string
  pagoId: string
  envioId: string
  operadorId: string
  /** Tienda: '' = todas. */
  empresaId: string
}

export const FILTROS_VACIOS: FiltrosComprobantes = { busqueda: '', estado: '', pagoId: '', envioId: '', operadorId: '', empresaId: '' }

// Opciones del filtro Estado, en el orden del prototipo. «Entregado» es de MSF-135 y no se ofrece. «Pendiente» es
// `pendiente` (la base lo iguala a `confirmada`).
export const OPCIONES_FILTRO_ESTADO: ReadonlyArray<{ valor: string; etiqueta: string }> = (
  ['pendiente', 'aceptado', 'cobrado', 'en_proceso', 'deuda', 'armando', 'incompleto'] as EstadoComprobante[]
).map((valor) => ({ valor, etiqueta: ESTADOS_COMPROBANTE[valor].etiqueta }))

const nulo = (valor: string): string | null => (valor === '' ? null : valor)

/** Parámetros comunes del listado y de la exportación (mismos filtros, mismo significado). */
export function parametrosDeFiltros(f: FiltrosComprobantes) {
  const texto = f.busqueda.trim()
  return {
    p_busqueda: texto === '' ? null : texto,
    p_estado: nulo(f.estado),
    p_pago_id: nulo(f.pagoId),
    p_envio_id: nulo(f.envioId),
    p_operador_id: nulo(f.operadorId),
    p_empresa_id: nulo(f.empresaId),
  }
}

type FilaListado = Omit<ComprobanteListado, 'total'> & { total: number | string; filas: number | string }

export async function listarComprobantes(filtros: FiltrosComprobantes, pagina: number, tamano: number): Promise<PaginaComprobantes> {
  const { data, error } = await supabaseClient.rpc('listar_comprobantes', {
    ...parametrosDeFiltros(filtros),
    p_pagina: pagina,
    p_tamano: tamano,
  })
  if (error) throw error
  const filas = (data ?? []) as FilaListado[]
  return {
    comprobantes: filas.map(({ filas: _filas, total, ...resto }) => ({ ...resto, total: Number(total) })),
    total: filas.length > 0 ? Number(filas[0].filas) : 0,
  }
}

export type OperadorComprobantes = { id: string; nombre: string }

export async function listarOperadoresComprobantes(empresaId: string): Promise<OperadorComprobantes[]> {
  const { data, error } = await supabaseClient.rpc('operadores_de_comprobantes', { p_empresa_id: nulo(empresaId) })
  if (error) throw error
  return (data ?? []) as OperadorComprobantes[]
}
