import { useEffect, useState } from 'react'
import { leerEnlacesPaginas, type EnlacePagina } from '../lib/tiendaPaginas'

// Enlaces a las páginas visibles de la tienda para el pie (F-TDA-23, FR-007). Un fallo no rompe el pie: se
// registra y la columna «Información» simplemente no aparece (sin error propio).
export function useEnlacesPaginas(host: string): EnlacePagina[] {
  const [lectura, setLectura] = useState<{ host: string; enlaces: EnlacePagina[] } | null>(null)

  useEffect(() => {
    let cancelada = false
    leerEnlacesPaginas(host)
      .then((enlaces) => { if (!cancelada) setLectura({ host, enlaces: enlaces ?? [] }) })
      .catch((error) => {
        console.error('No se pudieron cargar las páginas del pie', error instanceof Error ? error.message : error)
        if (!cancelada) setLectura({ host, enlaces: [] })
      })
    return () => { cancelada = true }
  }, [host])

  return lectura?.host === host ? lectura.enlaces : []
}
