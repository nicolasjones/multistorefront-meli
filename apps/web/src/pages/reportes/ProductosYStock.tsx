import { Stack } from '@mui/material'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { useReportesAsignados } from '../../hooks/useReportesAsignados'
import {
  NOMBRE_REPORTE_PRODUCTOS_STOCK,
  NOMBRE_REPORTE_PRODUCTOS_STOCK_CANTIDADES,
  SUBTITULO_PRODUCTOS_STOCK,
  SUBTITULO_PRODUCTOS_STOCK_CANTIDADES,
  TITULO_PRODUCTOS_STOCK,
} from '../../lib/reportes-inventario'
import { TableroInventario } from './TableroInventario'

// «Productos y stock» (F-REP-01, FR-001; `/reportes/inventario`): la tabla de productos con cantidad,
// costo y valor, el valor total del inventario y los filtros salen del tablero de Superset embebido;
// el marco, los estados y el acceso restringido son de Refine. No hay selector de empresa: el
// inventario es por organización. Costos y valor solo para quien tiene la acción `ver_costos`: la base
// (`reportes_visibles_para_mi`) lista el tablero con costos solo a esos roles; el resto abre el tablero
// «(cantidades)», cuya vista no trae costo ni valor (ni en pantalla ni en la descarga CSV).
export function ProductosYStock() {
  const { reportes } = useReportesAsignados()
  const conCostos = reportes.some((reporte) => reporte.nombre === NOMBRE_REPORTE_PRODUCTOS_STOCK)
  return (
    <Stack spacing={2}>
      <EncabezadoPagina
        titulo={TITULO_PRODUCTOS_STOCK}
        descripcion={conCostos ? SUBTITULO_PRODUCTOS_STOCK : SUBTITULO_PRODUCTOS_STOCK_CANTIDADES}
        contexto={<ContextoOrganizacionActiva />}
      />
      <TableroInventario
        nombreReporte={conCostos ? NOMBRE_REPORTE_PRODUCTOS_STOCK : NOMBRE_REPORTE_PRODUCTOS_STOCK_CANTIDADES}
        etiquetaReporte={TITULO_PRODUCTOS_STOCK} />
    </Stack>
  )
}
