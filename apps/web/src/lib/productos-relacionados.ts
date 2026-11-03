// Productos relacionados (F-CAT-18, MSF-416, FR-013…FR-018). La autoridad es la base: la RPC
// `guardar_relacionados` (migración 20270125110000) exige edición en Productos y rechaza el propio
// producto, repetidos y productos de otra organización; `v_producto_relacionados` es el contrato de
// lectura. Acá solo se arma la consulta del buscador, el payload y los mensajes.
import type { SupabaseClient } from '@supabase/supabase-js'
import { LARGO_MAXIMO_BUSQUEDA } from './productosListado'

export const TOPE_RESULTADOS_RELACIONADOS = 4

export type Relacionado = {
  id: string
  nombre: string
  sku: string | null
  categoria: string | null
  precio: number | string | null
  moneda: string | null
}

const FORMATO_PRECIO = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// «SKU · categoría · precio»; lo que falta se muestra como «—».
export function detalleRelacionado(item: Relacionado): string {
  const numero = item.precio === null || item.precio === '' ? Number.NaN : Number(item.precio)
  const precio = Number.isFinite(numero) ? `${item.moneda === 'USD' ? 'USD' : '$'} ${FORMATO_PRECIO.format(numero)}` : '—'
  return `${item.sku ?? '—'} · ${item.categoria ?? '—'} · ${precio}`
}

export function etiquetaContador(cantidad: number): string {
  return `${cantidad} ${cantidad === 1 ? 'producto' : 'productos'}`
}

// Mueve el elemento `indice` una posición (−1 sube, +1 baja); en los extremos no hace nada.
export function moverRelacionado<T>(lista: readonly T[], indice: number, delta: -1 | 1): T[] {
  const destino = indice + delta
  if (indice < 0 || indice >= lista.length || destino < 0 || destino >= lista.length) return [...lista]
  const copia = [...lista]
  ;[copia[indice], copia[destino]] = [copia[destino], copia[indice]]
  return copia
}

// Cambió la lista (los mismos productos en el mismo orden no cuentan).
export function relacionadosCambiaron(actual: readonly string[], inicial: readonly string[]): boolean {
  return actual.length !== inicial.length || actual.some((id, indice) => id !== inicial[indice])
}

// Arma el filtro `or` de PostgREST por nombre, SKU o categoría con el mismo saneamiento del listado:
// se acota el largo, se quitan los separadores de PostgREST y se escapan los comodines de LIKE.
export function filtroBuscadorRelacionados(texto: string): string | null {
  const limpio = texto
    .slice(0, LARGO_MAXIMO_BUSQUEDA)
    .replace(/[,()"\\*]/g, ' ')
    .replace(/[%_]/g, (c) => `\\${c}`)
    .trim()
  if (limpio === '') return null
  return `nombre.ilike.%${limpio}%,sku.ilike.%${limpio}%,categoria_ruta.ilike.%${limpio}%`
}

type FilaBusqueda = { id: string; nombre: string; sku: string | null; categoria_ruta: string | null }
type FilaPrecio = { id: string; precio_lista: number | string; moneda: string }

// Hasta 4 productos por nombre, SKU o categoría, sin el propio ni los ya agregados. El precio no está en
// el listado: se lee de `dominio.productos` solo para los resultados (RLS de la organización).
export async function buscarRelacionables(
  cliente: Pick<SupabaseClient, 'from' | 'schema'>,
  texto: string,
  excluirIds: readonly string[],
): Promise<Relacionado[]> {
  const filtro = filtroBuscadorRelacionados(texto)
  if (!filtro) return []
  let peticion = cliente.from('v_productos_listado').select('id, nombre, sku, categoria_ruta').or(filtro)
  // Los ids son uuid de la base (no texto del usuario): van entre paréntesis como pide PostgREST.
  if (excluirIds.length > 0) peticion = peticion.not('id', 'in', `(${excluirIds.join(',')})`)
  const { data, error } = await peticion
    .order('nombre', { ascending: true })
    .order('id', { ascending: true })
    .limit(TOPE_RESULTADOS_RELACIONADOS)
    .returns<FilaBusqueda[]>()
  if (error) throw error
  const filas = data ?? []
  if (filas.length === 0) return []
  const { data: precios, error: errorPrecios } = await cliente
    .schema('dominio')
    .from('productos')
    .select('id, precio_lista, moneda')
    .in('id', filas.map((fila) => fila.id))
    .returns<FilaPrecio[]>()
  if (errorPrecios) throw errorPrecios
  const porId = new Map((precios ?? []).map((fila) => [fila.id, fila]))
  return filas.map((fila) => ({
    id: fila.id,
    nombre: fila.nombre,
    sku: fila.sku,
    categoria: fila.categoria_ruta,
    precio: porId.get(fila.id)?.precio_lista ?? null,
    moneda: porId.get(fila.id)?.moneda ?? null,
  }))
}

type FilaVista = { relacionado_id: string; orden: number; nombre: string; sku: string | null; categoria: string | null; precio: number | string | null; moneda: string | null }

// Relacionados del producto en el orden guardado (el que ve el cliente).
export async function leerRelacionados(cliente: Pick<SupabaseClient, 'from'>, productoId: string): Promise<Relacionado[]> {
  const { data, error } = await cliente
    .from('v_producto_relacionados')
    .select('relacionado_id, orden, nombre, sku, categoria, precio, moneda')
    .eq('producto_id', productoId)
    .order('orden', { ascending: true })
    .returns<FilaVista[]>()
  if (error) throw error
  return (data ?? []).map((fila) => ({ id: fila.relacionado_id, nombre: fila.nombre, sku: fila.sku, categoria: fila.categoria, precio: fila.precio, moneda: fila.moneda }))
}

// Payload de `guardar_relacionados`: el orden del arreglo es el orden que ve el cliente.
export function parametrosGuardarRelacionados(productoId: string, ids: readonly string[]): { p_producto: string; p_relacionados: string[] } {
  return { p_producto: productoId, p_relacionados: [...ids] }
}

export async function guardarRelacionados(cliente: Pick<SupabaseClient, 'rpc'>, productoId: string, ids: readonly string[]): Promise<void> {
  const { error } = await cliente.rpc('guardar_relacionados', parametrosGuardarRelacionados(productoId, ids))
  if (error) throw error
}

// El mensaje crudo de Postgres no va al usuario; el detalle queda en consola.
export function mensajeErrorRelacionados(error: unknown): string {
  console.error('No pudimos guardar los productos relacionados.', error)
  const code = (error as { code?: string } | null)?.code
  if (code === '42501') return 'No tenés permiso para editar los relacionados. Puede que tu rol haya cambiado: recargá la página.'
  if (code === 'P0002') return 'Alguno de los productos ya no existe. Quitalo de la lista e intentá de nuevo.'
  if (code === '22023') return 'La lista de relacionados no es válida: un producto no puede relacionarse consigo mismo ni repetirse.'
  return 'No pudimos guardar los productos relacionados. Probá de nuevo.'
}
