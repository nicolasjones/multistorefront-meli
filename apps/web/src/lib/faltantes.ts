// Faltantes con aviso de reposición (F-STK-17, MSF-405). La vista `public.faltantes_listado` y la RPC
// `avisar_faltantes` viven en las migraciones 20261213100200…13100400. La autoridad es la base: RLS y el
// nivel `ventas` por tienda deciden qué faltantes se ven y cuáles se pueden avisar.
import { supabaseClient } from './supabase'
import type { EstadoStock } from './stock'

export const TAMANO_PAGINA_FALTANTES = 25
export const MAXIMO_AVISO = 200

export type AvisoFaltante = 'sin_avisar' | 'avisado'

// Fila de `public.faltantes_listado`.
export type Faltante = {
  linea_id: string
  empresa_id: string
  empresa: string
  cliente_id: string
  cliente: string
  producto: string
  sku: string | null
  pedido: number
  comprobante_id: string
  comprobante_numero: string
  desde: string
  estado_stock: EstadoStock
  aviso: AvisoFaltante
}

export type FiltrosFaltantes = { empresaId: string | null; pagina: number; tamano?: number }

export type ResultadoAviso = {
  encolados: number
  lineas_avisadas: number
  omitidos_ya_avisados: number
  omitidos_sin_stock: number
  omitidos_sin_correo: number
  omitidos_sin_permiso: number
}

const COLUMNAS =
  'linea_id, empresa_id, empresa, cliente_id, cliente, producto, sku, pedido, comprobante_id, comprobante_numero, desde, estado_stock, aviso'

/** Una página de faltantes, del más reciente al más antiguo. `empresaId` null = todas las tiendas visibles. */
export async function listarFaltantes({ empresaId, pagina, tamano = TAMANO_PAGINA_FALTANTES }: FiltrosFaltantes) {
  const desde = (pagina - 1) * tamano
  let consulta = supabaseClient.from('faltantes_listado').select(COLUMNAS, { count: 'exact' })
  if (empresaId) consulta = consulta.eq('empresa_id', empresaId)
  const { data, count, error } = await consulta
    .order('desde', { ascending: false })
    .order('linea_id', { ascending: true })
    .range(desde, desde + tamano - 1)
    .returns<Faltante[]>()
  if (error) throw new Error(error.message)
  return { filas: data ?? [], total: count ?? 0 }
}

export async function avisarFaltantes(lineas: string[]): Promise<ResultadoAviso> {
  if (lineas.length === 0 || lineas.length > MAXIMO_AVISO) {
    throw new Error(`Elegí entre 1 y ${MAXIMO_AVISO} faltantes para avisar.`)
  }
  const { data, error } = await supabaseClient.rpc('avisar_faltantes', { p_lineas: lineas })
  if (error) {
    throw new Error(error.code === '42501' ? 'Tu rol no puede avisar faltantes.' : 'No pudimos enviar los avisos. Probá de nuevo.')
  }
  return data as ResultadoAviso
}

/** Texto del aviso emergente: «Avisos enviados» más, si corresponde, lo que se omitió y por qué. */
export function mensajeResultadoAviso(resultado: ResultadoAviso): string {
  const omitidos: string[] = []
  if (resultado.omitidos_sin_stock > 0) omitidos.push(`${resultado.omitidos_sin_stock} sin stock`)
  if (resultado.omitidos_sin_correo > 0) omitidos.push(`${resultado.omitidos_sin_correo} sin correo`)
  if (resultado.omitidos_ya_avisados > 0) omitidos.push(`${resultado.omitidos_ya_avisados} ya avisados`)
  if (resultado.omitidos_sin_permiso > 0) omitidos.push(`${resultado.omitidos_sin_permiso} sin permiso`)
  return omitidos.length > 0 ? `Avisos enviados. Se omitieron: ${omitidos.join(', ')}.` : 'Avisos enviados'
}
