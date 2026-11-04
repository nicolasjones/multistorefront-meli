import { useState } from 'react'
import { Box, Stack } from '@mui/material'
import { ReporteEmbebido, type MotivoFalloReporte } from '../../components/ReporteEmbebido'
import { EstadoCargaPagina, EstadoError } from '../../components/estados/EstadosPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { PestanasService } from '../../components/service/PestanasService'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { useReportesAsignados } from '../../hooks/useReportesAsignados'
import { NOMBRE_REPORTE_SERVICE } from '../../lib/serviceTecnico'
import { AccesoRestringido } from '../acceso-restringido/AccesoRestringido'

const SECCION = 'service_tecnico'

// Service técnico · Reportes (F-SVC-23, FR-064/FR-065). El tablero «Service técnico» es de Superset
// (`ReporteEmbebido`); compara TODAS las tiendas de la organización, así que no depende de la empresa activa de
// la barra superior (Principio VIII, no aplica; ver la matriz de la spec). Sin `lectura` en `service_tecnico` o
// ante un 403 del token se muestra «Acceso restringido» y no se pide token.
export function ServicioReportes() {
  const { nivel, isLoading: cargandoNivel } = useNivelSeccion(SECCION)
  const sinAcceso = nivel !== null && nivel !== 'lectura' && nivel !== 'edicion'
  const { reportes, isLoading: cargandoReportes } = useReportesAsignados()
  // Cada intento remonta el tablero: repite la solicitud del token y el montaje.
  const [intento, setIntento] = useState(0)
  const [fallo, setFallo] = useState<MotivoFalloReporte | null>(null)

  if (sinAcceso || fallo === 'prohibido') {
    return <AccesoRestringido rol="actual" seccion="Servicio técnico" seccionClave={SECCION} />
  }

  const reporte = reportes.find((candidato) => candidato.nombre === NOMBRE_REPORTE_SERVICE)
  const reintentar = () => {
    setFallo(null)
    setIntento((anterior) => anterior + 1)
  }

  let tablero
  if (cargandoNivel || cargandoReportes) tablero = <EstadoCargaPagina />
  else if (!reporte) tablero = <EstadoError descripcion="El tablero de Service técnico todavía no está disponible para tu organización." />
  else if (fallo === 'no_disponible') tablero = <EstadoError descripcion="No pudimos cargar el tablero de Service técnico." reintentar={reintentar} />
  else tablero = <ReporteEmbebido key={`${reporte.id}-${intento}`} reporteId={reporte.id} alFallar={setFallo} />

  return (
    <Box>
      <EncabezadoPagina
        titulo="Reportes"
        descripcion="Reparaciones por estado, técnico y tienda, e importes al cliente."
        contexto={<ContextoOrganizacionActiva />}
        pestanas={<PestanasService activa="reportes" />}
      />
      <ContenedorSeccion>
        <Stack spacing={2}>{tablero}</Stack>
      </ContenedorSeccion>
    </Box>
  )
}
