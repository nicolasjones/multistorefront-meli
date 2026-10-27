import { useState } from 'react'
import { ReporteEmbebido, type MotivoFalloReporte } from '../../components/ReporteEmbebido'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { useConteoVentasReporte } from '../../hooks/useVentasReportes'
import { useReportesAsignados } from '../../hooks/useReportesAsignados'
import {
  MENSAJE_SIN_VENTAS,
  NOMBRE_REPORTE_MAS_VENDIDOS,
  SECCION_REPORTES,
  urlParamsReportes,
  type RangoFechas,
} from '../../lib/ventas-reportes'
import { AccesoRestringido } from '../acceso-restringido/AccesoRestringido'

type Props = {
  rango: RangoFechas
  empresaId: string | null
  empresaNombre: string | null
  // El filtro de empresa todavía está cargando: no se monta el tablero hasta saber la tienda
  // (si no, se pediría el token dos veces: una sin filtro y otra con la tienda activa).
  cargandoEmpresa: boolean
}

// «Más vendidos» (F-VTA-22, FR-005): el tablero de Superset embebido con los filtros nativos de
// período y de empresa preseleccionados desde la pantalla. El conteo de ventas del período decide
// el estado vacío («No hay ventas en ese período», SC-003); el tablero, los estados de carga y error
// con `Reintentar` y el acceso restringido ante un 403 del token son los compartidos del panel.
export function MasVendidos({ rango, empresaId, empresaNombre, cargandoEmpresa }: Props) {
  const { reportes, isLoading: cargandoReportes } = useReportesAsignados()
  const { conteo, isLoading: cargandoConteo } = useConteoVentasReporte({
    rango,
    empresaId,
    habilitado: !cargandoEmpresa,
  })
  // Cada intento remonta el tablero: repite la solicitud del token y el montaje.
  const [intento, setIntento] = useState(0)
  const [fallo, setFallo] = useState<MotivoFalloReporte | null>(null)

  const reporte = reportes.find((candidato) => candidato.nombre === NOMBRE_REPORTE_MAS_VENDIDOS)
  const reintentar = () => {
    setFallo(null)
    setIntento((anterior) => anterior + 1)
  }

  if (fallo === 'prohibido') {
    return <AccesoRestringido rol="actual" seccion="Reportes de ventas" seccionClave={SECCION_REPORTES} />
  }

  let tablero
  if (cargandoReportes || cargandoConteo || cargandoEmpresa) {
    tablero = <EstadoCargaPagina />
  } else if (conteo === 0) {
    tablero = (
      <EstadoVacio
        titulo={MENSAJE_SIN_VENTAS}
        descripcion="Probá con otro período o con otra tienda."
      />
    )
  } else if (!reporte) {
    tablero = <EstadoError descripcion="El tablero de «Más vendidos» todavía no está disponible para tu organización." />
  } else if (fallo === 'no_disponible') {
    tablero = <EstadoError descripcion="No pudimos cargar el tablero de «Más vendidos»." reintentar={reintentar} />
  } else {
    tablero = (
      <ReporteEmbebido
        key={`${reporte.id}-${rango.desde}-${rango.hasta}-${empresaId ?? 'todas'}-${intento}`}
        reporteId={reporte.id}
        alFallar={setFallo}
        urlParams={urlParamsReportes({ rango, empresa: empresaNombre })}
      />
    )
  }

  return <ContenedorSeccion>{tablero}</ContenedorSeccion>
}
