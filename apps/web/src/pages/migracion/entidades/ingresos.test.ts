import { describe, expect, it } from 'vitest'
import { analizarCsv } from '../../../lib/migracionCsv'
import {
  camposObligatoriosFaltantes,
  construirFilas,
  contenidoPlantilla,
  mapeoAutomatico,
} from '../../../lib/migracion'
import {
  CSV_INGRESOS_ARCHIVO_SINTETICOS,
  ENCABEZADOS_INGRESOS_ARCHIVO,
  INGRESOS_ARCHIVO_SINTETICOS,
} from '../../../test/fixtures/ingresosArchivoMigracion'
import { ENTIDAD_INGRESOS } from './ingresos'
import { obtenerEntidad } from './clientes'

describe('definición de la entidad ingresos anteriores', () => {
  it('apunta a las RPC del archivo y entrega una plantilla con las columnas esperadas', () => {
    expect(ENTIDAD_INGRESOS.rpcPrevisualizar).toBe('previsualizar_lote_archivo_ingresos')
    expect(ENTIDAD_INGRESOS.rpcAplicar).toBe('aplicar_lote_archivo_ingresos')
    expect(ENTIDAD_INGRESOS.archivoPlantilla).toBe('ingresos-anteriores.csv')
    expect(contenidoPlantilla(ENTIDAD_INGRESOS).trim().split(',')).toEqual([...ENCABEZADOS_INGRESOS_ARCHIVO])
  })

  it('se registra con el id que acepta la base (ingresos_archivo)', () => {
    expect(obtenerEntidad('ingresos_archivo')).toBe(ENTIDAD_INGRESOS)
  })

  it('auto-mapea la plantilla y exige identificador, fecha, producto y cantidad', () => {
    const mapeo = mapeoAutomatico(ENTIDAD_INGRESOS, [...ENCABEZADOS_INGRESOS_ARCHIVO])
    expect(Object.values(mapeo)).toEqual(['id_externo', 'fecha', 'producto', 'cantidad', 'proveedor', 'operador'])
    expect(camposObligatoriosFaltantes(ENTIDAD_INGRESOS, mapeo)).toEqual([])
    expect(camposObligatoriosFaltantes(ENTIDAD_INGRESOS, {})).toEqual([
      'Identificador del panel actual', 'Fecha', 'Producto', 'Cantidad',
    ])
  })

  it('arma las filas con el operador como texto (sin resolver usuarios)', () => {
    const csv = analizarCsv(CSV_INGRESOS_ARCHIVO_SINTETICOS)
    const mapeo = mapeoAutomatico(ENTIDAD_INGRESOS, csv.encabezados)
    const filas = construirFilas(csv, mapeo)
    expect(filas).toHaveLength(INGRESOS_ARCHIVO_SINTETICOS.length)
    expect(filas[0]).toMatchObject({
      fila: 2, id_externo: 'ING-SINT-001', fecha: '2025-03-14', cantidad: '12', operador: 'Operador Sintético 01',
    })
    expect(filas[2].proveedor).toBe('')
  })
})
