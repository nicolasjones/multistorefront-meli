import { useSyncExternalStore } from 'react'

// Categoría elegida en las píldoras de la portada de celular (prototipo `MJC_M_Home`: las píldoras filtran los destacados en su
// lugar). Estado compartido entre «Categorías» (las píldoras) y «Destacados» (la lista filtrada): son secciones hermanas que
// no se conocen. `ids` incluye la categoría y sus subcategorías (los destacados pueden ser de una subcategoría).
export type CategoriaInicio = { id: string; nombre: string; ids: ReadonlySet<string> } | null

let actual: CategoriaInicio = null
const oyentes = new Set<() => void>()

export function elegirCategoriaInicio(categoria: CategoriaInicio) {
  actual = categoria
  oyentes.forEach((oyente) => oyente())
}

export function useCategoriaInicio(): CategoriaInicio {
  return useSyncExternalStore(
    (oyente) => { oyentes.add(oyente); return () => { oyentes.delete(oyente) } },
    () => actual,
    () => null,
  )
}
