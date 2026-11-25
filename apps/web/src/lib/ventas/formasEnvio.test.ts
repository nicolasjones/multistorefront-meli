import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  aFormulario, COSTO_MAXIMO, esConflicto, formatearCosto, formularioVacio, leerCosto, MENSAJE_CONFLICTO, MENSAJE_COSTO_INVALIDO,
  MENSAJE_NOMBRE_REPETIDO, MENSAJE_NOMBRE_VACIO, mensajeDeError, NOMBRE_MAXIMO, ordenComoEntero, ORDEN_MAXIMO, validarFormaEnvio,
  type FormaEnvio, type FormularioFormaEnvio,
} from './formasEnvio'

const formulario = (extra: Partial<FormularioFormaEnvio> = {}): FormularioFormaEnvio => ({ ...formularioVacio('e1', 3), nombre: 'Expreso Norte', ...extra })

describe('costo por defecto de una forma de envío', () => {
  it('vacío significa sin costo y es válido', () => {
    expect(leerCosto('')).toEqual({ valido: true, valor: null })
    expect(leerCosto('   ')).toEqual({ valido: true, valor: null })
  })

  it.each([
    ['0', 0],
    ['3500', 3500],
    ['3500,5', 3500.5],
    ['3500.50', 3500.5],
    [' 12,34 ', 12.34],
    ['9999999999,99', COSTO_MAXIMO],
  ])('lee %j como %d', (texto, valor) => {
    expect(leerCosto(texto)).toEqual({ valido: true, valor })
  })

  it.each(['-1', '3.500', '3.500,00', '1,234', 'abc', '1e3', ',5', '10000000000', '3 500'])('rechaza %j', (texto) => {
    expect(leerCosto(texto)).toEqual({ valido: false })
  })

  it('el cero es un costo válido distinto de «sin costo»', () => {
    expect(leerCosto('0')).not.toEqual(leerCosto(''))
  })
})

describe('orden de la forma de envío', () => {
  it.each([['0', 0], ['10', 10], [' 9999 ', ORDEN_MAXIMO]])('lee %j como %d', (texto, valor) => {
    expect(ordenComoEntero(texto)).toBe(valor)
  })

  it.each(['', '-1', '1,5', '10000', 'x', '1e2'])('rechaza %j', (texto) => {
    expect(ordenComoEntero(texto)).toBeNull()
  })
})

describe('validación de la forma de envío', () => {
  it('el formulario inicial con nombre es válido', () => {
    expect(validarFormaEnvio(formulario(), { alta: true })).toEqual({})
  })

  it('el nombre es obligatorio y tiene tope de largo', () => {
    expect(validarFormaEnvio(formulario({ nombre: '   ' }), { alta: false }).nombre).toBe(MENSAJE_NOMBRE_VACIO)
    expect(validarFormaEnvio(formulario({ nombre: 'a'.repeat(NOMBRE_MAXIMO) }), { alta: false }).nombre).toBeUndefined()
    expect(validarFormaEnvio(formulario({ nombre: 'a'.repeat(NOMBRE_MAXIMO + 1) }), { alta: false }).nombre).toBe(`Máximo ${NOMBRE_MAXIMO} caracteres.`)
  })

  it('el costo y el orden inválidos se informan por separado', () => {
    const errores = validarFormaEnvio(formulario({ costoDefecto: '-5', orden: 'x' }), { alta: false })
    expect(errores.costoDefecto).toBe(MENSAJE_COSTO_INVALIDO)
    expect(errores.orden).toBe(`El orden es un número entero entre 0 y ${ORDEN_MAXIMO}.`)
  })

  it('en el alta exige al menos una empresa; en la edición no', () => {
    expect(validarFormaEnvio(formulario({ empresaIds: [] }), { alta: true }).empresaIds).toBe('Elegí al menos una empresa.')
    expect(validarFormaEnvio(formulario({ empresaIds: [] }), { alta: false }).empresaIds).toBeUndefined()
  })
})

describe('formulario de una forma de envío existente', () => {
  const forma = (extra: Partial<FormaEnvio> = {}): FormaEnvio => ({
    id: 'f', empresa_id: 'e9', nombre: 'Moto', tipo: 'moto', exige_transporte_guia: false, costo_defecto: null, estado_despacho_inicial: 'armando',
    orden: 4, activo: true, updated_at: 't', ...extra,
  })

  it('un costo nulo queda como texto vacío y un costo cargado como texto numérico', () => {
    expect(aFormulario(forma()).costoDefecto).toBe('')
    expect(aFormulario(forma({ costo_defecto: 0 })).costoDefecto).toBe('0')
    expect(aFormulario(forma({ costo_defecto: 3500.5 })).costoDefecto).toBe('3500.5')
  })

  it('el texto del costo que sale de la base vuelve a ser válido (ida y vuelta)', () => {
    expect(leerCosto(aFormulario(forma({ costo_defecto: 1234.56 })).costoDefecto)).toEqual({ valido: true, valor: 1234.56 })
  })

  it('lleva la empresa de la forma como única empresa y el orden como texto', () => {
    expect(aFormulario(forma())).toMatchObject({ empresaIds: ['e9'], orden: '4', tipo: 'moto', exigeTransporteGuia: false, estadoDespachoInicial: 'armando' })
  })

  it('el formulario vacío arranca con un expreso que exige guía, sin armar y con la empresa dada', () => {
    expect(formularioVacio('e1', 7)).toMatchObject({ tipo: 'expreso', exigeTransporteGuia: true, estadoDespachoInicial: 'sin_armar', orden: '7', empresaIds: ['e1'], activo: true })
  })
})

describe('formato del costo en la lista', () => {
  it('sin costo muestra una raya', () => {
    expect(formatearCosto(null)).toBe('—')
  })

  it('muestra pesos con separador de miles y dos decimales al estilo argentino', () => {
    expect(formatearCosto(0)).toBe('$ 0,00')
    expect(formatearCosto(3500)).toBe('$ 3.500,00')
    expect(formatearCosto(1234567.891)).toBe('$ 1.234.567,89')
  })
})

describe('errores de las formas de envío', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined) })
  afterEach(() => { vi.restoreAllMocks() })

  it('traduce los códigos de la base', () => {
    expect(mensajeDeError({ code: '40001' }, 'x')).toBe(MENSAJE_CONFLICTO)
    expect(mensajeDeError({ code: 'PT412' }, 'x')).toBe(MENSAJE_CONFLICTO)
    expect(mensajeDeError({ code: 'PT404' }, 'x')).toContain('ya no existe')
    expect(mensajeDeError({ code: '23505' }, 'x')).toBe(MENSAJE_NOMBRE_REPETIDO)
    expect(mensajeDeError({ code: 'P0002' }, 'x')).toContain('ya no existe')
    expect(mensajeDeError({ code: '42501' }, 'x')).toContain('No tenés permiso')
    expect(mensajeDeError({ code: '22023' }, 'x')).toContain('Algún dato no es válido')
    expect(mensajeDeError({ code: '23514' }, 'x')).toContain('Algún dato no es válido')
  })

  it('un código desconocido usa el texto por defecto y no expone el detalle', () => {
    expect(mensajeDeError({ code: 'XX000', message: 'detalle' }, 'No pudimos guardar')).toBe('No pudimos guardar')
    expect(console.error).toHaveBeenCalledWith('No pudimos guardar', 'XX000')
    expect(mensajeDeError(null, 'por defecto')).toBe('por defecto')
  })

  it('reconoce el conflicto de edición', () => {
    expect(esConflicto({ code: '40001' })).toBe(true)
    expect(esConflicto({ code: 'PT412' })).toBe(true)
    expect(esConflicto({ code: '23505' })).toBe(false)
  })
})
