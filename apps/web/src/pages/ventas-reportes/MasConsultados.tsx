import {
  MENSAJE_SIN_CONSULTAS,
  NOMBRE_REPORTE_MAS_CONSULTADOS,
  leerConteoConsultas,
  urlParamsReportes,
  type RangoFechas,
} from '../../lib/ventas-reportes'
import { TableroReporte } from './TableroReporte'

type Props = {
  rango: RangoFechas
  empresaId: string | null
  empresaNombre: string | null
  // El filtro de empresa todavía está cargando: no se monta el tablero hasta saber la tienda.
  cargandoEmpresa: boolean
}

// «Productos más consultados» (F-REP-04, FR-011): el tablero de Superset con los productos que más
// tocaron «Consultar por WhatsApp» en el período. Reutiliza `TableroReporte` (estados de carga, vacío,
// error con `Reintentar` y acceso restringido) y los filtros nativos de período y empresa; solo
// cambian el tablero, el conteo del estado vacío y su texto. Muestra cantidades, nunca costo ni margen.
export function MasConsultados({ rango, empresaId, empresaNombre, cargandoEmpresa }: Props) {
  return (
    <TableroReporte
      rango={rango}
      empresaId={empresaId}
      cargandoEmpresa={cargandoEmpresa}
      nombreReporte={NOMBRE_REPORTE_MAS_CONSULTADOS}
      etiquetaReporte="Productos más consultados"
      urlParams={urlParamsReportes({ rango, empresa: empresaNombre })}
      leerConteo={leerConteoConsultas}
      mensajeVacio={MENSAJE_SIN_CONSULTAS}
    />
  )
}
