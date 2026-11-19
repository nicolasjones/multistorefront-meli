import { describe, expect, it } from 'vitest'
import { DIAS_MAXIMO, DIAS_MINIMO, validarDias } from './diasInactivos'

describe('umbral de días sin comprar', () => {
  it('acepta enteros dentro del rango, con espacios en los extremos', () => {
    expect(validarDias('1')).toEqual({ dias: 1 })
    expect(validarDias('  90 ')).toEqual({ dias: 90 })
    expect(validarDias('3650')).toEqual({ dias: 3650 })
    expect(validarDias('0090')).toEqual({ dias: 90 })
  })

  it('rechaza cero y lo que pasa del máximo', () => {
    expect(validarDias('0')).toHaveProperty('error')
    expect(validarDias('3651')).toHaveProperty('error')
    expect(validarDias(String(DIAS_MAXIMO + 1))).toHaveProperty('error')
  })

  it.each(['', ' ', '-5', '+5', '1,5', '1.5', '1e2', 'abc', '1 0', '１０'])('rechaza %j', (texto) => {
    expect(validarDias(texto)).toHaveProperty('error')
  })

  it('el mensaje nombra el rango válido', () => {
    expect(validarDias('x')).toEqual({ error: `Ingresá un número entero de ${DIAS_MINIMO} a ${DIAS_MAXIMO}.` })
  })
})
