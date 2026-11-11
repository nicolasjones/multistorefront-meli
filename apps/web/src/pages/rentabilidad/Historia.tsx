import { useState } from 'react'
import { Alert, Stack } from '@mui/material'
import { ReporteEmbebido, type MotivoFalloReporte } from '../../components/ReporteEmbebido'
import { EstadoCargaPagina, EstadoError } from '../../components/estados/EstadosPagina'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { PestanasPagina } from '../../components/pagina/PestanasPagina'
import { useReportesAsignados } from '../../hooks/useReportesAsignados'
import { NOMBRE_REPORTE_HISTORIA, PESTANAS_RENTABILIDAD, SECCION_RENTABILIDAD } from '../../lib/rentabilidad'
import { AccesoRestringido } from '../acceso-restringido/AccesoRestringido'

// «Rentabilidad · Historia» (F-REN-07; la pestaña no está en el prototipo, ver matriz de la spec).
// El selector de producto, la serie de margen % por empresa y fecha, la tabla de apoyo y el estado vacío
// («Sin historia para este producto») salen del tablero de Superset embebido; la nota, el error con
// `Reintentar` y el acceso restringido son de Refine. Muestra TODAS las empresas de la organización, así que
// no depende de la empresa activa de la barra superior (Principio VIII, no aplica; ver matriz de la
// spec). La ruta va envuelta en RequiereAccesoSeccion (`rentabilidad` ≥ lectura): sin la sección no se
// monta nada ni se pide token. Ante un 403 del token se muestra el mismo acceso restringido.
export function RentabilidadHistoria() {
  const { reportes, isLoading } = useReportesAsignados()

  // Cada intento remonta el tablero: repite la solicitud del token y el montaje (FR-014).
  const [intento, setIntento] = useState(0)
  const [fallo, setFallo] = useState<MotivoFalloReporte | null>(null)

  const reporte = reportes.find((candidato) => candidato.nombre === NOMBRE_REPORTE_HISTORIA)
  const reintentar = () => {
    setFallo(null)
    setIntento((anterior) => anterior + 1)
  }

  if (fallo === 'prohibido') {
    return <AccesoRestringido rol="actual" seccion="Rentabilidad" seccionClave={SECCION_RENTABILIDAD} />
  }

  let tablero
  if (isLoading) tablero = <EstadoCargaPagina />
  else if (!reporte) {
    tablero = <EstadoError descripcion="El tablero de Rentabilidad todavía no está disponible para tu organización." />
  } else if (fallo === 'no_disponible') {
    tablero = <EstadoError descripcion="No pudimos cargar el tablero de Rentabilidad." reintentar={reintentar} />
  } else {
    tablero = <ReporteEmbebido key={`${reporte.id}-${intento}`} reporteId={reporte.id} alFallar={setFallo} />
  }

  return (
    <Stack spacing={2}>
      <EncabezadoPagina
        titulo="Rentabilidad"
        descripcion="Margen estimado por canal, producto y publicación."
        contexto={<ContextoOrganizacionActiva />}
        pestanas={<PestanasPagina pestanas={PESTANAS_RENTABILIDAD} etiqueta="Secciones de Rentabilidad" />}
      />
      <Alert severity="info" role="status">
        Elegí un producto para ver cómo evolucionó su margen en cada empresa, con la cotización del dólar y el costo de cada fecha.
      </Alert>
      {tablero}
    </Stack>
  )
}
