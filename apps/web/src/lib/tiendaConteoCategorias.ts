// MSF-623: la base cuenta por categoría solo los productos asignados directamente a ella (un producto tiene una sola
// categoría), así que una categoría raíz con productos solo en sus subcategorías decía «0 productos». El conteo que
// ve la persona es el de la categoría más el de todas sus descendientes; no se cuenta dos veces porque cada
// producto pertenece a una única categoría.
export function acumularConteoCategorias<T extends { id: string; padreId: string | null; productos: number }>(categorias: T[]): T[] {
  const hijos = new Map<string, T[]>()
  for (const categoria of categorias) {
    if (categoria.padreId === null) continue
    hijos.set(categoria.padreId, [...(hijos.get(categoria.padreId) ?? []), categoria])
  }
  const total = (categoria: T, visitadas: Set<string>): number => {
    if (visitadas.has(categoria.id)) return 0
    const siguientes = new Set(visitadas).add(categoria.id)
    return categoria.productos + (hijos.get(categoria.id) ?? []).reduce((suma, hijo) => suma + total(hijo, siguientes), 0)
  }
  return categorias.map((categoria) => ({ ...categoria, productos: total(categoria, new Set()) }))
}
