import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// El tablero «Ventas reales» vive en YAML versionado y lo dibuja Superset: el rango Desde/Hasta, los totales, el desglose y el
// estado vacío no se pueden renderizar en Vitest, así que este contrato los fija leyendo esos YAML (FR-009, SC-006).
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../infra/superset/dashboards/rentabilidad')
const leer = (...partes: string[]) => readFileSync(path.join(raiz, ...partes), 'utf8')

const totales = leer('charts', 'Ventas_reales_totales_7.yaml')
const porEmpresa = leer('charts', 'Ventas_reales_empresa_8.yaml')
const porProducto = leer('charts', 'Ventas_reales_producto_9.yaml')
const dashboard = leer('dashboards', 'Rentabilidad_Ventas_reales_6.yaml')
const dataset = leer('datasets', 'Rentabilidad_analitica', 'rentabilidad_ventas_real.yaml')
const reportes = JSON.parse(leer('reportes.json')) as {
  reportes: { nombre: string; dashboard_slug: string; seccion: string; rolesPorDefecto?: string[] }[]
}
const params = (yaml: string) => JSON.parse(yaml.match(/^params: (.+)$/m)![1]) as Record<string, unknown>

describe('tablero «Ventas reales» (YAML versionado)', () => {
  it('tiene un rango de fechas Desde/Hasta sobre la fecha de la venta y ningún filtro de empresa', () => {
    const metadata = JSON.parse(dashboard.match(/^metadata: (.+)$/m)![1]) as {
      native_filter_configuration: { name: string; filterType: string; targets: { column: { name: string } }[] }[]
    }
    expect(metadata.native_filter_configuration).toHaveLength(1)
    const [filtro] = metadata.native_filter_configuration
    expect([filtro.name, filtro.filterType, filtro.targets[0].column.name]).toEqual(['Rango de fechas', 'time_range', 'fecha'])
  })

  it('muestra totales de vendido, costo, costos adicionales, margen y margen % con su estado', () => {
    expect(params(totales).metrics).toEqual([
      'filas', 'vendido_texto', 'costo_texto', 'costos_adicionales_texto', 'margen_texto', 'margen_pct_texto', 'estado_total',
    ])
    for (const rotulo of ['Vendido', 'Costo', 'Costos adicionales', 'Margen', 'Margen %', 'Estado:']) expect(totales).toContain(rotulo)
  })

  it('desglosa por empresa y por producto con margen % y estado según el umbral', () => {
    expect(params(porEmpresa)).toMatchObject({ query_mode: 'aggregate', groupby: ['empresa_nombre'] })
    expect(params(porProducto)).toMatchObject({ query_mode: 'aggregate', groupby: ['producto_nombre', 'sku'] })
    for (const metricas of [params(porEmpresa).metrics, params(porProducto).metrics]) {
      expect(metricas).toEqual(expect.arrayContaining(['vendido_total', 'costo_total', 'costos_adicionales_total', 'margen_total', 'margen_pct_total', 'estado_total']))
    }
    expect(dataset).toMatch(/umbral_margen_bajo/)
    expect(dataset).toMatch(/'Bajo'/)
  })

  it('sin ventas muestra el estado vacío con su motivo y aclara que las ventas sin costo no figuran', () => {
    expect(totales).toMatch(/\{\{else\}\}[\s\S]*Sin ventas en este período/)
    expect(totales).toMatch(/confirmadas antes de que se guardara el costo no figuran/)
  })

  it('el dataset lleva organizacion_id para el rls del token y nada menciona Mercado Libre', () => {
    expect(dataset).toMatch(/^- column_name: organizacion_id$/m)
    expect(dataset).toMatch(/^table_name: rentabilidad_ventas_real$/m)
    expect(`${totales}${porEmpresa}${porProducto}${dashboard}${dataset}`).not.toMatch(/mercado/i)
  })

  it('se registra como reporte de la sección rentabilidad (solo Administración y Administrador, nunca Consulta)', async () => {
    const { NOMBRE_REPORTE_VENTAS_REALES, SECCION_RENTABILIDAD } = await import('../../lib/rentabilidad')
    const registrados = reportes.reportes.filter((r) => r.nombre === NOMBRE_REPORTE_VENTAS_REALES)
    expect(registrados).toHaveLength(1)
    expect(registrados[0]).toMatchObject({ dashboard_slug: 'rentabilidad-ventas-reales', seccion: SECCION_RENTABILIDAD, rolesPorDefecto: ['administracion'] })
  })
})
