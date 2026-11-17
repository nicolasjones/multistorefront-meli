import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  armarItemsToma, diferenciaToma, ERROR_CONTADO, leerContado, mensajeDeErrorToma, rotularDiferencia, validarToma, type FilaToma,
} from './tomaInventario'

const fila = (id: string, sistema: number): FilaToma => ({ producto_id: id, nombre: `Producto ${id}`, sku: null, sistema })

describe('lectura del stock contado', () => {
  it('un campo vacío no toca el producto', () => {
    expect(leerContado(undefined)).toEqual({ estado: 'vacio' })
    expect(leerContado('')).toEqual({ estado: 'vacio' })
    expect(leerContado('   ')).toEqual({ estado: 'vacio' })
  })

  it('un entero de cero o más es un contado válido, el cero incluido', () => {
    expect(leerContado('0')).toEqual({ estado: 'ok', valor: 0 })
    expect(leerContado(' 15 ')).toEqual({ estado: 'ok', valor: 15 })
    expect(leerContado('999999999')).toEqual({ estado: 'ok', valor: 999999999 })
  })

  it.each(['-1', '1,5', '1.5', 'abc', '1e3', '1 000', '1000000000', '+3'])('%j es inválido', (texto) => {
    expect(leerContado(texto)).toEqual({ estado: 'invalido' })
  })
})

describe('diferencia contra el sistema', () => {
  it('es contado menos sistema, con signo', () => {
    expect(diferenciaToma(10, '12')).toBe(2)
    expect(diferenciaToma(10, '7')).toBe(-3)
    expect(diferenciaToma(10, '10')).toBe(0)
  })

  it('contar cero con stock en el sistema da una diferencia negativa completa', () => {
    expect(diferenciaToma(8, '0')).toBe(-8)
  })

  it('sin contado válido no hay diferencia', () => {
    expect(diferenciaToma(10, undefined)).toBeNull()
    expect(diferenciaToma(10, '')).toBeNull()
    expect(diferenciaToma(10, 'x')).toBeNull()
  })

  it('el rótulo lleva «+» solo en las diferencias positivas', () => {
    expect(rotularDiferencia(3)).toBe('+3')
    expect(rotularDiferencia(0)).toBe('0')
    expect(rotularDiferencia(-4)).toBe('-4')
  })
})

describe('validación y armado de la toma', () => {
  it('marca solo los productos con un contado inválido; los vacíos no son error', () => {
    expect(validarToma({ a: '5', b: '', c: 'x', d: '-1', e: '0' })).toEqual({ c: ERROR_CONTADO, d: ERROR_CONTADO })
    expect(validarToma({})).toEqual({})
  })

  it('arma ítems solo con los contados válidos de los productos de la tabla', () => {
    const filas = [fila('a', 10), fila('b', 3), fila('c', 7), fila('d', 0)]
    expect(armarItemsToma(filas, { a: '9', b: '', c: 'x', d: '0', zzz: '5' })).toEqual([
      { producto: 'a', contado: 9 },
      { producto: 'd', contado: 0 },
    ])
  })

  it('respeta el orden de la tabla y no incluye productos ajenos a ella', () => {
    expect(armarItemsToma([fila('b', 1), fila('a', 1)], { a: '1', b: '2', otro: '3' }).map((item) => item.producto)).toEqual(['b', 'a'])
  })

  it('sin filas o sin contados no hay ítems', () => {
    expect(armarItemsToma([], { a: '1' })).toEqual([])
    expect(armarItemsToma([fila('a', 1)], {})).toEqual([])
  })
})

describe('errores de la toma', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined) })
  afterEach(() => { vi.restoreAllMocks() })

  it('muestra tal cual el rechazo conocido de la base', () => {
    expect(mensajeDeErrorToma({ message: 'La toma admite hasta 1000 productos por confirmación' }, 'x')).toBe('La toma admite hasta 1000 productos por confirmación')
  })

  it('un texto crudo desconocido no se expone y cae al mensaje general según el código', () => {
    expect(mensajeDeErrorToma({ code: '42501', message: 'permission denied for table stock' }, 'x')).toContain('No tenés permiso')
    expect(mensajeDeErrorToma({ message: 'relation "dominio.stock" does not exist' }, 'No pudimos confirmar')).toBe('No pudimos confirmar')
    expect(mensajeDeErrorToma(null, 'No pudimos confirmar')).toBe('No pudimos confirmar')
  })
})
