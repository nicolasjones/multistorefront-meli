import {
  NOMBRE_REPORTE_VENTAS_PERIODO_CANAL,
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

// «Ventas por período y canal» (F-REP-05, FR-013): el tablero de Superset con comprobantes, unidades y
// facturado por período (día, semana o mes, a elección del tablero) y por canal (tienda). Reutiliza
// `TableroReporte` (estados de carga, vacío, error con `Reintentar` y acceso restringido) y los filtros
// nativos de período y empresa; el conteo del estado vacío es el de las ventas (mismo predicado que la
// vista). Muestra cantidades y facturado, nunca costo ni margen; no hay canal de Mercado Libre.
export function VentasPeriodoCanal({ rango, empresaId, empresaNombre, cargandoEmpresa }: Props) {
  return (
    <TableroReporte
      rango={rango}
      empresaId={empresaId}
      cargandoEmpresa={cargandoEmpresa}
      nombreReporte={NOMBRE_REPORTE_VENTAS_PERIODO_CANAL}
      etiquetaReporte="Ventas por período y canal"
      urlParams={urlParamsReportes({ rango, empresa: empresaNombre })}
    />
  )
}
