import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  aFormulario, aImporte, claveMensajero, codigoDeError, esConflicto, FORMULARIO_ENVIO_MOTO_VACIO, IMPORTE_MAXIMO, MENSAJE_CONFLICTO,
  MENSAJERO_MAXIMO, mensajeDeErrorEnvioMoto, normalizarMensajero, validarEnvioMoto, type EnvioMoto, type FormularioEnvioMoto,
} from './enviosMoto'

const formulario = (extra: Partial<FormularioEnvioMoto> = {}): FormularioEnvioMoto => ({ ...FORMULARIO_ENVIO_MOTO_VACIO, mensajero: 'Juan', ...extra })
const factura = { requerido: false, elegido: false }

describe('importes del envío en moto', () => {
  it.each([
    ['0', 0],
    ['3500', 3500],
    ['3500,50', 3500.5],
    ['3500.5', 3500.5],
    [' 12 ', 12],
    ['0,05', 0.05],
    ['999999999999,99', IMPORTE_MAXIMO],
  ])('lee %j como %d', (texto, esperado) => {
    expect(aImporte(texto)).toBe(esperado)
  })

  it.each(['', '-1', '1,234', '1.000,00', 'abc', '1e5', ' ', ',5', '1 000', '1000000000000'])('rechaza %j', (texto) => {
    expect(aImporte(texto)).toBeNull()
  })
})

describe('nombre del mensajero', () => {
  it('quita espacios sobrantes y colapsa los internos', () => {
    expect(normalizarMensajero('  Juan   Carlos \t Pérez ')).toBe('Juan Carlos Pérez')
  })

  it('la clave de agrupación ignora mayúsculas y espacios, pero respeta las tildes', () => {
    expect(claveMensajero('  JUAN  pérez ')).toBe('juan pérez')
    expect(claveMensajero('Juan Perez')).not.toBe(claveMensajero('Juan Pérez'))
  })
})

describe('validación del envío en moto', () => {
  it('un envío completo no tiene errores', () => {
    expect(validarEnvioMoto(formulario({ costo_envio: '3500,50', abono: '12000' }), factura)).toEqual({})
  })

  it('exige elegir la factura solo cuando el alta lo requiere', () => {
    expect(validarEnvioMoto(formulario(), { requerido: true, elegido: false }).comprobante).toBe('Elegí la factura del envío.')
    expect(validarEnvioMoto(formulario(), { requerido: true, elegido: true }).comprobante).toBeUndefined()
    expect(validarEnvioMoto(formulario(), { requerido: false, elegido: false }).comprobante).toBeUndefined()
  })

  it('el mensajero es obligatorio y no puede ser solo espacios', () => {
    expect(validarEnvioMoto(formulario({ mensajero: '' }), factura).mensajero).toBe('Escribí el nombre del mensajero.')
    expect(validarEnvioMoto(formulario({ mensajero: '   ' }), factura).mensajero).toBe('Escribí el nombre del mensajero.')
  })

  it('el largo del mensajero se mide después de normalizar los espacios', () => {
    expect(validarEnvioMoto(formulario({ mensajero: 'a'.repeat(MENSAJERO_MAXIMO) }), factura).mensajero).toBeUndefined()
    expect(validarEnvioMoto(formulario({ mensajero: 'a'.repeat(MENSAJERO_MAXIMO + 1) }), factura).mensajero)
      .toBe(`El mensajero no puede superar los ${MENSAJERO_MAXIMO} caracteres.`)
    expect(validarEnvioMoto(formulario({ mensajero: `${'a'.repeat(50)}      ${'b'.repeat(40)}` }), factura).mensajero).toBeUndefined()
  })

  it('pide ingresar los importes (0 si no hay) cuando están vacíos', () => {
    const errores = validarEnvioMoto(formulario({ costo_envio: '', abono: '  ' }), factura)
    expect(errores.costo_envio).toBe('Ingresá el costo de envío (0 si no hay).')
    expect(errores.abono).toBe('Ingresá lo que abona al recibir (0 si no hay).')
  })

  it('rechaza importes negativos, con tres decimales o por encima del máximo', () => {
    expect(validarEnvioMoto(formulario({ costo_envio: '-1' }), factura).costo_envio).toBe('El costo de envío debe ser un importe de 0 en adelante, con hasta dos decimales.')
    expect(validarEnvioMoto(formulario({ abono: '1,999' }), factura).abono).toBe('Lo que abona al recibir debe ser un importe de 0 en adelante, con hasta dos decimales.')
    expect(validarEnvioMoto(formulario({ abono: '1000000000000' }), factura).abono).toBeDefined()
  })

  it('acepta cero como costo y como abono', () => {
    expect(validarEnvioMoto(formulario({ costo_envio: '0', abono: '0' }), factura)).toEqual({})
  })
})

describe('formulario de edición de un envío', () => {
  const envio = (extra: Partial<EnvioMoto> = {}): EnvioMoto => ({
    id: 'e', comprobante_id: 'c', comprobante_numero: '0001', empresa_id: 'x', empresa: 'X', fecha: '2027-01-01', cliente: null, mensajero: 'Juan',
    guia: null, costo_envio: 3500.5, abono: 0, enviado: true, rendido: false, rendido_en: null, actualizado_en: 't', puede_editar: true,
    puede_rendir: false, bloqueado_motivo: null, ...extra,
  })

  it('muestra los importes con coma decimal y la guía vacía como texto vacío', () => {
    expect(aFormulario(envio())).toEqual({ mensajero: 'Juan', guia: '', costo_envio: '3500,5', abono: '0', enviado: true })
  })

  it('el texto del formulario vuelve a ser el mismo importe al validarlo (ida y vuelta)', () => {
    expect(aImporte(aFormulario(envio({ costo_envio: 1234.56 })).costo_envio)).toBe(1234.56)
  })
})

describe('errores del envío en moto', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined) })
  afterEach(() => { vi.restoreAllMocks() })

  it('traduce cada código a castellano', () => {
    expect(mensajeDeErrorEnvioMoto({ code: '40001' }, 'x')).toBe(MENSAJE_CONFLICTO)
    expect(mensajeDeErrorEnvioMoto({ code: '42501' }, 'x')).toContain('Tu rol no puede registrar ni editar envíos en moto')
    expect(mensajeDeErrorEnvioMoto({ code: '23505' }, 'x')).toBe('Ese comprobante ya tiene un envío en moto registrado.')
    expect(mensajeDeErrorEnvioMoto({ code: 'P0002' }, 'x')).toBe('Ese envío no existe o no pertenece a tu organización.')
    expect(mensajeDeErrorEnvioMoto({ code: '22023', message: 'Dato inválido' }, 'x')).toBe('Dato inválido')
  })

  it('un envío bloqueado muestra el motivo de la base o, sin él, el de solo lectura', () => {
    expect(mensajeDeErrorEnvioMoto({ code: '55000', message: 'La factura está anulada' }, 'x')).toBe('La factura está anulada')
    expect(mensajeDeErrorEnvioMoto({ code: '55000' }, 'x')).toContain('solo lectura')
  })

  it('un código desconocido usa el texto por defecto y no expone el mensaje crudo', () => {
    expect(mensajeDeErrorEnvioMoto({ code: 'XX000', message: 'detalle interno' }, 'No pudimos guardar')).toBe('No pudimos guardar')
  })

  it('a la consola va solo el código', () => {
    mensajeDeErrorEnvioMoto({ code: 'XX000', message: 'detalle interno' }, 'No pudimos guardar')
    expect(console.error).toHaveBeenCalledWith('No pudimos guardar', 'XX000')
    expect(codigoDeError(undefined)).toBe('sin código')
  })

  it('reconoce el conflicto de edición por su código', () => {
    expect(esConflicto({ code: '40001' })).toBe(true)
    expect(esConflicto({ code: '23505' })).toBe(false)
    expect(esConflicto(null)).toBe(false)
  })
})
