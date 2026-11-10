import { useCallback, useEffect, useState } from 'react'
import { useFuenteTienda } from '../lib/fuenteTienda'
import { leerCategoriasPublicas, type CategoriaPublica } from '../lib/tiendaCategorias'

export type EstadoCategoriasTienda =
  | { fase: 'cargando'; categorias: CategoriaPublica[] }
  | { fase: 'error'; categorias: CategoriaPublica[] }
  | { fase: 'lista'; categorias: CategoriaPublica[] }

export type CategoriasTienda = EstadoCategoriasTienda & { reintentar: () => void }

type Resultado = { host: string; intento: number; error: boolean; categorias: CategoriaPublica[] }

// Categorías visibles de la tienda por host (F-TDA-11, FR-004/FR-005/FR-008). El layout la llama una
// sola vez y la comparten el menú, el pie y la página de categoría. Un error no rompe la página: el
// menú queda en «Inicio» y ofrece reintentar. Al cambiar de host no se muestran las del anterior.
export function useCategoriasTienda(host: string): CategoriasTienda {
  const fuente = useFuenteTienda()
  const [intento, setIntento] = useState(0)
  const [resultado, setResultado] = useState<Resultado | null>(null)

  useEffect(() => {
    // En la vista previa (F-TDA-06) las categorías llegan inyectadas: no se lee `publico.*`.
    if (fuente) return
    let cancelada = false
    leerCategoriasPublicas(host)
      .then((categorias) => { if (!cancelada) setResultado({ host, intento, error: false, categorias }) })
      .catch((error) => {
        console.error('No se pudieron cargar las categorías de la tienda', error instanceof Error ? error.message : error)
        if (!cancelada) setResultado({ host, intento, error: true, categorias: [] })
      })
    return () => { cancelada = true }
  }, [host, intento, fuente])

  const reintentar = useCallback(() => setIntento((actual) => actual + 1), [])

  if (fuente) return { fase: 'lista', categorias: fuente.categorias, reintentar }

  if (!resultado || resultado.host !== host || resultado.intento !== intento) {
    return { fase: 'cargando', categorias: [], reintentar }
  }
  return resultado.error
    ? { fase: 'error', categorias: [], reintentar }
    : { fase: 'lista', categorias: resultado.categorias, reintentar }
}
