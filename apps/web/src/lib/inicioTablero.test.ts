import { describe, expect, it } from 'vitest'
import { formatoEjeCompacto } from './inicioTablero'

describe('formatoEjeCompacto (etiquetas de los ejes del gráfico de Inicio)', () => {
  it('muestra entero hasta 9.999', () => {
    expect(formatoEjeCompacto(0)).toBe('0')
    expect(formatoEjeCompacto(80)).toBe('80')
    expect(formatoEjeCompacto(9999)).toMatch(/^9\.?999$/)
  })
  it('compacta desde 10.000 para que la etiqueta entre en el eje', () => {
    expect(formatoEjeCompacto(10_000)).toMatch(/^10\s?[kK]$/)
    expect(formatoEjeCompacto(38_871_082)).toMatch(/^38,9\s?M$/)
  })
  it('una etiqueta compacta es corta (cabe en el ancho del eje de 64 px)', () => {
    expect(formatoEjeCompacto(38_871_082).length).toBeLessThanOrEqual(6)
  })
  it('un valor nulo no dibuja etiqueta', () => {
    expect(formatoEjeCompacto(null)).toBe('')
  })
})
