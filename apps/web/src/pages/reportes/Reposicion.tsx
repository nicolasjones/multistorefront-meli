import { Stack } from '@mui/material'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import {
  NOMBRE_REPORTE_REPOSICION,
  SUBTITULO_REPOSICION,
  TITULO_REPOSICION,
} from '../../lib/reportes-inventario'
import { TableroInventario } from './TableroInventario'

// «Reposición» (F-REP-02, FR-005; `/reportes/reposicion`): el listado de productos sin stock o con
// stock bajo, con proveedor y faltante sugerido, sale del tablero de Superset embebido; el marco, los
// estados y el acceso restringido son de Refine. No hay selector de empresa: el inventario es por
// organización.
export function Reposicion() {
  return (
    <Stack spacing={2}>
      <EncabezadoPagina
        titulo={TITULO_REPOSICION}
        descripcion={SUBTITULO_REPOSICION}
        contexto={<ContextoOrganizacionActiva />}
      />
      <TableroInventario nombreReporte={NOMBRE_REPORTE_REPOSICION} etiquetaReporte={TITULO_REPOSICION} />
    </Stack>
  )
}
