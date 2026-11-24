import { describe, expect, it } from 'vitest'
import { valorATexto, parsearValorCosto } from './costosAdicionales'
import { formatearPesos } from './formatoRanking'
import { formatoEntero, formatoPesos } from './inicioTablero'
import { formatearCosto as costoListado, formatearPrecioListado } from './productosListado'
import { formatearCosto as costoEnvio } from './ventas/formasEnvio'

// Intl `es-AR` no agrupa los números de 4 dígitos («1234,5» en vez de «1.234,50»): estos formateadores de importes delegan en
// `formatoImporte.ts`, que agrupa a mano. Cada uno conserva su semántica (decimales fijos o pesos enteros).
describe('importes de cuatro dígitos con punto de miles', () => {
  it('listado de productos: precio y costo siempre con dos decimales', () => {
    expect(formatearPrecioListado({ moneda: 'ARS', precioLista: 1234.5, precioArs: 1234.5 })).toBe('$ 1.234,50')
    expect(formatearPrecioListado({ moneda: 'USD', precioLista: 1234, precioArs: 1570000 })).toBe('$ 1.570.000,00 (USD 1.234,00)')
    expect(formatearPrecioListado({ moneda: 'ARS', precioLista: -5, precioArs: -5 })).toBe('$ -5,00')
    expect(costoListado(1234.5)).toBe('1.234,50')
    expect(costoListado('999')).toBe('999,00')
    expect(costoListado(null)).toBe('—')
  })
  it('costo de una forma de envío', () => {
    expect(costoEnvio(1234.5)).toBe('$ 1.234,50')
    expect(costoEnvio(0)).toBe('$ 0,00')
    expect(costoEnvio(null)).toBe('—')
  })
  it('tablero de Inicio: pesos enteros y enteros con miles; redondea al peso', () => {
    expect(formatoPesos(1500)).toBe('$ 1.500')
    expect(formatoPesos(1234.6)).toBe('$ 1.235')
    expect(formatoPesos(-0.4)).toBe('$ 0')
    expect(formatoEntero(1234)).toBe('1.234')
    expect(formatoEntero(999)).toBe('999')
  })
  it('ranking de clientes: pesos enteros con miles', () => {
    expect(formatearPesos(1234)).toBe('$ 1.234')
    expect(formatearPesos(1234567)).toBe('$ 1.234.567')
  })
  it('el campo de un costo adicional NO agrupa (el texto vuelve al campo, que solo admite dígitos y coma)', () => {
    expect(valorATexto(12345.5)).toBe('12345,5')
    expect(parsearValorCosto(valorATexto(12345.5))).toBe(12345.5)
    expect(valorATexto(1500)).toBe('1500')
  })
})
