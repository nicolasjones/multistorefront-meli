import { useEffect, useState } from 'react'
import { leerNewsletterTienda, type NewsletterTienda } from '../lib/tiendaNewsletter'

// MSF-468 (RF-NL-2): el pie de la tienda muestra el formulario solo si la base dice `activo` (bandera `newsletter`, interruptor de la
// tienda y tienda activa). Mientras carga o si la lectura falla, no se muestra nada: nunca se expone el formulario por error.
export function useNewsletterTienda(host: string): NewsletterTienda {
  const [estado, setEstado] = useState<{ host: string; valor: NewsletterTienda } | null>(null)

  useEffect(() => {
    if (!host) return
    let cancelada = false
    leerNewsletterTienda(host)
      .then((valor) => { if (!cancelada) setEstado({ host, valor }) })
      .catch((error) => {
        console.error('No se pudo leer el estado del newsletter', error instanceof Error ? error.message : error)
        if (!cancelada) setEstado({ host, valor: { activo: false, tienda: null } })
      })
    return () => { cancelada = true }
  }, [host])

  return estado && estado.host === host ? estado.valor : { activo: false, tienda: null }
}
