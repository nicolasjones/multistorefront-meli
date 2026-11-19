import { describe, expect, it } from 'vitest'
import {
  formatearValorCosto, MENSAJE_NOMBRE_LARGO, MENSAJE_NOMBRE_OBLIGATORIO, MENSAJE_PORCENTAJE_FUERA_DE_RANGO, MENSAJE_SIN_EMPRESA, MENSAJE_VALOR_INVALIDO,
  mensajeDeErrorCosto, NOMBRE_MAX, parsearValorCosto, soloCaracteresDeValor, validarCostoAdicional, valorATexto,
} from './costosAdicionales'

const entrada = (extra: Partial<Parameters<typeof validarCostoAdicional>[0]> = {}) => ({
  nombre: 'Comisión del canal', tipo: 'porcentaje' as const, valorTexto: '5', empresaIds: ['e1'], ...extra,
})

describe('valor de un costo adicional', () => {
  it.each([
    ['5', 5],
    ['12,5', 12.5],
    ['0', 0],
    ['0,05', 0.05],
    ['100', 100],
    ['  7,25 ', 7.25],
    ['1500000', 1500000],
  ])('lee %j como %d', (texto, esperado) => {
    expect(parsearValorCosto(texto)).toBe(esperado)
  })

  it.each(['', ' ', '-1', '12.5', '1.000', '1,234', ',5', '5,', 'abc', '1e2', '1 000'])('rechaza %j', (texto) => {
    expect(parsearValorCosto(texto)).toBeNull()
  })

  it('el campo solo conserva dígitos y coma', () => {
    expect(soloCaracteresDeValor('$ 1.234,56 abc-')).toBe('1234,56')
    expect(soloCaracteresDeValor('')).toBe('')
    expect(soloCaracteresDeValor('12.5')).toBe('125')
  })
})

describe('validación de un costo adicional', () => {
  it('un costo correcto no tiene errores', () => {
    expect(validarCostoAdicional(entrada())).toEqual({})
    expect(validarCostoAdicional(entrada({ tipo: 'monto', valorTexto: '12500,50' }))).toEqual({})
  })

  it('el nombre es obligatorio y con tope, sin contar espacios de los extremos', () => {
    expect(validarCostoAdicional(entrada({ nombre: '   ' })).nombre).toBe(MENSAJE_NOMBRE_OBLIGATORIO)
    expect(validarCostoAdicional(entrada({ nombre: 'a'.repeat(NOMBRE_MAX) })).nombre).toBeUndefined()
    expect(validarCostoAdicional(entrada({ nombre: ` ${'a'.repeat(NOMBRE_MAX)} ` })).nombre).toBeUndefined()
    expect(validarCostoAdicional(entrada({ nombre: 'a'.repeat(NOMBRE_MAX + 1) })).nombre).toBe(MENSAJE_NOMBRE_LARGO)
  })

  it('el valor inválido se informa para ambos tipos', () => {
    expect(validarCostoAdicional(entrada({ valorTexto: '' })).valor).toBe(MENSAJE_VALOR_INVALIDO)
    expect(validarCostoAdicional(entrada({ tipo: 'monto', valorTexto: 'x' })).valor).toBe(MENSAJE_VALOR_INVALIDO)
  })

  it('el porcentaje no puede pasar de 100, pero un monto sí', () => {
    expect(validarCostoAdicional(entrada({ valorTexto: '100' })).valor).toBeUndefined()
    expect(validarCostoAdicional(entrada({ valorTexto: '100,01' })).valor).toBe(MENSAJE_PORCENTAJE_FUERA_DE_RANGO)
    expect(validarCostoAdicional(entrada({ tipo: 'monto', valorTexto: '250000' })).valor).toBeUndefined()
  })

  it('exige al menos una empresa', () => {
    expect(validarCostoAdicional(entrada({ empresaIds: [] })).empresas).toBe(MENSAJE_SIN_EMPRESA)
  })

  it('informa todos los errores juntos', () => {
    expect(Object.keys(validarCostoAdicional(entrada({ nombre: '', valorTexto: '', empresaIds: [] }))).sort()).toEqual(['empresas', 'nombre', 'valor'])
  })
})

describe('formato del valor de un costo', () => {
  it('un porcentaje muestra hasta dos decimales con coma', () => {
    expect(formatearValorCosto({ tipo: 'porcentaje', valor: 5 })).toBe('5 %')
    expect(formatearValorCosto({ tipo: 'porcentaje', valor: 12.5 })).toBe('12,5 %')
    expect(formatearValorCosto({ tipo: 'porcentaje', valor: 0.25 })).toBe('0,25 %')
  })

  it('un monto muestra pesos con separador de miles', () => {
    expect(formatearValorCosto({ tipo: 'monto', valor: 12500 })).toBe('$ 12.500 por unidad')
  })

  it('un monto con centavos no se redondea a pesos enteros', () => {
    expect(formatearValorCosto({ tipo: 'monto', valor: 12.5 })).toBe('$ 12,50 por unidad')
    expect(formatearValorCosto({ tipo: 'monto', valor: 0.4 })).toBe('$ 0,40 por unidad')
    expect(formatearValorCosto({ tipo: 'monto', valor: 1234.56 })).toBe('$ 1.234,56 por unidad')
  })

  it('un monto entero sigue sin decimales y el porcentaje no cambia', () => {
    expect(formatearValorCosto({ tipo: 'monto', valor: 12 })).toBe('$ 12 por unidad')
    expect(formatearValorCosto({ tipo: 'monto', valor: 0 })).toBe('$ 0 por unidad')
    expect(formatearValorCosto({ tipo: 'porcentaje', valor: 12.5 })).toBe('12,5 %')
  })

  it('el texto del valor vuelve a ser el mismo valor al leerlo (ida y vuelta)', () => {
    for (const valor of [0, 5, 12.5, 0.25, 99.99]) expect(parsearValorCosto(valorATexto(valor))).toBe(valor)
  })
})

describe('mensajes de error de costos adicionales', () => {
  it('traduce cada código sin exponer el texto técnico', () => {
    expect(mensajeDeErrorCosto({ code: '42501' })).toBe('Tu rol no puede editar los costos adicionales de esta empresa.')
    expect(mensajeDeErrorCosto({ code: '23514' })).toBe(MENSAJE_VALOR_INVALIDO)
    expect(mensajeDeErrorCosto({ code: 'P0002' })).toBe('Este costo ya no existe. Actualizá la lista.')
  })

  it('el nombre repetido nombra la empresa cuando se conoce', () => {
    expect(mensajeDeErrorCosto({ code: '23505' }, 'Tienda Norte')).toBe('Ya hay un costo con ese nombre en Tienda Norte.')
    expect(mensajeDeErrorCosto({ code: '23505' })).toBe('Ya hay un costo con ese nombre en esa empresa.')
    expect(mensajeDeErrorCosto({ code: '23505' }, '')).toBe('Ya hay un costo con ese nombre en esa empresa.')
  })

  it('un error desconocido o ausente usa el mensaje general', () => {
    expect(mensajeDeErrorCosto({ code: 'XX000' })).toBe('No pudimos guardar el costo. Intentá de nuevo.')
    expect(mensajeDeErrorCosto(null)).toBe('No pudimos guardar el costo. Intentá de nuevo.')
    expect(mensajeDeErrorCosto(undefined)).toBe('No pudimos guardar el costo. Intentá de nuevo.')
  })
})
