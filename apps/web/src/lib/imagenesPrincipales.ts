import type { SupabaseClient } from '@supabase/supabase-js'
import { firmarImagenes } from './productoImagenes'

// Imagen principal (la de menor posición) de un conjunto de productos, con URL firmada de corta vida.
// Sirve a los listados que mencionan productos (stock, movimientos, faltantes…) para mostrar la miniatura
// con zoom (`MiniaturaProducto`). Un producto sin imagen, o cuya imagen no se pudo firmar, no aparece en el mapa.
export async function consultarImagenesPrincipales(
  cliente: Pick<SupabaseClient, 'schema' | 'storage'>,
  productoIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(productoIds.filter(Boolean))]
  if (ids.length === 0) return new Map()
  const { data, error } = await cliente
    .schema('dominio')
    .from('producto_imagenes')
    .select('producto_id, ruta, posicion')
    .in('producto_id', ids)
    .order('posicion')
    .returns<Array<{ producto_id: string; ruta: string; posicion: number }>>()
  if (error) throw error
  // Ordenadas por posición: la primera de cada producto es la principal.
  const principal = new Map<string, string>()
  for (const fila of data ?? []) if (!principal.has(fila.producto_id)) principal.set(fila.producto_id, fila.ruta)
  const firmadas = await firmarImagenes(
    cliente,
    [...principal].map(([productoId, ruta]) => ({ id: productoId, posicion: 1, ruta })),
  )
  const urls = new Map<string, string>()
  for (const firmada of firmadas) if (firmada.url) urls.set(firmada.id, firmada.url)
  return urls
}
