import { describe, expect, it } from 'vitest'
import { ZONA_QUIETA, qrASvg, qrASvgPath } from './svg'

const matriz = (filas: string[]) => filas.map((fila) => [...fila].map((c) => c === '#'))

describe('qrASvg', () => {
  it('fusiona las corridas horizontales de módulos oscuros y desplaza por la zona quieta', () => {
    const { path, lado, viewBox } = qrASvg(matriz(['##.', '...', '.#.']), { zonaQuieta: 1 })
    expect(path).toBe('M1 1h2v1h-2zM2 3h1v1h-1z')
    expect(lado).toBe(5)
    expect(viewBox).toBe('0 0 5 5')
  })

  it('usa la zona quieta de la norma (4 módulos) por defecto', () => {
    const resultado = qrASvg(matriz(['#']))
    expect(ZONA_QUIETA).toBe(4)
    expect(resultado.path).toBe('M4 4h1v1h-1z')
    expect(resultado.lado).toBe(9)
  })

  it('una matriz sin módulos oscuros da un path vacío', () => {
    expect(qrASvgPath(matriz(['..', '..']), { zonaQuieta: 0 })).toBe('')
  })

  it('rechaza una zona quieta que no sea entera de 0 a 16', () => {
    expect(() => qrASvg(matriz(['#']), { zonaQuieta: -1 })).toThrow(RangeError)
    expect(() => qrASvg(matriz(['#']), { zonaQuieta: 17 })).toThrow(RangeError)
    expect(() => qrASvg(matriz(['#']), { zonaQuieta: 1.5 })).toThrow(RangeError)
  })
})
