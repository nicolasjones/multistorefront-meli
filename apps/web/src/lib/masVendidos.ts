// Productos más vendidos (F-STK-18, MSF-414). La RPC `public.productos_mas_vendidos`
// (migración 20261213100500) suma las UNIDADES de las líneas de las facturas que CUENTAN, del período
// y de las tiendas elegidas. La base manda: presupuestos, borradores y anuladas no suman, y solo
// cuentan las tiendas con `ventas` visible para quien consulta.
//
// Período (FR-404): los mismos atajos y la misma validación que el ranking de clientes
// (`periodosRanking`): zona America/Argentina/Buenos_Aires y rango máximo de 5 años. El control de la
// pantalla es una comodidad; la garantía es la revalidación del servidor.
import { supabaseClient } from './supabase'
import {
  ATAJOS_PERIODO, rangoDeAtajo, validarRango,
  type AtajoPeriodo, type ErroresRango, type RangoFechas,
} from './periodosRanking'

export { ATAJOS_PERIODO, rangoDeAtajo, validarRango }
export type { AtajoPeriodo, ErroresRango, RangoFechas }

// 25 por página (FR-405). El servidor acepta hasta 200.
export const TAMANO_PAGINA_MAS_VENDIDOS = 25

/** Una fila del ranking: lo que devuelve `public.productos_mas_vendidos`. */
export type FilaMasVendido = {
  posicion: number
  producto_id: string
  nombre: string
  sku: string | null
  unidades: number
}

export type FiltrosMasVendidos = {
  desde: string
  hasta: string
  /** Tienda (empresa) por la que se filtra; null = todas las tiendas visibles. */
  empresaId: string | null
  pagina: number
  tamano?: number
}

// `bigint` puede llegar como texto: se normaliza a número.
type FilaServidor = {
  posicion: number | string
  producto_id: string
  nombre: string
  sku: string | null
  unidades: number | string
  total_filas: number | string
}

export function normalizarFilaMasVendido(fila: FilaServidor): FilaMasVendido {
  return {
    posicion: Number(fila.posicion),
    producto_id: String(fila.producto_id),
    nombre: String(fila.nombre),
    sku: fila.sku ?? null,
    unidades: Number(fila.unidades),
  }
}

/** El período por defecto del reporte: el mes en curso (misma zona que el ranking de clientes). */
export function periodoInicial(): RangoFechas {
  return rangoDeAtajo('este-mes')
}

// Errores de la RPC traducidos a castellano. Nunca se muestra el error técnico de la base.
function mensajeDeError(error: { code?: string; message?: string }): string {
  if (error.code === '42501') return 'No tenés permiso para ver los productos más vendidos.'
  if (error.code === '22023') return 'El período elegido no es válido.'
  return 'No pudimos cargar los productos más vendidos. Probá de nuevo.'
}

/**
 * Una página del ranking de productos más vendidos.
 * El rango se valida antes de salir (el servidor lo revalida igual): un período inválido no llega a
 * la base, y el error que ve la persona dice qué corregir.
 */
export async function listarMasVendidos({
  desde, hasta, empresaId, pagina, tamano = TAMANO_PAGINA_MAS_VENDIDOS,
}: FiltrosMasVendidos): Promise<{ filas: FilaMasVendido[]; total: number }> {
  const errores = validarRango({ desde, hasta })
  if (errores.desde || errores.hasta) {
    throw new Error(errores.desde ?? errores.hasta ?? 'El período no es válido.')
  }
  const { data, error } = await supabaseClient.rpc('productos_mas_vendidos', {
    p_desde: desde,
    p_hasta: hasta,
    p_empresa_id: empresaId,
    p_pagina: pagina,
    p_tamano: tamano,
  })
  if (error) throw new Error(mensajeDeError(error))
  const filas = (data ?? []) as FilaServidor[]
  return {
    filas: filas.map(normalizarFilaMasVendido),
    total: filas.length > 0 ? Number(filas[0].total_filas) : 0,
  }
}
