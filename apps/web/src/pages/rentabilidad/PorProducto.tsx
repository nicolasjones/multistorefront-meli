import { useState } from 'react'
import { Alert, Stack } from '@mui/material'
import { useSearchParams } from 'react-router'
import { ReporteEmbebido, type MotivoFalloReporte } from '../../components/ReporteEmbebido'
import { EstadoCargaPagina, EstadoError } from '../../components/estados/EstadosPagina'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { PestanasPagina } from '../../components/pagina/PestanasPagina'
import { useReportesAsignados } from '../../hooks/useReportesAsignados'
import {
  NOMBRE_REPORTE_POR_PRODUCTO,
  PESTANAS_RENTABILIDAD,
  SECCION_RENTABILIDAD,
  parsearEstadoInicial,
  urlParamsEstadoInicial,
} from '../../lib/rentabilidad'
import { AccesoRestringido } from '../acceso-restringido/AccesoRestringido'

// «Rentabilidad · Por producto» (F-REN-03; RentabilidadProductos.dc.html). La tabla, los filtros de estado
// y canal, el buscador y el contador salen del tablero de Superset embebido; la nota, el error con
// `Reintentar` y el acceso restringido son de Refine. Como el resumen, compara TODAS las empresas de la
// organización (una fila por producto y tienda) y no depende de la empresa activa de la barra superior
// (Principio VIII, no aplica; ver matriz de la spec). La ruta va envuelta en RequiereAccesoSeccion
// (`rentabilidad` ≥ lectura): sin la sección no se monta nada ni se pide token. Ante un 403 del token
// se muestra el mismo acceso restringido. `?estado=bajo_o_negativo` (aviso del resumen) llega al
// tablero como filtro nativo inicial.
export function RentabilidadPorProducto() {
  const { reportes, isLoading } = useReportesAsignados()
  const [parametros] = useSearchParams()
  const estadoInicial = parsearEstadoInicial(parametros.get('estado'))

  // Cada intento remonta el tablero: repite la solicitud del token y el montaje (FR-022).
  const [intento, setIntento] = useState(0)
  const [fallo, setFallo] = useState<MotivoFalloReporte | null>(null)

  const reporte = reportes.find((candidato) => candidato.nombre === NOMBRE_REPORTE_POR_PRODUCTO)
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
    tablero = (
      <ReporteEmbebido
        key={`${reporte.id}-${estadoInicial ?? 'todos'}-${intento}`}
        reporteId={reporte.id}
        alFallar={setFallo}
        urlParams={urlParamsEstadoInicial(estadoInicial)}
      />
    )
  }

  return (
    <Stack spacing={2}>
      <EncabezadoPagina
        titulo="Rentabilidad"
        descripcion="Margen estimado por canal, producto y publicación."
        contexto={<ContextoOrganizacionActiva />}
        pestanas={<PestanasPagina pestanas={PESTANAS_RENTABILIDAD} etiqueta="Secciones de Rentabilidad" />}
      />
      <Alert severity="info">
        Margen = Precio − Costo − Comisión. Las tiendas propias no tienen comisión en esta versión.
      </Alert>
      {tablero}
    </Stack>
  )
}
