import { describe, expect, it } from 'vitest'
import { nombreArchivoExportacionTotal } from './exportacionTotal'
import { nombreArchivoExportacion } from './exportarClientes'
import { nombreArchivoComprobantes } from './exportarComprobantes'
import { nombreArchivoCsv } from './exportarCsv'
import { nombreArchivoProductos } from './exportarProductos'
import { nombreArchivoErrores } from './procesosMasivos'

// Las exportaciones nombran el archivo con el día de la ORGANIZACIÓN (Buenos Aires), no el de UTC: 23:30 del 15 en Buenos Aires
// ya es el 16 en UTC (`toISOString().slice(0, 10)` daría «16»). Con `hoyEnOrganizacion` el nombre dice 15.
const A_LAS_2330_AR = new Date('2026-10-16T02:30:00Z')

describe('el día del nombre de archivo de cada exportación es el local de la organización', () => {
  it('sanity: en UTC ya es el día siguiente', () => {
    expect(A_LAS_2330_AR.toISOString().slice(0, 10)).toBe('2026-10-16')
  })
  it('clientes', () => expect(nombreArchivoExportacion(A_LAS_2330_AR)).toBe('clientes-2026-10-15.xlsx'))
  it('comprobantes', () => expect(nombreArchivoComprobantes('comprobantes', A_LAS_2330_AR)).toBe('comprobantes-2026-10-15.csv'))
  it('exportación total', () => expect(nombreArchivoExportacionTotal(A_LAS_2330_AR)).toBe('exportacion-total-2026-10-15.zip'))
  it('CSV de stock y de actividad', () => {
    expect(nombreArchivoCsv('stock-actual', A_LAS_2330_AR)).toBe('stock-actual-2026-10-15.csv')
    expect(nombreArchivoCsv('actividad', A_LAS_2330_AR)).toBe('actividad-2026-10-15.csv')
  })
  it('errores de un proceso masivo', () => expect(nombreArchivoErrores('Carga de precios', A_LAS_2330_AR)).toBe('errores-carga-de-precios-2026-10-15.csv'))
  it('productos', () => expect(nombreArchivoProductos(A_LAS_2330_AR)).toBe('productos-2026-10-15.csv'))
})
