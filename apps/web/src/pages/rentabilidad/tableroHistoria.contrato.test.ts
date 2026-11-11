import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// El tablero «Historia» vive en YAML versionado y lo dibuja Superset: el selector de producto, la serie y el
// estado vacío no se pueden renderizar en Vitest, así que este contrato los fija leyendo esos YAML (FR-012, FR-013).
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../infra/superset/dashboards/rentabilidad')
const leer = (...partes: string[]) => readFileSync(path.join(raiz, ...partes), 'utf8')

const tabla = leer('charts', 'Historia_tabla_6.yaml')
const serie = leer('charts', 'Historia_serie_5.yaml')
const dashboard = leer('dashboards', 'Rentabilidad_Historia_5.yaml')
const dataset = leer('datasets', 'Rentabilidad_analitica', 'margen_historico_producto_canal.yaml')
const reportes = JSON.parse(leer('reportes.json')) as { reportes: { nombre: string; dashboard_slug: string; seccion: string }[] }

describe('tablero «Historia» (YAML versionado)', () => {
  it('la tabla de apoyo tiene fecha, empresa, cotización, costo, neto, margen y margen %', () => {
    const encabezados = [...tabla.matchAll(/<th [^>]*>([^<]+)<\/th>/g)].map((m) => m[1])
    expect(encabezados).toEqual(['Fecha', 'Empresa', 'Cotización', 'Costo', 'Neto', 'Margen', 'Margen %'])
  })

  it('exige elegir un producto: el selector es obligatorio y de una sola opción', () => {
    const metadata = JSON.parse(dashboard.match(/^metadata: (.+)$/m)![1]) as {
      native_filter_configuration: {
        name: string
        controlValues: { enableEmptyFilter: boolean; multiSelect: boolean }
        targets: { column: { name: string } }[]
      }[]
    }
    const [filtro] = metadata.native_filter_configuration
    expect(metadata.native_filter_configuration).toHaveLength(1)
    expect([filtro.name, filtro.targets[0].column.name]).toEqual(['Producto', 'producto_etiqueta'])
    expect(filtro.controlValues).toMatchObject({ enableEmptyFilter: true, multiSelect: false })
  })

  it('sin historia muestra el motivo de negocio, sin identificadores técnicos', () => {
    expect(tabla).toMatch(/\{\{else\}\}[\s\S]*Sin historia para este producto[\s\S]*costo registrado y una cotización del dólar/)
  })

  it('la serie agrupa por empresa a lo largo de la fecha', () => {
    expect(serie).toContain('"x_axis": "fecha"')
    expect(serie).toContain('"groupby": ["empresa_nombre"]')
  })

  it('el dataset lleva organizacion_id para el rls del token y no menciona Mercado Libre', () => {
    expect(dataset).toMatch(/^- column_name: organizacion_id$/m)
    expect(`${tabla}${serie}${dashboard}${dataset}`).not.toMatch(/mercado/i)
  })

  it('se registra como reporte de la sección rentabilidad con el nombre que busca la pantalla', async () => {
    const { NOMBRE_REPORTE_HISTORIA, SECCION_RENTABILIDAD } = await import('../../lib/rentabilidad')
    const reporte = reportes.reportes.find((r) => r.nombre === NOMBRE_REPORTE_HISTORIA)
    expect(reporte?.dashboard_slug).toBe('rentabilidad-historia')
    expect(reporte?.seccion).toBe(SECCION_RENTABILIDAD)
  })
})
