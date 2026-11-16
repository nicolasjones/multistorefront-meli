import { describe, expect, it } from 'vitest'
import { formatearPesos, formatearPesosConCentavos } from './formatoRanking'

describe('formatoRanking', () => {
  it('formatearPesos redondea a pesos enteros (ranking)', () => {
    expect(formatearPesos(1234567)).toBe('$ 1.234.567')
    expect(formatearPesos(1210.5)).toBe('$ 1.211')
  })

  it('formatearPesosConCentavos: entero sin decimales y con centavos siempre con dos', () => {
    expect(formatearPesosConCentavos(220000)).toBe('$ 220.000')
    expect(formatearPesosConCentavos(0)).toBe('$ 0')
    expect(formatearPesosConCentavos(1210.5)).toBe('$ 1.210,50')
    expect(formatearPesosConCentavos(0.4)).toBe('$ 0,40')
    expect(formatearPesosConCentavos(1234567.89)).toBe('$ 1.234.567,89')
  })

  it('formatearPesosConCentavos: redondea a centavos y no muestra -0 ni NaN', () => {
    expect(formatearPesosConCentavos(1234.999)).toBe('$ 1.235')
    expect(formatearPesosConCentavos(0.004)).toBe('$ 0')
    expect(formatearPesosConCentavos(-0)).toBe('$ 0')
    expect(formatearPesosConCentavos(-1210.5)).toBe('$ -1.210,50')
    expect(formatearPesosConCentavos(Number.NaN)).toBe('—')
    expect(formatearPesosConCentavos(Number.POSITIVE_INFINITY)).toBe('—')
  })
})
