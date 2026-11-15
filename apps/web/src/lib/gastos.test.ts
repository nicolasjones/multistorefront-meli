import { describe, expect, it } from 'vitest'
import {
  COLUMNAS_CSV_GASTOS,
  TIPO_POR_OMISION,
  formatearImporteGasto,
  mensajeDeErrorGasto,
  parsearImporteGasto,
  rangoDePeriodoGasto,
  validarGasto,
} from './gastos'
import { armarCsv } from './exportarCsv'

// 2026-11-15 12:00 en Buenos Aires.
const AHORA = new Date('2026-11-15T15:00:00Z')

describe('períodos de gastos', () => {
  it('calcula hoy, semana, mes y mes anterior en hora de Buenos Aires', () => {
    expect(rangoDePeriodoGasto('hoy', AHORA)).toEqual({ desde: '2026-11-15', hasta: '2026-11-15' })
    expect(rangoDePeriodoGasto('semana', AHORA)).toEqual({ desde: '2026-11-09', hasta: '2026-11-15' })
    expect(rangoDePeriodoGasto('mes', AHORA)).toEqual({ desde: '2026-11-01', hasta: '2026-11-15' })
    expect(rangoDePeriodoGasto('mes-anterior', AHORA)).toEqual({ desde: '2026-10-01', hasta: '2026-10-31' })
  })

  it('usa la fecha de la organización aunque en UTC ya sea otro día', () => {
    expect(rangoDePeriodoGasto('hoy', new Date('2026-11-16T01:30:00Z')).hasta).toBe('2026-11-15')
  })

  it('el mes anterior de enero es diciembre del año anterior', () => {
    expect(rangoDePeriodoGasto('mes-anterior', new Date('2027-01-10T15:00:00Z'))).toEqual({ desde: '2026-12-01', hasta: '2026-12-31' })
  })
})

describe('validación de un gasto', () => {
  const valido = { fecha: '2026-11-06', categoria: 'Servicios' as const, importeTexto: '36800', detalle: '', empresaIds: ['e1'] }

  it('acepta un gasto completo', () => {
    expect(validarGasto(valido, AHORA)).toEqual({})
  })

  it('rechaza importe cero, vacío o con formato raro y acepta decimales con coma', () => {
    expect(validarGasto({ ...valido, importeTexto: '0' }, AHORA).importe).toBeTruthy()
    expect(validarGasto({ ...valido, importeTexto: '' }, AHORA).importe).toBeTruthy()
    expect(validarGasto({ ...valido, importeTexto: '1,234' }, AHORA).importe).toBeTruthy()
    expect(parsearImporteGasto('1250,50')).toBe(1250.5)
  })

  it('rechaza fecha a más de 31 días, concepto vacío, detalle largo y tienda sin elegir', () => {
    expect(validarGasto({ ...valido, fecha: '2027-01-30' }, AHORA).fecha).toBeTruthy()
    expect(validarGasto({ ...valido, fecha: '2026-12-16' }, AHORA).fecha).toBeUndefined()
    expect(validarGasto({ ...valido, fecha: '1999-12-31' }, AHORA).fecha).toMatch(/2000/)
    expect(validarGasto({ ...valido, fecha: '2000-01-01' }, AHORA).fecha).toBeUndefined()
    expect(validarGasto({ ...valido, categoria: '' }, AHORA).categoria).toBeTruthy()
    expect(validarGasto({ ...valido, detalle: 'x'.repeat(201) }, AHORA).detalle).toBeTruthy()
    expect(validarGasto({ ...valido, empresaIds: [] }, AHORA).empresa).toBeTruthy()
  })

  it('precarga el tipo de costo según el concepto', () => {
    expect(TIPO_POR_OMISION.Alquiler).toBe('fijo')
    expect(TIPO_POR_OMISION.Fletes).toBe('variable')
    expect(TIPO_POR_OMISION.Impuestos).toBe('variable')
  })
})

describe('mensajes y formato', () => {
  it('traduce los códigos de la base', () => {
    expect(mensajeDeErrorGasto({ code: '42501' })).toMatch(/rol/)
    expect(mensajeDeErrorGasto({ code: '40001' })).toMatch(/Recargá/)
    expect(mensajeDeErrorGasto({ code: '22023', message: 'Cargá la cotización del dólar' })).toBe('Cargá la cotización del dólar')
    expect(mensajeDeErrorGasto({ code: 'XX' }, 'Falló')).toBe('Falló')
  })

  it('en 22023 solo muestra los mensajes conocidos; cualquier otro texto del servidor no se filtra a la pantalla', () => {
    expect(mensajeDeErrorGasto({ code: '22023', message: 'Un gasto anulado no se puede editar' })).toBe('Un gasto anulado no se puede editar')
    expect(mensajeDeErrorGasto({ code: '22023', message: 'new row violates check constraint "gastos_moneda_ck"' })).toBe('No pudimos guardar el gasto. Intentá de nuevo.')
    expect(mensajeDeErrorGasto({ code: '22023', message: 'x' }, 'No pudimos anular el gasto. Intentá de nuevo.')).toBe('No pudimos anular el gasto. Intentá de nuevo.')
    expect(mensajeDeErrorGasto({ code: '22023' })).toBe('No pudimos guardar el gasto. Intentá de nuevo.')
  })

  it('formatea pesos y dólares', () => {
    expect(formatearImporteGasto(36800, 'ARS')).toBe('$ 36.800,00')
    expect(formatearImporteGasto(500, 'USD')).toBe('US$ 500,00')
  })

  it('el CSV lleva moneda, importe original e importe en pesos y neutraliza fórmulas', () => {
    const csv = armarCsv(COLUMNAS_CSV_GASTOS, [{
      fecha: '2026-11-06', empresa: 'San Javucho', categoria: 'Servicios', tipo_costo: 'fijo', detalle: '=1+1', moneda: 'USD',
      importe: 500, cotizacion_usada: 1000, importe_pesos: 500000, recurrente: true, anulado: false, motivo_anulacion: null,
    }])
    expect(csv).toContain('Moneda;Importe;Cotización usada;Importe en pesos')
    expect(csv).toContain("USD;500;1000;500000;Sí;No")
    expect(csv).not.toContain(';=1+1')
  })
})
