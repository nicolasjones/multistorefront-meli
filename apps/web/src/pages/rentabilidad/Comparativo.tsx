import { useState } from 'react'
import { Alert, Stack } from '@mui/material'
import { ReporteEmbebido, type MotivoFalloReporte } from '../../components/ReporteEmbebido'
import { EstadoCargaPagina, EstadoError } from '../../components/estados/EstadosPagina'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { PestanasPagina } from '../../components/pagina/PestanasPagina'
import { useReportesAsignados } from '../../hooks/useReportesAsignados'
import { NOMBRE_REPORTE_COMPARATIVO, PESTANAS_RENTABILIDAD, SECCION_RENTABILIDAD } from '../../lib/rentabilidad'
import { AccesoRestringido } from '../acceso-restringido/AccesoRestringido'

// «Rentabilidad · Comparativo» (F-REN-06; la pestaña no está en el prototipo, ver matriz de la spec).
// La tabla producto × empresa, la diferencia en pp, mejor/peor, el buscador, el orden y el estado vacío
// («Sin resultados») salen del tablero de Superset embebido; la nota, el error con `Reintentar` y el
// acceso restringido son de Refine. Compara TODAS las empresas de la organización lado a lado, así que
// no depende de la empresa activa de la barra superior (Principio VIII, no aplica; ver matriz de la
// spec). La ruta va envuelta en RequiereAccesoSeccion (`rentabilidad` ≥ lectura): sin la sección no se
// monta nada ni se pide token. Ante un 403 del token se muestra el mismo acceso restringido.
export function RentabilidadComparativo() {
  const { reportes, isLoading } = useReportesAsignados()

  // Cada intento remonta el tablero: repite la solicitud del token y el montaje (FR-006).
  const [intento, setIntento] = useState(0)
  const [fallo, setFallo] = useState<MotivoFalloReporte | null>(null)

  const reporte = reportes.find((candidato) => candidato.nombre === NOMBRE_REPORTE_COMPARATIVO)
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
        Compará el margen del mismo producto en cada empresa. Solo aparecen los productos con margen calculado en dos o más empresas.
      </Alert>
      {tablero}
    </Stack>
  )
}
