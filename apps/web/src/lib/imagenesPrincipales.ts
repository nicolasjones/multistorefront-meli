import type { SupabaseClient } from '@supabase/supabase-js'
import { firmarImagenes } from './productoImagenes'

// Imagen principal (la de menor posición) de un conjunto de productos, con URL firmada de corta vida.
// Sirve a los listados que mencionan productos (stock, movimientos, faltantes…) para mostrar la miniatura
// con zoom (`MiniaturaProducto`). Un producto sin imagen, o cuya imagen no se pudo firmar, no aparece en el mapa.
// Tamaño de bloque de la consulta `.in('producto_id', …)`: con muchos ids la URL del GET se vuelve enorme y puede fallar.
export const TAMANO_BLOQUE_IMAGENES = 100

async function consultarBloque(
  cliente: Pick<SupabaseClient, 'schema' | 'storage'>,
  ids: readonly string[],
): Promise<Map<string, string>> {
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

export type ImagenesPrincipales = {
  /** `productoId → URL firmada` de los productos con imagen. */
  urls: Map<string, string>
  /** Ids de los bloques que NO se pudieron consultar: no significa «sin imagen», hay que reintentarlos. */
  fallidos: Set<string>
}

// Los ids se parten en bloques de `TAMANO_BLOQUE_IMAGENES`. Un bloque que falla no tumba a los demás (el listado se
// muestra igual, con placeholders en esos productos, y sus ids vuelven en `fallidos` para reintentarlos); si fallan
// TODOS, se propaga el primer error.
export async function consultarImagenesPrincipales(
  cliente: Pick<SupabaseClient, 'schema' | 'storage'>,
  productoIds: readonly string[],
): Promise<ImagenesPrincipales> {
  const ids = [...new Set(productoIds.filter(Boolean))]
  if (ids.length === 0) return { urls: new Map(), fallidos: new Set() }
  const bloques: string[][] = []
  for (let i = 0; i < ids.length; i += TAMANO_BLOQUE_IMAGENES) bloques.push(ids.slice(i, i + TAMANO_BLOQUE_IMAGENES))
  const resultados = await Promise.allSettled(bloques.map((bloque) => consultarBloque(cliente, bloque)))
  const fallidosBloques = resultados.filter((resultado): resultado is PromiseRejectedResult => resultado.status === 'rejected')
  if (fallidosBloques.length === resultados.length) throw fallidosBloques[0].reason
  for (const fallido of fallidosBloques) console.error('No pudimos cargar un bloque de imágenes de productos.', fallido.reason)
  const urls = new Map<string, string>()
  const fallidos = new Set<string>()
  resultados.forEach((resultado, indice) => {
    if (resultado.status === 'fulfilled') for (const [id, url] of resultado.value) urls.set(id, url)
    else for (const id of bloques[indice]) fallidos.add(id)
  })
  return { urls, fallidos }
}
