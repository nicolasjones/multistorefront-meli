import { describe, expect, it } from 'vitest'
import {
  CAPACIDAD_MAXIMA_BYTES, PLANTILLAS_M, VERSION_MAXIMA, VERSION_MINIMA, bitsDeCantidad, bitsRemanentes, capacidadEnBytes, palabrasDeDatos, plantillaDeVersion, totalDeBloques,
} from './plantillas'

describe('plantillas del QR (corrección M)', () => {
  it('hay una plantilla por versión, en orden', () => {
    expect(PLANTILLAS_M).toHaveLength(VERSION_MAXIMA - VERSION_MINIMA + 1)
    PLANTILLAS_M.forEach((plantilla, indice) => expect(plantilla.version).toBe(indice + 1))
  })

  it('las capacidades en bytes coinciden con la tabla de la norma (versiones 1, 5 y 10)', () => {
    expect(capacidadEnBytes(1)).toBe(14)
    expect(capacidadEnBytes(5)).toBe(84)
    expect(capacidadEnBytes(10)).toBe(213)
    expect(CAPACIDAD_MAXIMA_BYTES).toBe(213)
  })

  it('la capacidad crece con la versión', () => {
    for (let v = 2; v <= VERSION_MAXIMA; v += 1) expect(capacidadEnBytes(v)).toBeGreaterThan(capacidadEnBytes(v - 1))
  })

  it('palabras de datos y bloques suman los dos grupos', () => {
    const v8 = plantillaDeVersion(8)
    expect(palabrasDeDatos(v8)).toBe(2 * 38 + 2 * 39)
    expect(totalDeBloques(v8)).toBe(4)
  })

  it('el indicador de cantidad pasa de 8 a 16 bits en la versión 10', () => {
    expect(bitsDeCantidad(9)).toBe(8)
    expect(bitsDeCantidad(10)).toBe(16)
  })

  it('los bits remanentes son 7 de la versión 2 a la 6 y 0 en el resto', () => {
    expect([1, 2, 6, 7, 10].map(bitsRemanentes)).toEqual([0, 7, 7, 0, 0])
  })

  it('rechaza versiones fuera de rango', () => {
    expect(() => plantillaDeVersion(0)).toThrow(RangeError)
    expect(() => plantillaDeVersion(11)).toThrow(RangeError)
    expect(() => plantillaDeVersion(1.5)).toThrow(RangeError)
  })
})
