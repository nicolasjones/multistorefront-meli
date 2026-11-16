import { useCallback, useEffect, useState } from 'react'
import { leerPaginaPublica, type PaginaPublica } from '../lib/tiendaPaginas'

export type EstadoPaginaTienda =
  | { fase: 'cargando' }
  | { fase: 'error' }
  | { fase: 'no-encontrada' }
  | { fase: 'lista'; pagina: PaginaPublica }

export type PaginaTiendaPublica = EstadoPaginaTienda & { reintentar: () => void }

type Resultado = { clave: string; estado: Exclude<EstadoPaginaTienda, { fase: 'cargando' }> }

// Página de contenido de la tienda por host y slug (F-TDA-23, FR-006). Si cambia el host o el slug nunca se
// muestra la página anterior: se vuelve a «cargando» hasta que llega la nueva. Inexistente, oculta, de otra
// empresa o tienda pausada dan lo mismo (`no-encontrada`).
export function usePaginaTienda(host: string, slug: string): PaginaTiendaPublica {
  const [intento, setIntento] = useState(0)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const clave = JSON.stringify([host, slug, intento])

  useEffect(() => {
    // Sin slug no hay nada que pedir: es la 404 de la tienda.
    if (!slug) return
    let cancelada = false
    leerPaginaPublica(host, slug)
      .then((pagina) => {
        if (cancelada) return
        setResultado({ clave, estado: pagina ? { fase: 'lista', pagina } : { fase: 'no-encontrada' } })
      })
      .catch((error) => {
        console.error('No se pudo cargar la página de la tienda', error instanceof Error ? error.message : error)
        if (!cancelada) setResultado({ clave, estado: { fase: 'error' } })
      })
    return () => { cancelada = true }
    // `clave` resume host, slug e intento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  const reintentar = useCallback(() => setIntento((actual) => actual + 1), [])

  if (!slug) return { fase: 'no-encontrada', reintentar }
  if (!resultado || resultado.clave !== clave) return { fase: 'cargando', reintentar }
  return { ...resultado.estado, reintentar }
}
