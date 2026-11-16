import { Box, Stack, Typography } from '@mui/material'
import { useNombreRolActual } from '../../hooks/useNombreRolActual'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { EstadoCargaPagina } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { AccesoRestringido } from '../acceso-restringido/AccesoRestringido'
import { PanelClaves } from './PanelClaves'
import { PanelSuscripciones } from './PanelSuscripciones'
import { PanelEntregas } from './PanelEntregas'
import { PanelLlamadas } from './PanelLlamadas'

// Pantalla «API» (F-API-01, FR-013, FR-014): claves, suscripciones a avisos,
// entregas y llamadas recientes. Solo el Administrador.
//
// Es una pantalla POR ORGANIZACIÓN: no lee ni escribe datos de una empresa
// concreta, así que no depende de la empresa activa (spec, «Empresa activa: no
// aplica»).
export function ApiList() {
  const { puedeEscribir, isLoading } = usePuedeEscribir()
  const rol = useNombreRolActual(puedeEscribir === false)
  if (isLoading || puedeEscribir === null) return <EstadoCargaPagina />
  if (!puedeEscribir) {
    // Mientras se resuelve el rol no se muestra el literal «actual» (MSF-637).
    if (rol === null) return <EstadoCargaPagina />
    return <AccesoRestringido rol={rol} seccion="API" />
  }

  return (
    <Box>
      <EncabezadoPagina
        titulo="API"
        descripcion="Claves de lectura, avisos automáticos y auditoría de las llamadas a la API de tu organización."
      />
      <ContenedorSeccion>
        <Stack spacing={4}>
          <Box component="section" aria-labelledby="panel-claves">
            <Typography id="panel-claves" component="h2" variant="h6" sx={{ mb: 2 }}>Claves</Typography>
            <PanelClaves />
          </Box>
          <Box component="section" aria-labelledby="panel-suscripciones">
            <Typography id="panel-suscripciones" component="h2" variant="h6" sx={{ mb: 2 }}>Suscripciones a avisos</Typography>
            <PanelSuscripciones />
          </Box>
          <Box component="section" aria-labelledby="panel-entregas">
            <Typography id="panel-entregas" component="h2" variant="h6" sx={{ mb: 2 }}>Entregas recientes</Typography>
            <PanelEntregas />
          </Box>
          <Box component="section" aria-labelledby="panel-llamadas">
            <Typography id="panel-llamadas" component="h2" variant="h6" sx={{ mb: 2 }}>Llamadas recientes</Typography>
            <PanelLlamadas />
          </Box>
        </Stack>
      </ContenedorSeccion>
    </Box>
  )
}
