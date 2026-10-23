// Empresas que venden el producto (F-CAT-07, MSF-276). La relación vive en `dominio.producto_empresa`
// y se escribe solo por la RPC `public.definir_empresas_producto` (atómica e idempotente; ver
// docs/catalogo.md § «Empresas»). Acá: lectura, guardado y la nota de visibilidad del prototipo.
import type { SupabaseClient } from '@supabase/supabase-js'

export const TEXTO_EMPRESAS_COMPARTIDO = 'El producto y su stock son únicos y compartidos. Cada tienda lo publica con su propio precio y estado.'
export const NOTA_SIN_EMPRESAS = 'No se muestra en ninguna store: el producto no aparece en el catálogo público.'

// «Visible en San Javucho y Mundo JC.» (prototipo: une con « y »).
export function notaVisibilidad(nombres: readonly string[]): string {
  return nombres.length > 0 ? `Visible en ${nombres.join(' y ')}.` : NOTA_SIN_EMPRESAS
}

// ¿Cambió el conjunto elegido? (el orden no importa).
export function empresasCambiaron(actual: readonly string[], inicial: readonly string[]): boolean {
  const base = new Set(inicial)
  return actual.length !== base.size || actual.some((id) => !base.has(id))
}

export async function leerEmpresasProducto(cliente: Pick<SupabaseClient, 'schema'>, productoId: string): Promise<string[]> {
  const { data, error } = await cliente
    .schema('dominio')
    .from('producto_empresa')
    .select('empresa_id')
    .eq('producto_id', productoId)
    .returns<Array<{ empresa_id: string }>>()
  if (error) throw error
  return (data ?? []).map((fila) => fila.empresa_id)
}

export async function definirEmpresasProducto(cliente: Pick<SupabaseClient, 'rpc'>, productoId: string, empresaIds: readonly string[]): Promise<void> {
  const { error } = await cliente.rpc('definir_empresas_producto', { p_producto_id: productoId, p_empresa_ids: [...empresaIds] })
  if (error) throw error
}
