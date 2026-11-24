import { describe, expect, it } from 'vitest'
import { formatearImporte, formatearImporteHasta, formatearNumeroImporte } from './formatoImporte'
import { formatearPrecioTienda } from './tiendaCatalogo'
import { formatearPesosPrecio } from './precios'
import { formatearPesosPromocion } from './promociones'
import { formatearImporteHistorial } from './formatoHistorial'
import { formatearPesosConCentavos } from './formatoRanking'
import { formatearARS } from './serviceTecnico'
import { formatearImporteArs } from './tiendaCuentaDatos'
import { formatearImporteGasto } from './gastos'

describe('formatearImporte', () => {
  it('muestra el entero sin decimales y con punto de miles, también de cuatro dígitos', () => {
    expect(formatearImporte(64200)).toBe('$ 64.200')
    expect(formatearImporte(1500)).toBe('$ 1.500')
    expect(formatearImporte(0)).toBe('$ 0')
  })
  it('un solo decimal lleva cero final: nunca «64.200,5»', () => {
    expect(formatearImporte(64200.5)).toBe('$ 64.200,50')
    expect(formatearImporte(0.4)).toBe('$ 0,40')
    expect(formatearImporte(1210.05)).toBe('$ 1.210,05')
  })
  it('redondea a centavos antes de decidir si hay decimales', () => {
    expect(formatearImporte(1234.999)).toBe('$ 1.235')
    expect(formatearImporte(-0.001)).toBe('$ 0')
  })
  it('signo menos delante y «—» si no es un número', () => {
    expect(formatearImporte(-12500.5)).toBe('-$ 12.500,50')
    expect(formatearImporte(Number.NaN)).toBe('—')
  })
  it('puede forzar dos decimales y otro símbolo', () => {
    expect(formatearImporte(12500, { centavos: 'siempre' })).toBe('$ 12.500,00')
    expect(formatearImporte(10, { centavos: 'siempre', simbolo: 'US$' })).toBe('US$ 10,00')
  })
})

describe('los formateadores de cada pantalla usan el compartido', () => {
  const valor = 64200.5
  const esperado = '$ 64.200,50'
  it('dan lo mismo para un importe con un solo decimal', () => {
    expect(formatearPesosPrecio(valor)).toBe(esperado)
    expect(formatearPesosPromocion(valor)).toBe(esperado)
    expect(formatearImporteHistorial(valor)).toBe(esperado)
    expect(formatearPesosConCentavos(valor)).toBe(esperado)
    expect(formatearARS(valor).replace(/\s/g, ' ')).toBe(esperado)
    expect(formatearImporteArs(valor)).toBe(esperado)
    expect(formatearImporteGasto(valor, 'ARS')).toBe(esperado)
  })
})

describe('formatearImporteHasta', () => {
  it('conserva hasta 4 decimales y agrupa los miles', () => {
    expect(formatearImporteHasta(1465, 4)).toBe('$ 1.465')
    expect(formatearImporteHasta(1465.5, 4)).toBe('$ 1.465,50')
    expect(formatearImporteHasta(1465.125, 4)).toBe('$ 1.465,125')
    expect(formatearImporteHasta(1465.1234, 4)).toBe('$ 1.465,1234')
  })

  it('no muestra ceros de más y conserva el centavo mínimo', () => {
    expect(formatearImporteHasta(0.01, 4)).toBe('$ 0,01')
    expect(formatearImporteHasta(0.005, 4)).toBe('$ 0,005')
    expect(formatearImporteHasta(0, 4)).toBe('$ 0')
    expect(formatearImporteHasta(Number.NaN, 4)).toBe('—')
  })
})

describe('formatearNumeroImporte', () => {
  it('da solo el número con miles también de cuatro dígitos y siempre dos decimales si se pide', () => {
    expect(formatearNumeroImporte(1500, { centavos: 'siempre' })).toBe('1.500,00')
    expect(formatearNumeroImporte(64200.5, { centavos: 'siempre' })).toBe('64.200,50')
    expect(formatearNumeroImporte(-1500.5, { centavos: 'siempre' })).toBe('-1.500,50')
    expect(formatearNumeroImporte(Number.NaN)).toBe('—')
  })
  it('el precio de la tienda agrupa cuatro dígitos', () => {
    expect(formatearPrecioTienda('ARS', 1500)).toBe('ARS 1.500,00')
  })
})
