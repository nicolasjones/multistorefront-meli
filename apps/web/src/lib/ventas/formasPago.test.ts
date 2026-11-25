import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  aFormulario, esConflicto, formularioVacio, MENSAJE_CONFLICTO, MENSAJE_NOMBRE_REPETIDO, MENSAJE_NOMBRE_VACIO, mensajeDeError, NOMBRE_MAXIMO,
  ordenComoEntero, ORDEN_MAXIMO, validarFormaPago, type FormaPago, type FormularioFormaPago,
} from './formasPago'

const formulario = (extra: Partial<FormularioFormaPago> = {}): FormularioFormaPago => ({ ...formularioVacio('e1', 2), nombre: 'Efectivo', ...extra })

describe('orden de la forma de pago', () => {
  it.each([['0', 0], ['25', 25], [' 9999 ', ORDEN_MAXIMO]])('lee %j como %d', (texto, valor) => {
    expect(ordenComoEntero(texto)).toBe(valor)
  })

  it.each(['', '-3', '2,5', '10000', 'uno', '０'])('rechaza %j', (texto) => {
    expect(ordenComoEntero(texto)).toBeNull()
  })
})

describe('validación de la forma de pago', () => {
  it('un formulario inicial con nombre es válido', () => {
    expect(validarFormaPago(formulario(), { alta: true })).toEqual({})
  })

  it('el nombre es obligatorio (también con solo espacios) y tiene tope de largo', () => {
    expect(validarFormaPago(formulario({ nombre: '' }), { alta: false }).nombre).toBe(MENSAJE_NOMBRE_VACIO)
    expect(validarFormaPago(formulario({ nombre: '  \t ' }), { alta: false }).nombre).toBe(MENSAJE_NOMBRE_VACIO)
    expect(validarFormaPago(formulario({ nombre: 'a'.repeat(NOMBRE_MAXIMO) }), { alta: false }).nombre).toBeUndefined()
    expect(validarFormaPago(formulario({ nombre: 'a'.repeat(NOMBRE_MAXIMO + 1) }), { alta: false }).nombre).toBe(`Máximo ${NOMBRE_MAXIMO} caracteres.`)
  })

  it('el tope de largo se mide sin los espacios de los extremos', () => {
    expect(validarFormaPago(formulario({ nombre: ` ${'a'.repeat(NOMBRE_MAXIMO)} ` }), { alta: false }).nombre).toBeUndefined()
  })

  it('el orden fuera de rango se informa', () => {
    expect(validarFormaPago(formulario({ orden: '10000' }), { alta: false }).orden).toBe(`El orden es un número entero entre 0 y ${ORDEN_MAXIMO}.`)
  })

  it('exige empresa solo en el alta', () => {
    expect(validarFormaPago(formulario({ empresaIds: [] }), { alta: true }).empresaIds).toBe('Elegí al menos una empresa.')
    expect(validarFormaPago(formulario({ empresaIds: [] }), { alta: false })).toEqual({})
  })
})

describe('formulario de una forma de pago', () => {
  const forma: FormaPago = {
    id: 'f', empresa_id: 'e7', nombre: 'Transferencia', tipo: 'transferencia', exige_cuenta_cobro: true, genera_deuda: false, estado_inicial: 'aceptado',
    orden: 0, activo: false, updated_at: 't',
  }

  it('al editar copia los datos, pasa el orden a texto (el cero incluido) y fija la empresa', () => {
    expect(aFormulario(forma)).toEqual({
      nombre: 'Transferencia', tipo: 'transferencia', exigeCuentaCobro: true, generaDeuda: false, estadoInicial: 'aceptado', orden: '0', activo: false, empresaIds: ['e7'],
    })
  })

  it('el formulario nuevo es un efectivo activo, pendiente y sin cuenta ni deuda', () => {
    expect(formularioVacio('e1', 5)).toEqual({
      nombre: '', tipo: 'efectivo', exigeCuentaCobro: false, generaDeuda: false, estadoInicial: 'pendiente', orden: '5', activo: true, empresaIds: ['e1'],
    })
  })
})

describe('errores de las formas de pago', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined) })
  afterEach(() => { vi.restoreAllMocks() })

  it('traduce los códigos de la base', () => {
    expect(mensajeDeError({ code: '40001' }, 'x')).toBe(MENSAJE_CONFLICTO)
    expect(mensajeDeError({ code: 'PT412' }, 'x')).toBe(MENSAJE_CONFLICTO)
    expect(mensajeDeError({ code: 'PT404' }, 'x')).toContain('La forma de pago ya no existe')
    expect(mensajeDeError({ code: '23505' }, 'x')).toBe(MENSAJE_NOMBRE_REPETIDO)
    expect(mensajeDeError({ code: 'P0002' }, 'x')).toContain('La forma de pago ya no existe')
    expect(mensajeDeError({ code: '42501' }, 'x')).toContain('No tenés permiso')
    expect(mensajeDeError({ code: '22023' }, 'x')).toContain('Algún dato no es válido')
    expect(mensajeDeError({ code: '23514' }, 'x')).toContain('Algún dato no es válido')
  })

  it('cualquier otro error usa el texto por defecto sin exponer el mensaje', () => {
    expect(mensajeDeError({ code: '42P01', message: 'relation "dominio.formas_pago" does not exist' }, 'No pudimos guardar')).toBe('No pudimos guardar')
    expect(mensajeDeError(undefined, 'No pudimos guardar')).toBe('No pudimos guardar')
    expect(console.error).toHaveBeenCalledWith('No pudimos guardar', 'sin código')
  })

  it('reconoce el conflicto por su código', () => {
    expect(esConflicto({ code: '40001' })).toBe(true)
    expect(esConflicto({ code: 'PT412' })).toBe(true)
    expect(esConflicto({})).toBe(false)
  })
})
