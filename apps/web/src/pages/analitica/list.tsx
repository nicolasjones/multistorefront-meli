import { useState } from 'react'
import { Box, FormControl, InputLabel, MenuItem, Select, type SelectChangeEvent, Typography } from '@mui/material'
import { useReportesAsignados } from '../../hooks/useReportesAsignados'
import { ReporteEmbebido } from '../../components/ReporteEmbebido'
import { EstadoCargaPagina, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

// US2: reportes visibles para el usuario actual, embebidos al seleccionar
// uno. La lista misma ya viene filtrada por RLS (useReportesAsignados) —
// acá solo se resuelve la UX de "sin reportes configurados" (FR-011).
//
// Selector como dropdown (no una lista lateral): con un solo reporte
// posible a la vez, un panel fijo al costado le robaba ancho al reporte
// en sí sin aportar nada que un <Select> no resuelva más compacto.
export function AnaliticaList() {
  const { reportes, isLoading } = useReportesAsignados()
  const [reporteSeleccionado, setReporteSeleccionado] = useState<string>('')

  if (isLoading) {
    return (
      <Box>
        <EncabezadoPagina titulo="Analítica" contexto={<ContextoOrganizacionActiva />} />
        <ContenedorSeccion>
          <EstadoCargaPagina />
        </ContenedorSeccion>
      </Box>
    )
  }

  if (reportes.length === 0) {
    return (
      <Box>
        <EncabezadoPagina titulo="Analítica" contexto={<ContextoOrganizacionActiva />} />
        <ContenedorSeccion>
          <EstadoVacio titulo="Todavía no tenés reportes configurados para tu organización." />
        </ContenedorSeccion>
      </Box>
    )
  }

  const handleChange = (event: SelectChangeEvent) => {
    setReporteSeleccionado(event.target.value)
  }

  return (
    <Box>
      <EncabezadoPagina titulo="Analítica" contexto={<ContextoOrganizacionActiva />} />
      <ContenedorSeccion>
        <FormControl size="small" sx={{ minWidth: 280, mb: 2 }}>
          <InputLabel id="analitica-reporte-label">Reporte</InputLabel>
          <Select
            labelId="analitica-reporte-label"
            label="Reporte"
            value={reporteSeleccionado}
            onChange={handleChange}
          >
            {reportes.map((reporte) => (
              <MenuItem key={reporte.id} value={reporte.id}>
                {reporte.nombre}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {reporteSeleccionado ? (
          <ReporteEmbebido key={reporteSeleccionado} reporteId={reporteSeleccionado} />
        ) : (
          <Typography color="text.secondary">Elegí un reporte para verlo.</Typography>
        )}
      </ContenedorSeccion>
    </Box>
  )
}
