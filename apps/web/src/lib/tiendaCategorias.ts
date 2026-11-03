import { supabaseClient } from './supabase'

// F-TDA-11 (MSF-386): categorías visibles de la tienda pública. La visibilidad (la categoría y su
// padre), el orden de Catálogo y el conteo de productos efectivamente visibles los calcula la base
// (migración 20261023150000_tienda_categorias_publicas.sql); acá solo se lee.

export type CategoriaPublica = {
  id: string
  nombre: string
  padreId: string | null
  productos: number
}

type FilaCategorias = {
  categorias: Array<{ id: string; nombre: string; padre_id: string | null; productos: number }>
}

// publico.categorias_por_dominio es ejecutable por anon (sin sesión). Dominio desconocido o empresa
// desactivada devuelven null (FR-002): para el front es lo mismo que una tienda sin categorías.
// Profundidad de cada categoría en el árbol de la tienda (1 = raíz, 2 = subcategoría, 3 = sub
// subcategoría): la base devuelve la lista plana con el padre de cada una y el filtro la sangra.
export function profundidadCategorias(categorias: readonly { id: string; padreId: string | null }[]): Map<string, number> {
  const porId = new Map(categorias.map((categoria) => [categoria.id, categoria]))
  const profundidad = new Map<string, number>()
  const nivel = (categoria: { id: string; padreId: string | null }, vistos: Set<string>): number => {
    const guardado = profundidad.get(categoria.id)
    if (guardado !== undefined) return guardado
    const padre = categoria.padreId ? porId.get(categoria.padreId) : undefined
    if (!padre || vistos.has(categoria.id)) return 1
    vistos.add(categoria.id)
    const valor = nivel(padre, vistos) + 1
    profundidad.set(categoria.id, valor)
    return valor
  }
  for (const categoria of categorias) nivel(categoria, new Set())
  return profundidad
}

export async function leerCategoriasPublicas(host: string): Promise<CategoriaPublica[]> {
  const { data, error } = await supabaseClient.schema('publico').rpc('categorias_por_dominio', { host })
  if (error) {
    throw new Error(error.message)
  }
  if (!data) {
    return []
  }
  return (data as FilaCategorias).categorias.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    padreId: c.padre_id,
    productos: c.productos,
  }))
}
