import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react'
import { useFuenteTienda } from '../lib/fuenteTienda'
import { leerContenidoPublico, type ContenidoTienda } from '../lib/tiendaContenido'

// Contenido público de la tienda por host (F-TDA-03, FR-036). Las secciones de la home lo comparten
// (una sola petición por host). Un error de lectura no rompe la página: las secciones de texto son
// decorativas, así que se registra y no se muestra nada (nunca un texto a medias).
//
// MSF-841: el layout de la tienda lo lee UNA vez por host (`ProveedorContenidoTienda`) y lo comparten la barra
// superior, el pie y las secciones; sin proveedor (vista previa, tests) cada uso lee por su cuenta.
const ContextoContenido = createContext<{ contenido: ContenidoTienda | null } | null>(null)

export function ProveedorContenidoTienda({ host, children }: { host: string; children: ReactNode }) {
  const contenido = useLeerContenido(host, true)
  return createElement(ContextoContenido.Provider, { value: { contenido } }, children)
}

export function useContenidoPublico(host: string): ContenidoTienda | null {
  const compartido = useContext(ContextoContenido)
  const propio = useLeerContenido(host, compartido === null)
  return compartido ? compartido.contenido : propio
}

function useLeerContenido(host: string, activo: boolean): ContenidoTienda | null {
  const fuente = useFuenteTienda()
  const [contenido, setContenido] = useState<{ host: string; valor: ContenidoTienda | null } | null>(null)

  useEffect(() => {
    // En la vista previa (F-TDA-06) el contenido llega inyectado: no se lee `publico.*`.
    if (fuente || !activo) return
    let cancelada = false
    leerContenidoPublico(host)
      .then((valor) => { if (!cancelada) setContenido({ host, valor }) })
      .catch((error) => {
        console.error('No se pudo cargar el contenido de la tienda', error instanceof Error ? error.message : error)
        if (!cancelada) setContenido({ host, valor: null })
      })
    return () => { cancelada = true }
  }, [host, fuente, activo])

  if (fuente) return fuente.contenido
  return contenido?.host === host ? contenido.valor : null
}
