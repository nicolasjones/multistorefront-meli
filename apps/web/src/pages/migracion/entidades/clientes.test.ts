import { describe, expect, it } from 'vitest'
import { analizarCsv } from '../../../lib/migracionCsv'
import {
  camposObligatoriosFaltantes,
  camposRepetidos,
  construirFilas,
  contenidoPlantilla,
  mapeoAutomatico,
} from '../../../lib/migracion'
import { ENCABEZADOS_CLIENTES, CSV_CLIENTES_SINTETICOS } from '../../../test/fixtures/clientesMigracion'
import { ENTIDAD_CLIENTES } from './clientes'
import { obtenerEntidad } from './registro'

describe('definición de la entidad clientes', () => {
  it('expone las RPC de clientes y una plantilla con las columnas esperadas', () => {
    expect(ENTIDAD_CLIENTES.rpcPrevisualizar).toBe('previsualizar_lote_clientes')
    expect(ENTIDAD_CLIENTES.rpcAplicar).toBe('aplicar_lote_clientes')
    expect(ENTIDAD_CLIENTES.archivoPlantilla).toBe('clientes.csv')
    expect(contenidoPlantilla(ENTIDAD_CLIENTES).trim().split(',')).toEqual([...ENCABEZADOS_CLIENTES])
  })

  it('registra clientes y rechaza entidades desconocidas', () => {
    expect(obtenerEntidad('clientes')).toBe(ENTIDAD_CLIENTES)
    expect(obtenerEntidad('ingresos_archivo')).toBeNull()
    expect(obtenerEntidad('__proto__')).toBeNull()
    expect(obtenerEntidad(undefined)).toBeNull()
  })

  it('auto-mapea la plantilla completa, incluido el identificador del panel actual', () => {
    const mapeo = mapeoAutomatico(ENTIDAD_CLIENTES, [...ENCABEZADOS_CLIENTES])
    expect(Object.values(mapeo)).toEqual(expect.arrayContaining([
      'id_externo', 'nombre', 'documento', 'tipo', 'correo', 'telefono', 'celular',
      'direccion', 'codigo_postal', 'localidad', 'provincia', 'expreso_preferido',
    ]))
    expect(camposObligatoriosFaltantes(ENTIDAD_CLIENTES, mapeo)).toEqual([])
  })

  it('no adivina columnas con nombres que no conoce', () => {
    const mapeo = mapeoAutomatico(ENTIDAD_CLIENTES, ['campo raro', 'OTRO'])
    expect(mapeo).toEqual({})
  })

  it('exige identificador externo y nombre para avanzar', () => {
    expect(camposObligatoriosFaltantes(ENTIDAD_CLIENTES, {})).toEqual([
      'Identificador del panel actual',
      'Nombre o razón social',
    ])
    expect(camposObligatoriosFaltantes(ENTIDAD_CLIENTES, { 0: 'id_externo' })).toEqual(['Nombre o razón social'])
  })

  it('detecta dos columnas asignadas al mismo campo', () => {
    expect(camposRepetidos({ 0: 'nombre', 1: 'nombre', 2: 'correo' })).toEqual(['nombre'])
  })

  it('construye las filas con el número de fila del archivo y solo los campos mapeados', () => {
    const csv = analizarCsv(CSV_CLIENTES_SINTETICOS)
    const mapeo = mapeoAutomatico(ENTIDAD_CLIENTES, csv.encabezados)
    const filas = construirFilas(csv, mapeo)
    expect(filas).toHaveLength(2)
    expect(filas[0]).toMatchObject({
      fila: 2,
      id_externo: 'SINT-001',
      nombre: 'Cliente Sintético Uno',
      localidad: 'Ciudad Ficticia',
    })
    expect(filas[1]).toMatchObject({ fila: 3, id_externo: 'SINT-002', nombre: 'Cliente Sintético Dos, S.A.' })
  })
})
