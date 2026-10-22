import { useCallback, useEffect, useState } from 'react'
import { Box } from '@mui/material'
import { resolverTienda, type TiendaPublica } from '../../lib/tienda'
import { EstadoCargaPagina, EstadoError } from '../../components/estados/EstadosPagina'
import { PaginaTienda } from './PaginaTienda'
import { VolvemosPronto } from './VolvemosPronto'

type Estado =
  | { fase: 'cargando' }
  | { fase: 'error' }
  | { fase: 'lista'; tienda: TiendaPublica | null }

// Entrada del front público (FR-007): resuelve la tienda por el `Host` de la petición, sin
// sesión. Dominio desconocido y tienda desactivada llegan igual (sin tienda) y muestran la misma
// «Volvemos pronto» (FR-003, SC-004). Un error de red NO se disfraza de «Volvemos pronto»: se
// ofrece reintentar.
export function TiendaPublicaApp({ host = window.location.host }: { host?: string }) {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' })
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    let cancelada = false
    resolverTienda(host)
      .then((tienda) => { if (!cancelada) setEstado({ fase: 'lista', tienda }) })
      .catch((error) => {
        console.error('No se pudo resolver la tienda', error instanceof Error ? error.message : error)
        if (!cancelada) setEstado({ fase: 'error' })
      })
    return () => { cancelada = true }
  }, [host, intento])

  const reintentar = useCallback(() => {
    setEstado({ fase: 'cargando' })
    setIntento((actual) => actual + 1)
  }, [])

  if (estado.fase === 'cargando') {
    return <Box component="main" sx={{ p: 2 }}><EstadoCargaPagina /></Box>
  }
  if (estado.fase === 'error') {
    return (
      <Box component="main" sx={{ p: 2 }}>
        <EstadoError titulo="No pudimos cargar la tienda." descripcion="Revisá tu conexión e intentá de nuevo." reintentar={reintentar} />
      </Box>
    )
  }
  if (estado.tienda === null) {
    return <VolvemosPronto />
  }
  return <PaginaTienda tienda={estado.tienda} host={host} />
}

export default TiendaPublicaApp
