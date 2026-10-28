import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// El tablero «Comparativo» vive en YAML versionado y lo dibuja Superset: el estado vacío y las columnas
// no se pueden renderizar en Vitest, así que este contrato las fija leyendo esos YAML (FR-004, FR-005).
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../infra/superset/dashboards/rentabilidad')
const leer = (...partes: string[]) => readFileSync(path.join(raiz, ...partes), 'utf8')

const grafico = leer('charts', 'Comparativo_4.yaml')
const dashboard = leer('dashboards', 'Rentabilidad_Comparativo_4.yaml')
const dataset = leer('datasets', 'Rentabilidad_analitica', 'margen_comparativo_producto.yaml')
const reportes = JSON.parse(leer('reportes.json')) as { reportes: { nombre: string; dashboard_slug: string; seccion: string }[] }

describe('tablero «Comparativo» (YAML versionado)', () => {
  it('la tabla tiene las columnas del comparativo, en orden, y el contador «N productos»', () => {
    const encabezados = [...grafico.matchAll(/<th [^>]*>([^<]+)<\/th>/g)].map((m) => m[1])
    expect(encabezados).toEqual(['Producto', 'Margen % por empresa', 'Diferencia', 'Mejor margen', 'Peor margen'])
    expect(grafico).toContain('{{data.length}} productos')
    expect(grafico).toContain('{{sku}}')
  })

  it('sin coincidencias muestra «Sin resultados» con el motivo de negocio y «Cambiá el filtro o la búsqueda.»', () => {
    expect(grafico).toMatch(
      /\{\{else\}\}[\s\S]*Sin resultados[\s\S]*No hay productos con margen en dos o más empresas\. Cambiá el filtro o la búsqueda\./,
    )
  })

  it('ordena por posición (mayor diferencia primero) por defecto', () => {
    expect(grafico).toContain('"order_by_cols":["[\\"posicion\\", true]"]')
    expect(dashboard).toContain('Mayor diferencia primero')
  })

  it('ofrece filtros nativos de búsqueda de producto o SKU y de orden por diferencia, sin Mercado Libre', () => {
    const metadata = JSON.parse(dashboard.match(/^metadata: (.+)$/m)![1]) as {
      native_filter_configuration: { id: string; name: string; targets: { column: { name: string } }[] }[]
    }
    expect(metadata.native_filter_configuration.map((f) => [f.name, f.targets[0].column.name])).toEqual([
      ['Buscar producto o SKU', 'producto_busqueda'],
      ['Orden por diferencia', 'orden_etiqueta'],
    ])
    expect(`${grafico}${dashboard}${dataset}`).not.toMatch(/mercado/i)
  })

  it('se registra como reporte de la sección rentabilidad con el nombre que busca la pantalla', async () => {
    const { NOMBRE_REPORTE_COMPARATIVO, SECCION_RENTABILIDAD } = await import('../../lib/rentabilidad')
    const reporte = reportes.reportes.find((r) => r.nombre === NOMBRE_REPORTE_COMPARATIVO)
    expect(reporte?.dashboard_slug).toBe('rentabilidad-comparativo')
    expect(reporte?.seccion).toBe(SECCION_RENTABILIDAD)
    expect(dashboard).toContain('slug: rentabilidad-comparativo')
  })
})
