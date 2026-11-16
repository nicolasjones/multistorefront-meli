import { useCallback, useEffect, useState } from 'react'
import { urlsImagenesProducto } from '../lib/imagenProducto'
import { leerFichaProducto, type FichaProducto } from '../lib/tiendaFicha'

export type EstadoFichaProducto =
  | { fase: 'cargando' }
  | { fase: 'error' }
  | { fase: 'no-encontrada' }
  | { fase: 'lista'; ficha: FichaProducto; urls: Record<string, string> }

export type FichaPublica = EstadoFichaProducto & { reintentar: () => void }

type Resultado = { clave: string; estado: Exclude<EstadoFichaProducto, { fase: 'cargando' }> }

// Ficha de un producto de la tienda (F-TDA-13, FR-051/FR-056). Una llamada a la base más un firmado en
// lote de las imágenes. Si cambia el host o el producto, nunca se muestra la ficha anterior: se vuelve a
// «cargando» hasta que llega la nueva.
export function useFichaProducto(host: string, productoId: string): FichaPublica {
  const [intento, setIntento] = useState(0)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const clave = JSON.stringify([host, productoId, intento])

  useEffect(() => {
    let cancelada = false
    leerFichaProducto(host, productoId)
      .then(async (ficha) => {
        if (!ficha) {
          if (!cancelada) setResultado({ clave, estado: { fase: 'no-encontrada' } })
          return
        }
        const urls = await urlsImagenesProducto(ficha.imagenes.map((i) => i.ruta))
        if (!cancelada) setResultado({ clave, estado: { fase: 'lista', ficha, urls } })
      })
      .catch((error) => {
        console.error('No se pudo cargar la ficha del producto', error instanceof Error ? error.message : error)
        if (!cancelada) setResultado({ clave, estado: { fase: 'error' } })
      })
    return () => { cancelada = true }
    // `clave` resume host, producto e intento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  const reintentar = useCallback(() => setIntento((actual) => actual + 1), [])

  if (!resultado || resultado.clave !== clave) return { fase: 'cargando', reintentar }
  return { ...resultado.estado, reintentar }
}
