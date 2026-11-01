import { NOMBRE_REPORTE_MAS_VENDIDOS, urlParamsReportes, type RangoFechas } from '../../lib/ventas-reportes'
import { TableroReporte } from './TableroReporte'

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
// con `Reintentar` y el acceso restringido ante un 403 del token son los compartidos del panel
// (`TableroReporte`).
export function MasVendidos({ rango, empresaId, empresaNombre, cargandoEmpresa }: Props) {
  return (
    <TableroReporte
      rango={rango}
      empresaId={empresaId}
      cargandoEmpresa={cargandoEmpresa}
      nombreReporte={NOMBRE_REPORTE_MAS_VENDIDOS}
      etiquetaReporte="Más vendidos"
      urlParams={urlParamsReportes({ rango, empresa: empresaNombre })}
    />
  )
}
