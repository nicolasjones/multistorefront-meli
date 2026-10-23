import { useEffect, useState } from 'react'
import { leerContenidoPublico, type ContenidoTienda } from '../lib/tiendaContenido'

// Contenido público de la tienda por host (F-TDA-03, FR-036). Las secciones de la home lo comparten
// (una sola petición por host). Un error de lectura no rompe la página: las secciones de texto son
// decorativas, así que se registra y no se muestra nada (nunca un texto a medias).
export function useContenidoPublico(host: string): ContenidoTienda | null {
  const [contenido, setContenido] = useState<{ host: string; valor: ContenidoTienda | null } | null>(null)

  useEffect(() => {
    let cancelada = false
    leerContenidoPublico(host)
      .then((valor) => { if (!cancelada) setContenido({ host, valor }) })
      .catch((error) => {
        console.error('No se pudo cargar el contenido de la tienda', error instanceof Error ? error.message : error)
        if (!cancelada) setContenido({ host, valor: null })
      })
    return () => { cancelada = true }
  }, [host])

  return contenido?.host === host ? contenido.valor : null
}
