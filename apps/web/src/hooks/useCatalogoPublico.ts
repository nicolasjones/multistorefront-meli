import { useCallback, useEffect, useState } from 'react'
import { urlsImagenesProducto } from '../lib/imagenProducto'
import { leerPaginaBusqueda } from '../lib/tiendaBusqueda'
import { leerPaginaCatalogo, type FiltrosCatalogo, type PaginaCatalogo } from '../lib/tiendaListado'

export type EstadoCatalogoPublico =
  | { fase: 'cargando' }
  | { fase: 'error' }
  | { fase: 'lista'; pagina: PaginaCatalogo; imagenes: Record<string, string> }

export type CatalogoPublico = EstadoCatalogoPublico & { reintentar: () => void }

type Resultado = { clave: string; estado: Exclude<EstadoCatalogoPublico, { fase: 'cargando' }> }

// Página del catálogo público (F-TDA-12, FR-040/FR-041). Una llamada por página más un firmado en
// lote de las imágenes. Cambiar filtros u orden pide la página nueva sin recargar la navegación; mientras
// llega, o si cambió el host, nunca se muestran los resultados anteriores (se vuelve a «cargando»).
// Con `q` (F-TDA-15, FR-025) lee la búsqueda en vez del catálogo; el resto del flujo es el mismo.
export function useCatalogoPublico(host: string, filtros: FiltrosCatalogo, q: string | null = null): CatalogoPublico {
  const [intento, setIntento] = useState(0)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const clave = JSON.stringify([host, filtros, q, intento])

  useEffect(() => {
    let cancelada = false
    const lectura = q ? leerPaginaBusqueda(host, q, filtros) : leerPaginaCatalogo(host, filtros)
    lectura
      .then(async (pagina) => {
        const rutas = pagina.productos.flatMap((p) => (p.imagen ? [p.imagen] : []))
        const imagenes = await urlsImagenesProducto(rutas)
        if (!cancelada) setResultado({ clave, estado: { fase: 'lista', pagina, imagenes } })
      })
      .catch((error) => {
        console.error('No se pudo cargar el catálogo de la tienda', error instanceof Error ? error.message : error)
        if (!cancelada) setResultado({ clave, estado: { fase: 'error' } })
      })
    return () => { cancelada = true }
    // `clave` resume host, filtros, q e intento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  const reintentar = useCallback(() => setIntento((actual) => actual + 1), [])

  if (!resultado || resultado.clave !== clave) return { fase: 'cargando', reintentar }
  return { ...resultado.estado, reintentar }
}
