import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// El tablero «Por producto» vive en YAML versionado (Principio: lo que se entrega es código en git).
// Este contrato fija lo visible que exige el prototipo (FR-019…FR-021) leyendo esos YAML, porque la tabla
// la dibuja Superset y no se puede renderizar en Vitest.
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../infra/superset/dashboards/rentabilidad')
const leer = (...partes: string[]) => readFileSync(path.join(raiz, ...partes), 'utf8')

const grafico = leer('charts', 'Productos_por_canal_3.yaml')
const dashboard = leer('dashboards', 'Rentabilidad_Por_producto_2.yaml')
const dataset = leer('datasets', 'Rentabilidad_analitica', 'margen_producto_canal.yaml')
const reportes = JSON.parse(leer('reportes.json')) as { reportes: { nombre: string; dashboard_slug: string; seccion: string }[] }

describe('tablero «Por producto» (YAML versionado)', () => {
  it('la tabla tiene las columnas del prototipo, en orden, y el contador «N filas»', () => {
    const encabezados = [...grafico.matchAll(/<th [^>]*>([^<]+)<\/th>/g)].map((m) => m[1])
    expect(encabezados).toEqual(['Producto', 'Canal', 'Precio', 'Costo', 'Comisión', 'Margen', 'Margen %', 'Estado'])
    expect(grafico).toContain('{{data.length}} filas')
    expect(grafico).toContain('{{sku}}')
  })

  it('muestra la barra de margen % y el chip de estado OK / Bajo / Negativo', () => {
    expect(grafico).toContain('width:{{barra_pct}}%')
    expect(grafico).toContain('{{estado_etiqueta}}')
    for (const etiqueta of ["'OK'", "'Bajo'", "'Negativo'"]) expect(dataset).toContain(etiqueta)
  })

  it('sin coincidencias muestra «Sin resultados» y «Cambiá el filtro o la búsqueda.»', () => {
    expect(grafico).toMatch(/\{\{else\}\}[\s\S]*Sin resultados[\s\S]*Cambiá el filtro o la búsqueda\./)
  })

  it('resalta los márgenes negativos con el color de error del sistema de diseño', () => {
    expect(grafico).toContain('color:{{margen_color}}')
    expect(dataset).toContain("CASE WHEN margen < 0 THEN '#C62828'")
  })

  it('ordena por margen % ascendente por defecto (menor margen primero)', () => {
    expect(grafico).toContain('"order_by_cols": ["[\\"margen_pct\\", true]"]')
  })

  it('ofrece filtros nativos de estado, canal y búsqueda de producto o SKU, sin Mercado Libre', () => {
    const metadata = JSON.parse(dashboard.match(/^metadata: (.+)$/m)![1]) as {
      native_filter_configuration: { id: string; name: string; targets: { column: { name: string } }[] }[]
    }
    const filtros = metadata.native_filter_configuration
    expect(filtros.map((f) => [f.id, f.name, f.targets[0].column.name])).toEqual([
      ['NATIVE_FILTER-estado', 'Estado', 'estado_etiqueta'],
      ['NATIVE_FILTER-canal', 'Canal', 'empresa_nombre'],
      ['NATIVE_FILTER-buscar', 'Buscar producto o SKU', 'producto_busqueda'],
    ])
    expect(dataset).toContain("producto_nombre || ' ' || coalesce(sku, '')")
    expect(`${grafico}${dashboard}${dataset}`).not.toMatch(/mercado/i)
  })

  it('el filtro inicial de la pantalla apunta al mismo id y columna que el filtro del dashboard', async () => {
    const { FILTRO_ESTADO_COLUMNA, FILTRO_ESTADO_ID } = await import('../../lib/rentabilidad')
    expect(dashboard).toContain(`"id": "${FILTRO_ESTADO_ID}"`)
    expect(dashboard).toContain(`"name": "${FILTRO_ESTADO_COLUMNA}"`)
  })

  it('se registra como reporte de la sección rentabilidad con el nombre que busca la pantalla', async () => {
    const { NOMBRE_REPORTE_POR_PRODUCTO, SECCION_RENTABILIDAD } = await import('../../lib/rentabilidad')
    const reporte = reportes.reportes.find((r) => r.nombre === NOMBRE_REPORTE_POR_PRODUCTO)
    expect(reporte?.dashboard_slug).toBe('rentabilidad-por-producto')
    expect(reporte?.seccion).toBe(SECCION_RENTABILIDAD)
    expect(dashboard).toContain('slug: rentabilidad-por-producto')
  })
})
