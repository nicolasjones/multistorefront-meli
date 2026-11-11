import { describe, expect, it } from 'vitest'
import { formatearImporteHistorial } from './formatoHistorial'

describe('formatearImporteHistorial', () => {
  it('enteros sin decimales y con centavos siempre dos (nunca un solo decimal)', () => {
    expect(formatearImporteHistorial(412300)).toBe('$ 412.300')
    expect(formatearImporteHistorial(0)).toBe('$ 0')
    expect(formatearImporteHistorial(412300.5)).toBe('$ 412.300,50')
    expect(formatearImporteHistorial(150.5)).toBe('$ 150,50')
    expect(formatearImporteHistorial(3000.3)).toBe('$ 3.000,30')
    expect(formatearImporteHistorial(0.45)).toBe('$ 0,45')
  })
})
