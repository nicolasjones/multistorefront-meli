import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { NOMBRE_REPORTE_SERVICE } from '../../lib/serviceTecnico'

// El tablero «Service técnico» vive en YAML versionado (lo que se entrega es código en git; FR-063). Este
// contrato fija sus cuatro indicadores y la ausencia de costos leyendo esos YAML, porque los gráficos los
// dibuja Superset y no se pueden renderizar en Vitest.
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../infra/superset/dashboards/service')
const leer = (...partes: string[]) => readFileSync(path.join(raiz, ...partes), 'utf8')

const dashboard = leer('dashboards', 'Service_tecnico_1.yaml')
const datasetReparaciones = leer('datasets', 'Service_analitica', 'service_reparaciones.yaml')
const datasetItems = leer('datasets', 'Service_analitica', 'service_reparacion_items.yaml')
const graficos = {
  estado: leer('charts', 'Reparaciones_por_estado_1.yaml'),
  tecnico: leer('charts', 'Reparaciones_por_tecnico_2.yaml'),
  ingresadas: leer('charts', 'Ingresadas_por_mes_y_tienda_3.yaml'),
  importe: leer('charts', 'Importe_por_mes_y_tienda_4.yaml'),
}
const reportes = JSON.parse(leer('reportes.json')) as {
  reportes: { nombre: string; dashboard_slug: string; seccion: string; rolesPorDefecto: string[] }[]
}
const uuidDe = (yaml: string) => /^uuid: (.+)$/m.exec(yaml)![1]

describe('tablero «Service técnico» (YAML versionado)', () => {
  it('el manifiesto registra un reporte con el nombre que busca la pestaña y la sección service_tecnico', () => {
    expect(reportes.reportes).toHaveLength(1)
    expect(reportes.reportes[0]).toMatchObject({ nombre: NOMBRE_REPORTE_SERVICE, seccion: 'service_tecnico', dashboard_slug: 'service-tecnico' })
    expect(reportes.reportes[0].rolesPorDefecto).not.toContain('administrador')
    expect(dashboard).toContain('slug: service-tecnico')
  })

  it('tiene los cuatro indicadores de la spec y todos están en el dashboard', () => {
    expect(graficos.estado).toContain('"x_axis": "estado_nombre"')
    expect(graficos.tecnico).toContain('"x_axis": "tecnico_etiqueta"')
    expect(graficos.ingresadas).toContain('"x_axis": "ingreso_en"')
    expect(graficos.ingresadas).toContain('"time_grain_sqla": "P1M"')
    expect(graficos.ingresadas).toContain('"groupby": ["empresa_nombre"]')
    expect(graficos.importe).toContain('"time_grain_sqla": "P1M"')
    expect(graficos.importe).toContain('SUM(total_mano_obra)')
    expect(graficos.importe).toContain('SUM(total_repuestos)')
    for (const grafico of Object.values(graficos)) expect(dashboard).toContain(uuidDe(grafico))
  })

  it('los gráficos se apoyan en datasets sobre las vistas analitica.service_* con organizacion_id', () => {
    for (const grafico of Object.values(graficos)) expect(grafico).toContain(`dataset_uuid: ${uuidDe(datasetReparaciones)}`)
    for (const dataset of [datasetReparaciones, datasetItems]) {
      expect(dataset).toContain('schema: analitica')
      expect(dataset).toContain('column_name: organizacion_id')
    }
    expect(datasetReparaciones).toContain('table_name: service_reparaciones')
    expect(datasetItems).toContain('table_name: service_reparacion_items')
  })

  it('no incluye reparaciones anuladas y ofrece filtros nativos de tienda y período', () => {
    for (const grafico of Object.values(graficos)) expect(grafico).toContain('anulada IS FALSE')
    const metadata = JSON.parse(dashboard.match(/^metadata: (.+)$/m)![1]) as {
      native_filter_configuration: { id: string; name: string; targets: { column: { name: string } }[] }[]
    }
    expect(metadata.native_filter_configuration.map((f) => [f.name, f.targets[0].column.name])).toEqual([
      ['Tienda', 'empresa_nombre'],
      ['Período de ingreso', 'ingreso_en'],
    ])
  })

  it('nunca expone costos internos ni ganancia ni correos', () => {
    const todo = `${dashboard}${datasetReparaciones}${datasetItems}${Object.values(graficos).join('')}`
    expect(todo).not.toMatch(/costo_|ganancia|margen|correo|email/i)
  })

  it('la conexión no guarda credenciales (contraseña enmascarada)', () => {
    const conexion = leer('databases', 'Rentabilidad_analitica.yaml')
    expect(conexion).toContain(':XXXXXXXXXX@')
    expect(conexion).toContain('${SUPERSET_ANALITICA_DB_HOST}')
  })
})
