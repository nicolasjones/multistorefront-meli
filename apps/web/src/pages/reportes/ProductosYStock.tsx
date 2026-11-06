import { Stack } from '@mui/material'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import {
  NOMBRE_REPORTE_PRODUCTOS_STOCK,
  SUBTITULO_PRODUCTOS_STOCK,
  TITULO_PRODUCTOS_STOCK,
} from '../../lib/reportes-inventario'
import { TableroInventario } from './TableroInventario'

// «Productos y stock» (F-REP-01, FR-001; `/reportes/inventario`): la tabla de productos con cantidad,
// costo y valor, el valor total del inventario y los filtros salen del tablero de Superset embebido;
// el marco, los estados y el acceso restringido son de Refine. No hay selector de empresa: el
// inventario es por organización.
export function ProductosYStock() {
  return (
    <Stack spacing={2}>
      <EncabezadoPagina
        titulo={TITULO_PRODUCTOS_STOCK}
        descripcion={SUBTITULO_PRODUCTOS_STOCK}
        contexto={<ContextoOrganizacionActiva />}
      />
      <TableroInventario nombreReporte={NOMBRE_REPORTE_PRODUCTOS_STOCK} etiquetaReporte={TITULO_PRODUCTOS_STOCK} />
    </Stack>
  )
}
