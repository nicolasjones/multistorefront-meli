import { supabaseClient } from './supabase'

// Tablero de Inicio (F-INI-04, MSF-820): lectura agregada de ventas, stock y serie diaria por la RPC
// `public.resumen_inicio_periodo`. La base decide qué ve cada rol: `ventas` o `stock` vuelven null sin permiso
// (el bloque no se muestra); acá solo se rotulan los números.

export type ResumenVentas = {
  monto: number
  comprobantes: number
  unidades: number
  devoluciones_monto: number
  devoluciones_unidades: number
  anterior_monto: number
  anterior_comprobantes: number
  ticket_promedio: number | null
}

export type ResumenStock = {
  unidades: number
  reservado: number
  disponible: number
  sin_stock: number
  stock_bajo: number
  ajustes: number
  entradas_unidades: number
}

export type PuntoSerie = { dia: string; unidades: number | null; stock: number | null }

export type ResumenInicio = {
  desde: string
  hasta: string
  anterior_desde: string
  anterior_hasta: string
  ventas: ResumenVentas | null
  stock: ResumenStock | null
  serie: PuntoSerie[]
}

export type ParametrosResumen = { desde: string; hasta: string; empresaId: string | null; depositoId: string | null }

export async function leerResumenInicio({ desde, hasta, empresaId, depositoId }: ParametrosResumen): Promise<ResumenInicio> {
  const { data, error } = await supabaseClient.rpc('resumen_inicio_periodo', {
    p_desde: desde,
    p_hasta: hasta,
    p_empresa: empresaId,
    p_deposito: depositoId,
  })
  if (error) throw error
  return data as ResumenInicio
}

// Variación porcentual contra el período anterior; null si no hay base de comparación (anterior en cero).
export function variacionPorcentual(actual: number, anterior: number): number | null {
  if (!Number.isFinite(actual) || !Number.isFinite(anterior) || anterior === 0) return null
  return ((actual - anterior) / Math.abs(anterior)) * 100
}

const pesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
const enteros = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const porcentaje = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1, signDisplay: 'exceptZero' })

export const formatoPesos = (valor: number) => pesos.format(valor)
export const formatoEntero = (valor: number) => enteros.format(valor)
export const formatoVariacion = (valor: number) => `${porcentaje.format(valor)} %`
