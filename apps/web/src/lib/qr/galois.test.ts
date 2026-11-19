import { describe, expect, it } from 'vitest'
import { generadorReedSolomon, multiplicarGf, restoReedSolomon } from './galois'

describe('multiplicarGf', () => {
  it('multiplicar por cero o por uno es neutro', () => {
    expect(multiplicarGf(0, 200)).toBe(0)
    expect(multiplicarGf(200, 0)).toBe(0)
    expect(multiplicarGf(1, 173)).toBe(173)
  })

  it('reduce con el polinomio primitivo 0x11D (2 × 128 = 29) y es conmutativa', () => {
    expect(multiplicarGf(2, 128)).toBe(29)
    expect(multiplicarGf(37, 91)).toBe(multiplicarGf(91, 37))
  })
})

describe('generadorReedSolomon', () => {
  it('coincide con el polinomio generador de grado 7 de la norma', () => {
    expect(generadorReedSolomon(7)).toEqual([127, 122, 154, 164, 11, 68, 117])
  })

  it('rechaza grados fuera de 1 a 255 o no enteros', () => {
    expect(() => generadorReedSolomon(0)).toThrow(RangeError)
    expect(() => generadorReedSolomon(256)).toThrow(RangeError)
    expect(() => generadorReedSolomon(2.5)).toThrow(RangeError)
  })
})

describe('restoReedSolomon', () => {
  it('reproduce las 10 palabras de corrección de «HELLO WORLD» en versión 1-M', () => {
    const datos = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17]
    expect(restoReedSolomon(datos, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23])
  })

  it('datos en cero dan corrección en cero', () => {
    expect(restoReedSolomon([0, 0, 0], 4)).toEqual([0, 0, 0, 0])
  })
})
