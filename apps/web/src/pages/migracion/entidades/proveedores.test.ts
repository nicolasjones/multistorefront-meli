import { describe, expect, it } from 'vitest'
import { analizarCsv } from '../../../lib/migracionCsv'
import {
  camposObligatoriosFaltantes,
  construirFilas,
  contenidoPlantilla,
  mapeoAutomatico,
  marcarIdentificadoresRepetidos,
  type ResultadoFila,
} from '../../../lib/migracion'
import {
  CANTIDAD_PROVEEDORES_SINTETICOS,
  CSV_PROVEEDORES_SINTETICOS,
  CSV_VINCULOS_SINTETICOS,
  ENCABEZADOS_PROVEEDORES,
  ENCABEZADOS_VINCULOS,
  PROVEEDORES_SINTETICOS,
  VINCULOS_POR_PROVEEDOR,
} from '../../../test/fixtures/proveedoresMigracion'
import { validarCuit } from '../../../lib/cuit'
import { ENTIDAD_PROVEEDORES } from './proveedores'
import { ENTIDAD_VINCULOS } from './vinculos'
import { obtenerEntidad } from './registro'

describe('definición de la entidad proveedores (FR-020)', () => {
  it('expone las RPC de proveedores y una plantilla con las columnas esperadas', () => {
    expect(ENTIDAD_PROVEEDORES.rpcPrevisualizar).toBe('previsualizar_lote_proveedores')
    expect(ENTIDAD_PROVEEDORES.rpcAplicar).toBe('aplicar_lote_proveedores')
    expect(ENTIDAD_PROVEEDORES.archivoPlantilla).toBe('proveedores.csv')
    expect(contenidoPlantilla(ENTIDAD_PROVEEDORES).trim().split(',')).toEqual([...ENCABEZADOS_PROVEEDORES])
  })

  it('exige identificador del panel actual, razón social y CUIT para avanzar', () => {
    expect(camposObligatoriosFaltantes(ENTIDAD_PROVEEDORES, {})).toEqual([
      'Identificador del panel actual',
      'Razón social',
      'CUIT',
    ])
  })

  it('auto-mapea la plantilla completa y arma las filas con el número de fila del archivo', () => {
    const csv = analizarCsv(CSV_PROVEEDORES_SINTETICOS)
    const mapeo = mapeoAutomatico(ENTIDAD_PROVEEDORES, csv.encabezados)
    expect(Object.values(mapeo).sort()).toEqual(ENTIDAD_PROVEEDORES.campos.map((campo) => campo.clave).sort())
    const filas = construirFilas(csv, mapeo)
    expect(filas).toHaveLength(CANTIDAD_PROVEEDORES_SINTETICOS)
    expect(filas[0]).toMatchObject({ fila: 2, id_externo: 'SINT-PRV-001', razon_social: 'Proveedor Sintético 001 S.R.L.' })
  })

  it('el fixture trae ~135 proveedores con CUIT válidos y únicos', () => {
    expect(PROVEEDORES_SINTETICOS).toHaveLength(135)
    const cuits = PROVEEDORES_SINTETICOS.map((proveedor) => proveedor.cuit)
    expect(new Set(cuits).size).toBe(cuits.length)
    for (const cuit of cuits) expect(validarCuit(cuit).valido).toBe(true)
  })

  it('ofrece seguir con los vínculos al terminar', () => {
    expect(ENTIDAD_PROVEEDORES.siguiente?.ruta).toBe('/migracion/importar/vinculos-proveedor-producto')
    expect(obtenerEntidad('vinculos-proveedor-producto')).toBe(ENTIDAD_VINCULOS)
  })
})

describe('definición de la entidad vínculos proveedor ↔ producto (FR-022)', () => {
  it('expone las RPC de vínculos y la plantilla esperada', () => {
    expect(ENTIDAD_VINCULOS.id).toBe('vinculos_proveedor_producto')
    expect(ENTIDAD_VINCULOS.rpcPrevisualizar).toBe('previsualizar_lote_vinculos_proveedor_producto')
    expect(ENTIDAD_VINCULOS.rpcAplicar).toBe('aplicar_lote_vinculos_proveedor_producto')
    expect(contenidoPlantilla(ENTIDAD_VINCULOS).trim().split(',')).toEqual([...ENCABEZADOS_VINCULOS])
  })

  it('exige SKU e identificador del proveedor; el código es opcional', () => {
    expect(camposObligatoriosFaltantes(ENTIDAD_VINCULOS, {})).toEqual([
      'SKU del producto',
      'Identificador del proveedor en el panel actual',
    ])
    expect(camposObligatoriosFaltantes(ENTIDAD_VINCULOS, { 0: 'sku', 1: 'proveedor_id_externo' })).toEqual([])
  })

  it('auto-mapea la plantilla y trae dos vínculos por proveedor', () => {
    const csv = analizarCsv(CSV_VINCULOS_SINTETICOS)
    const mapeo = mapeoAutomatico(ENTIDAD_VINCULOS, csv.encabezados)
    expect(Object.values(mapeo)).toEqual(['sku', 'proveedor_id_externo', 'codigo_proveedor'])
    expect(construirFilas(csv, mapeo)).toHaveLength(CANTIDAD_PROVEEDORES_SINTETICOS * VINCULOS_POR_PROVEEDOR)
  })

  it('marca el SKU repetido en el archivo sin distinguir mayúsculas', () => {
    const filas = [
      { fila: 2, sku: 'ABC-1', proveedor_id_externo: 'P1' },
      { fila: 3, sku: 'abc-1', proveedor_id_externo: 'P2' },
    ]
    const resultados: ResultadoFila[] = [
      { fila: 2, estado: 'nueva', motivo: null },
      { fila: 3, estado: 'nueva', motivo: null },
    ]
    const marcados = marcarIdentificadoresRepetidos(
      filas,
      resultados,
      ENTIDAD_VINCULOS.campoClave,
      ENTIDAD_VINCULOS.claveSinMayusculas,
    )
    expect(marcados[0].estado).toBe('nueva')
    expect(marcados[1]).toEqual({ fila: 3, estado: 'error', motivo: 'El SKU está repetido en el archivo' })
  })
})
