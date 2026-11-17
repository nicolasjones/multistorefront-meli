import { describe, expect, it } from 'vitest'
import { calcularFinal, formatearAlicuota, mensajeErrorIva } from './iva'

const IVA_21 = { porcentaje: 21, exento: false }
const IVA_10_5 = { porcentaje: 10.5, exento: false }
const EXENTO = { porcentaje: 0, exento: true }

describe('calcularFinal (F-PRE-12, FR-021)', () => {
  it('aplica 21 % y 10,5 % al centavo', () => {
    expect(calcularFinal(29186, IVA_21)).toBe(35315.06)
    expect(calcularFinal(29186, IVA_10_5)).toBe(32250.53)
    expect(calcularFinal(100.1, IVA_21)).toBe(121.12)
  })

  it('Exento deja el final igual al neto', () => {
    expect(calcularFinal(29186, EXENTO)).toBe(29186)
  })

  it('redondea la mitad de un centavo hacia arriba', () => {
    expect(calcularFinal(10.05, { porcentaje: 10, exento: false })).toBe(11.06)
    expect(calcularFinal(100.5, { porcentaje: 0, exento: false })).toBe(100.5)
  })
})

describe('formatearAlicuota', () => {
  it('muestra el porcentaje con coma o «Exento»', () => {
    expect(formatearAlicuota(IVA_21)).toBe('21 %')
    expect(formatearAlicuota(IVA_10_5)).toBe('10,5 %')
    expect(formatearAlicuota(EXENTO)).toBe('Exento')
  })
})

describe('mensajeErrorIva', () => {
  it('mapea los códigos conocidos sin filtrar el texto de Postgres', () => {
    expect(mensajeErrorIva({ code: '23514', message: 'detalle interno' }, 'x')).toBe('Esa alícuota no está activa. Elegí otra.')
    expect(mensajeErrorIva({ code: '42501' }, 'x')).toContain('Tu rol no puede cambiar el IVA')
    expect(mensajeErrorIva({ code: '99999' }, 'por defecto')).toBe('por defecto')
  })
})
