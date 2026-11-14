// Reportes de inventario (épica MSF-140, spec `reportes-de-inventario-y-exportacion`). Los datos y el
// cálculo viven en la base (vistas `analitica.inventario_*`) y en Superset; acá solo van las constantes
// con las que la pantalla identifica su tablero y su sección de permisos.

// Los reportes de inventario siguen la sección de sus datos (Stock), no la de `reportes` (FR-004).
export const SECCION_INVENTARIO = 'stock'

// Nombre con el que el importador registra el tablero (infra/superset/dashboards/inventario/reportes.json).
export const NOMBRE_REPORTE_PRODUCTOS_STOCK = 'Inventario · Productos y stock'

// Versión SIN costos ni valor del mismo reporte: la ve quien no tiene la acción `ver_costos` (p. ej. Consulta).
// La base decide cuál le corresponde: `reportes_visibles_para_mi` no lista el tablero con costos a quien no la
// tiene y `resolver_organizacion_reporte` no emite su token (403).
export const NOMBRE_REPORTE_PRODUCTOS_STOCK_CANTIDADES = 'Inventario · Productos y stock (cantidades)'

export const TITULO_PRODUCTOS_STOCK = 'Productos y stock'
export const SUBTITULO_PRODUCTOS_STOCK = 'Cantidad, costo y valor de cada producto, y el valor total del inventario.'
export const SUBTITULO_PRODUCTOS_STOCK_CANTIDADES = 'Cantidad y estado de cada producto.'

export const NOMBRE_REPORTE_REPOSICION = 'Inventario · Reposición'

export const TITULO_REPOSICION = 'Reposición'
export const SUBTITULO_REPOSICION = 'Productos sin stock o con stock bajo y cuánto falta para volver al mínimo, para armar el pedido a proveedores.'

// Único lugar que decide qué tablero de «Productos y stock» corresponde: el que la base le lista al usuario.
// `reportes_visibles_para_mi` solo incluye el tablero con costos si el usuario tiene `ver_costos`.
export function tableroProductosStock(reportes: readonly { nombre: string }[]): { nombre: string; conCostos: boolean } {
  const conCostos = reportes.some((reporte) => reporte.nombre === NOMBRE_REPORTE_PRODUCTOS_STOCK)
  return {
    nombre: conCostos ? NOMBRE_REPORTE_PRODUCTOS_STOCK : NOMBRE_REPORTE_PRODUCTOS_STOCK_CANTIDADES,
    conCostos,
  }
}
