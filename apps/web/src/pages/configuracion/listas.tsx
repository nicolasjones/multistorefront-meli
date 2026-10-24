import { Box, Stack, Typography } from '@mui/material'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { EstadoCargaPagina } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { AccesoRestringido } from '../acceso-restringido/AccesoRestringido'
import { PanelMotivos } from '../stock/motivos'
import { PanelEstadosConsulta } from './PanelEstadosConsulta'

// Listas configurables (F-CFG-01, FR-013): motivos de stock y estados de consulta. Solo el
// Administrador; es una lista de la organización, no depende de la empresa activa (spec,
// «Empresa activa: no aplica»). Los motivos son la misma tabla que /stock/motivos.
export function ListasConfigurables() {
  const { puedeEscribir, isLoading } = usePuedeEscribir()
  if (isLoading || puedeEscribir === null) return <EstadoCargaPagina />
  if (!puedeEscribir) return <AccesoRestringido rol="actual" seccion="Listas configurables" />

  return (
    <Box>
      <EncabezadoPagina titulo="Listas configurables" descripcion="Adaptá las listas del negocio: motivos de stock y estados de consulta." />
      <ContenedorSeccion>
        <Stack spacing={4}>
          <Box component="section" aria-labelledby="lista-motivos">
            <Typography id="lista-motivos" component="h2" variant="h6" sx={{ mb: 2 }}>Motivos de stock</Typography>
            <PanelMotivos />
          </Box>
          <Box component="section" aria-labelledby="lista-estados-consulta">
            <Typography id="lista-estados-consulta" component="h2" variant="h6" sx={{ mb: 2 }}>Estados de consulta</Typography>
            <PanelEstadosConsulta />
          </Box>
        </Stack>
      </ContenedorSeccion>
    </Box>
  )
}
