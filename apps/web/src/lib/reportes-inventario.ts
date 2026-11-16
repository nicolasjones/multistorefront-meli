// Reportes de inventario (épica MSF-140, spec `reportes-de-inventario-y-exportacion`). Los datos y el
// cálculo viven en la base (vistas `analitica.inventario_*`) y en Superset; acá solo van las constantes
// con las que la pantalla identifica su tablero y su sección de permisos.

// Los reportes de inventario siguen la sección de sus datos (Stock), no la de `reportes` (FR-004).
export const SECCION_INVENTARIO = 'stock'

// Nombre con el que el importador registra el tablero (infra/superset/dashboards/inventario/reportes.json).
export const NOMBRE_REPORTE_PRODUCTOS_STOCK = 'Inventario · Productos y stock'

export const TITULO_PRODUCTOS_STOCK = 'Productos y stock'
export const SUBTITULO_PRODUCTOS_STOCK = 'Cantidad, costo y valor de cada producto, y el valor total del inventario.'

export const NOMBRE_REPORTE_REPOSICION = 'Inventario · Reposición'

export const TITULO_REPOSICION = 'Reposición'
export const SUBTITULO_REPOSICION = 'Productos sin stock o con stock bajo y cuánto falta para volver al mínimo, para armar el pedido a proveedores.'
