// Catálogo de la galería «Tableros analíticos» (F-REP-07, MSF-265, spec
// 20261114-100000-analitica-avanzada-y-resumen-por-correo, RF-REP-07-1…RF-REP-07-3).
//
// El administrador ELIGE entre tableros ya armados y versionados (YAML en `infra/superset/dashboards/`): no los edita ni
// entra a Superset. Cada entrada describe un tablero para que se pueda elegir sin abrirlo: qué cruces permite y con qué
// filtros. El tablero llega a la galería solo si el reporte está en `public.reportes` Y asignado a la organización
// (`reportes_visibles_para_mi`): lo que no tiene asignado no aparece, aunque figure acá.
//
// Contrato de los filtros: los tableros de este catálogo traen los filtros nativos `NATIVE_FILTER-rango` (fecha) y
// `NATIVE_FILTER-empresa` (columna `empresa_nombre`), los dos que la pantalla preselecciona con `urlParamsReportes`.
// El aislamiento NO depende de ellos: lo fuerza el servidor en la cláusula `rls` del guest token (organización y empresas
// accesibles), así que un filtro manipulado en la URL nunca muestra filas de otra organización ni de otra empresa.

export const SECCION_RENTABILIDAD_TABLEROS = 'rentabilidad'

export type TableroAnalitico = {
  clave: string
  // Nombre del reporte en `public.reportes` (lo registra el importador de dashboards desde `reportes.json`).
  nombreReporte: string
  titulo: string
  descripcion: string
  // Cruces de datos que permite el tablero (qué se puede comparar con qué).
  cruces: readonly string[]
  // Filtros del tablero, en palabras de quien lo usa.
  filtros: readonly string[]
  // El tablero muestra costo y margen (solo quien tiene la sección Rentabilidad lo ve).
  muestraCostos: boolean
}

export const TABLEROS_ANALITICOS: readonly TableroAnalitico[] = [
  {
    clave: 'ventas-tienda-categoria',
    nombreReporte: 'Analítica · Ventas por tienda y categoría',
    titulo: 'Ventas por tienda y categoría',
    descripcion: 'Qué se vende, en qué tienda y de qué categoría: facturado y unidades del período, con los totales por tienda y por categoría.',
    cruces: ['Tienda × categoría', 'Período × categoría', 'Producto × tienda'],
    filtros: ['Período', 'Tienda', 'Categoría', 'Agrupar por día, semana o mes'],
    muestraCostos: false,
  },
  {
    clave: 'margen-real',
    nombreReporte: 'Analítica · Margen real por tienda, categoría y producto',
    titulo: 'Margen real por tienda, categoría y producto',
    descripcion: 'Cuánto ganás de verdad con lo que vendiste: vendido, costo y margen real por tienda, categoría y producto, para ver primero lo que pierde plata.',
    cruces: ['Tienda × categoría', 'Período × tienda', 'Producto × tienda'],
    filtros: ['Período', 'Tienda', 'Categoría', 'Estado del margen', 'Agrupar por día, semana o mes'],
    muestraCostos: true,
  },
  {
    clave: 'ventas-periodo-canal',
    nombreReporte: 'Reportes · Ventas por período y canal',
    titulo: 'Ventas por período y canal',
    descripcion: 'Facturado, comprobantes y unidades de cada tienda a lo largo del tiempo.',
    cruces: ['Período × tienda'],
    filtros: ['Período', 'Tienda', 'Agrupar por día, semana o mes'],
    muestraCostos: false,
  },
  {
    clave: 'mas-vendidos',
    nombreReporte: 'Ventas · Más vendidos',
    titulo: 'Productos más vendidos',
    descripcion: 'Ranking de productos por unidades vendidas, con el facturado y el estado del stock de hoy.',
    cruces: ['Producto × tienda', 'Producto × categoría', 'Producto × ubicación de stock'],
    filtros: ['Período', 'Tienda', 'Categoría', 'Ubicación de stock'],
    muestraCostos: false,
  },
]

export type TableroDisponible = TableroAnalitico & { reporteId: string }

/**
 * Tableros del catálogo que la organización tiene asignados y la persona puede abrir (los que devuelve
 * `reportes_visibles_para_mi`), en el orden del catálogo. Un reporte visible que no está en el catálogo no se ofrece: la
 * galería muestra solo tableros ya armados y descritos.
 */
export function tablerosDisponibles(reportes: ReadonlyArray<{ id: string; nombre: string }>): TableroDisponible[] {
  const resultado: TableroDisponible[] = []
  for (const tablero of TABLEROS_ANALITICOS) {
    const reporte = reportes.find((candidato) => candidato.nombre === tablero.nombreReporte)
    if (reporte) resultado.push({ ...tablero, reporteId: reporte.id })
  }
  return resultado
}
