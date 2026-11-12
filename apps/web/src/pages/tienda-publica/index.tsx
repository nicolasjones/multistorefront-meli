import { useCallback, useEffect, useState } from 'react'
import { Box } from '@mui/material'
import { resolverRedireccion, resolverTienda, urlDeRedireccion, type TiendaPublica } from '../../lib/tienda'
import { EstadoCargaPagina } from '../../components/estados/EstadosPagina'
import { EnrutadorTienda } from './EnrutadorTienda'
import { VolvemosPronto } from './VolvemosPronto'
import { PantallaError } from './PantallaError'
import { useEstadoTienda } from '../../lib/tiendaEstado'

type Estado =
  | { fase: 'cargando' }
  | { fase: 'redirigiendo' }
  | { fase: 'error' }
  | { fase: 'lista'; tienda: TiendaPublica | null }

// Host sin tienda publicada (F-TDA-19): una tienda desactivada muestra «Volvemos pronto» con su marca (D1);
// un dominio desconocido, la versión genérica. Un error de red NO se disfraza de ninguna de las dos: se
// ofrece reintentar.
function SinTienda({ host }: { host: string }) {
  const { estado, reintentar } = useEstadoTienda(host)
  if (estado.fase === 'cargando') {
    return <Box component="main" sx={{ p: 2 }}><EstadoCargaPagina /></Box>
  }
  if (estado.fase === 'error') {
    return <PantallaError alReintentar={reintentar} />
  }
  return <VolvemosPronto marca={estado.fase === 'pausada' ? estado.marca : undefined} />
}

// Entrada del front público (FR-007): resuelve la tienda por el `Host` de la petición, sin
// sesión. Sin tienda (dominio desconocido o empresa desactivada) se distingue en `SinTienda`.
// Un error de red NO se disfraza de «Volvemos pronto»: se ofrece reintentar.
const irA = (url: string) => window.location.replace(url)

export function TiendaPublicaApp({
  host = window.location.host,
  redirigir = irA,
}: {
  host?: string
  redirigir?: (url: string) => void
}) {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' })
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    let cancelada = false
    // Un host que no es tienda puede ser el «Redirigir también» de una (F-TDA-05, FR-013): se lo manda al
    // principal. Desconocido y desactivada siguen igual que antes («Volvemos pronto»).
    resolverTienda(host)
      .then(async (tienda) => {
        const principal = tienda ? null : await resolverRedireccion(host)
        if (cancelada) return
        if (principal) {
          setEstado({ fase: 'redirigiendo' })
          redirigir(urlDeRedireccion(principal))
          return
        }
        setEstado({ fase: 'lista', tienda })
      })
      .catch((error) => {
        console.error('No se pudo resolver la tienda', error instanceof Error ? error.message : error)
        if (!cancelada) setEstado({ fase: 'error' })
      })
    return () => { cancelada = true }
  }, [host, intento, redirigir])

  const reintentar = useCallback(() => {
    setEstado({ fase: 'cargando' })
    setIntento((actual) => actual + 1)
  }, [])

  if (estado.fase === 'cargando' || estado.fase === 'redirigiendo') {
    return <Box component="main" sx={{ p: 2 }}><EstadoCargaPagina /></Box>
  }
  if (estado.fase === 'error') {
    return <PantallaError alReintentar={reintentar} />
  }
  if (estado.tienda === null) {
    return <SinTienda host={host} />
  }
  return <EnrutadorTienda tienda={estado.tienda} host={host} />
}
