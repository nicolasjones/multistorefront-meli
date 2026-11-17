import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  aFormulario, aParametrosActualizar, aParametrosCrear, esConflicto, esNombreRepetido, etiquetaTipo, FORMULARIO_TRANSPORTE_VACIO, LARGO_MAXIMO,
  MENSAJE_CONFLICTO, MENSAJE_NOMBRE_REPETIDO, mensajeDeError, ORDEN_MAXIMO, parsearNumero, PLAZO_MAXIMO_DIAS, validarTransporte,
  type FormularioTransporte, type Transporte,
} from './transportes'

const CUIT_VALIDO = '20-12345678-6'
const formulario = (extra: Partial<FormularioTransporte> = {}): FormularioTransporte => ({ ...FORMULARIO_TRANSPORTE_VACIO, nombre: 'Expreso Sur', ...extra })

describe('números del formulario de transportes', () => {
  it.each([
    ['', 0],
    ['  ', 0],
    ['2,5', 2.5],
    ['2.5', 2.5],
    ['10', 10],
    ['-3', -3],
    ['0', 0],
  ])('lee %j como %d', (texto, esperado) => {
    expect(parsearNumero(texto)).toBe(esperado)
  })

  it.each(['abc', '2.', ',5', '1,2,3', '1e2', '+3', '1 0'])('lee %j como NaN', (texto) => {
    expect(parsearNumero(texto)).toBeNaN()
  })
})

describe('validación del transporte', () => {
  it('con solo el nombre es válido (todo lo demás es opcional)', () => {
    expect(validarTransporte(formulario())).toEqual({})
  })

  it('el nombre es obligatorio', () => {
    expect(validarTransporte(formulario({ nombre: '   ' })).nombre).toBe('Ingresá el nombre de la empresa de transporte.')
  })

  describe('CUIT', () => {
    it('es opcional, pero si se carga debe ser válido', () => {
      expect(validarTransporte(formulario({ cuit: '' })).cuit).toBeUndefined()
      expect(validarTransporte(formulario({ cuit: CUIT_VALIDO })).cuit).toBeUndefined()
      expect(validarTransporte(formulario({ cuit: '20123456786' })).cuit).toBeUndefined()
      expect(validarTransporte(formulario({ cuit: '20-12345678-5' })).cuit).toBe('El CUIT no es válido: revisá el dígito verificador.')
      expect(validarTransporte(formulario({ cuit: '2012' })).cuit).toBe('El CUIT debe tener 11 dígitos.')
    })
  })

  describe('correo', () => {
    it.each(['ana@empresa.com', 'a.b+c@sub.dominio.com.ar'])('acepta %j', (correo) => {
      expect(validarTransporte(formulario({ correo })).correo).toBeUndefined()
    })

    it.each(['ana', 'ana@', '@empresa.com', 'ana@empresa', 'ana @empresa.com', 'a@b@c.com'])('rechaza %j', (correo) => {
      expect(validarTransporte(formulario({ correo })).correo).toBe('Ingresá un correo con formato válido, por ejemplo nombre@empresa.com.')
    })

    it('el largo máximo de un correo válido se respeta', () => {
      const largo = `${'a'.repeat(LARGO_MAXIMO.correo)}@x.com`
      expect(validarTransporte(formulario({ correo: largo })).correo).toBe(`Máximo ${LARGO_MAXIMO.correo} caracteres.`)
    })
  })

  describe('comisión', () => {
    it.each(['', '0', '2,5', '2.5', '100', '100,00', '33,33'])('acepta %j', (comision) => {
      expect(validarTransporte(formulario({ comision })).comision).toBeUndefined()
    })

    it.each(['abc', '2.', '1,2,3'])('rechaza %j por no ser un número', (comision) => {
      expect(validarTransporte(formulario({ comision })).comision).toBe('Ingresá la comisión como número, por ejemplo 2,5.')
    })

    it.each(['-1', '100,01', '101', '250'])('rechaza %j por salir del rango de 0 a 100', (comision) => {
      expect(validarTransporte(formulario({ comision })).comision).toBe('La comisión debe estar entre 0 y 100.')
    })

    it('rechaza más de dos decimales', () => {
      expect(validarTransporte(formulario({ comision: '2,555' })).comision).toBe('La comisión admite hasta dos decimales.')
    })
  })

  describe('plazo de rendición y orden', () => {
    it('el plazo debe ser un entero entre 0 y el máximo', () => {
      expect(validarTransporte(formulario({ plazo_rendicion_dias: '30' })).plazo_rendicion_dias).toBeUndefined()
      expect(validarTransporte(formulario({ plazo_rendicion_dias: String(PLAZO_MAXIMO_DIAS) })).plazo_rendicion_dias).toBeUndefined()
      expect(validarTransporte(formulario({ plazo_rendicion_dias: String(PLAZO_MAXIMO_DIAS + 1) })).plazo_rendicion_dias).toBe(`El plazo debe estar entre 0 y ${PLAZO_MAXIMO_DIAS} días.`)
      expect(validarTransporte(formulario({ plazo_rendicion_dias: '-1' })).plazo_rendicion_dias).toBe(`El plazo debe estar entre 0 y ${PLAZO_MAXIMO_DIAS} días.`)
      expect(validarTransporte(formulario({ plazo_rendicion_dias: '2,5' })).plazo_rendicion_dias).toBe('Ingresá los días como un número entero.')
      expect(validarTransporte(formulario({ plazo_rendicion_dias: 'x' })).plazo_rendicion_dias).toBe('Ingresá los días como un número entero.')
    })

    it('el orden debe ser un entero entre 0 y el máximo', () => {
      expect(validarTransporte(formulario({ orden: String(ORDEN_MAXIMO) })).orden).toBeUndefined()
      expect(validarTransporte(formulario({ orden: String(ORDEN_MAXIMO + 1) })).orden).toBe(`El orden debe estar entre 0 y ${ORDEN_MAXIMO}.`)
      expect(validarTransporte(formulario({ orden: '1,5' })).orden).toBe('Ingresá el orden como un número entero.')
    })
  })

  describe('largos máximos', () => {
    it.each(['nombre', 'terminal_retiro', 'localidad', 'telefono', 'persona_contacto', 'direccion'] as const)('%s admite su máximo y rechaza uno más', (campo) => {
      expect(validarTransporte(formulario({ [campo]: 'a'.repeat(LARGO_MAXIMO[campo]) }))[campo]).toBeUndefined()
      expect(validarTransporte(formulario({ [campo]: 'a'.repeat(LARGO_MAXIMO[campo] + 1) }))[campo]).toBe(`Máximo ${LARGO_MAXIMO[campo]} caracteres.`)
    })

    it('el largo se mide sin espacios de los extremos', () => {
      expect(validarTransporte(formulario({ localidad: `  ${'a'.repeat(LARGO_MAXIMO.localidad)}  ` })).localidad).toBeUndefined()
    })
  })

  it('informa varios errores a la vez', () => {
    const errores = validarTransporte(formulario({ nombre: '', cuit: '1', correo: 'x', comision: 'z', plazo_rendicion_dias: 'z', orden: 'z' }))
    expect(Object.keys(errores).sort()).toEqual(['comision', 'correo', 'cuit', 'nombre', 'orden', 'plazo_rendicion_dias'])
  })
})

describe('parámetros de la RPC de transportes', () => {
  it('manda solo dígitos en el CUIT, nulos para los textos vacíos y números para comisión, plazo y orden', () => {
    expect(aParametrosCrear(formulario({
      nombre: '  Expreso Sur ', tipo: 'correo', cuit: CUIT_VALIDO, localidad: ' Rosario ', comision: '2,5', plazo_rendicion_dias: '15', orden: '3',
      cobra_contrarreembolso: true, empresaIds: ['e1', 'e2'],
    }))).toEqual({
      p_nombre: 'Expreso Sur', p_tipo: 'correo', p_cuit: '20123456786', p_terminal_retiro: null, p_localidad: 'Rosario', p_telefono: null, p_correo: null,
      p_persona_contacto: null, p_direccion: null, p_cobra_contrarreembolso: true, p_comision_pct: 2.5, p_plazo_rendicion_dias: 15, p_orden: 3,
      p_activa: true, p_empresa_ids: ['e1', 'e2'],
    })
  })

  it('los campos numéricos vacíos viajan como cero y el CUIT vacío como null', () => {
    const parametros = aParametrosCrear(formulario())
    expect(parametros).toMatchObject({ p_cuit: null, p_comision_pct: 0, p_plazo_rendicion_dias: 0, p_orden: 0 })
  })

  it('la actualización suma el id y el updated_at leído al abrir (bloqueo optimista)', () => {
    expect(aParametrosActualizar(formulario(), { id: 't1', actualizadoEn: '2027-01-01T10:00:00Z' })).toMatchObject({
      p_id: 't1', p_actualizado_en: '2027-01-01T10:00:00Z', p_nombre: 'Expreso Sur',
    })
  })
})

describe('formulario de un transporte existente', () => {
  const transporte = (extra: Partial<Transporte> = {}): Transporte => ({
    id: 't', organizacion_id: 'o', nombre: 'Moto propia', tipo: 'moto_propia', cuit: null, terminal_retiro: null, localidad: null, telefono: null, correo: null,
    persona_contacto: null, direccion: null, cobra_contrarreembolso: false, comision_pct: 2.5, plazo_rendicion_dias: 0, orden: 0, activa: true,
    updated_at: 't', empresas: [{ id: 'e1', nombre: 'A' }, { id: 'e2', nombre: 'B' }], ...extra,
  })

  it('pasa los nulos a texto vacío, la comisión a coma decimal y las empresas a sus ids', () => {
    expect(aFormulario(transporte())).toMatchObject({ cuit: '', localidad: '', comision: '2,5', plazo_rendicion_dias: '0', orden: '0', empresaIds: ['e1', 'e2'] })
  })

  it('un formulario armado desde un transporte existente es válido', () => {
    expect(validarTransporte(aFormulario(transporte({ cuit: '20123456786', correo: 'a@b.com' })))).toEqual({})
  })
})

describe('errores de transportes', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined) })
  afterEach(() => { vi.restoreAllMocks() })

  it('reconoce el nombre repetido por la restricción o por el detalle de la clave', () => {
    expect(esNombreRepetido({ code: '23505', message: 'duplicate key value violates unique constraint "transportes_organizacion_nombre_uq"' })).toBe(true)
    expect(esNombreRepetido({ code: '23505', message: 'otro', details: 'Key (organizacion_id, lower(btrim(nombre)))=(…) already exists.' })).toBe(true)
  })

  it('no confunde otra violación única ni otro código con un nombre repetido', () => {
    expect(esNombreRepetido({ code: '23505', message: 'unique constraint "otra_uq"', details: 'Key (cuit)=(1)' })).toBe(false)
    expect(esNombreRepetido({ code: '23514', message: 'transportes_organizacion_nombre_uq' })).toBe(false)
    expect(esNombreRepetido(null)).toBe(false)
  })

  it('traduce cada código a castellano', () => {
    expect(mensajeDeError({ code: '40001' }, 'x')).toBe(MENSAJE_CONFLICTO)
    expect(mensajeDeError({ code: 'P0002' }, 'x')).toContain('ya no existe')
    expect(mensajeDeError({ code: '42501' }, 'x')).toContain('Solo un Administrador')
    expect(mensajeDeError({ code: '23505', message: 'transportes_organizacion_nombre_uq' }, 'x')).toBe(MENSAJE_NOMBRE_REPETIDO)
    expect(mensajeDeError({ code: '22023' }, 'x')).toContain('Algún dato no es válido')
  })

  it('otro error usa el texto por defecto y a la consola va solo el código', () => {
    expect(mensajeDeError({ code: '23505', message: 'otra_uq' }, 'No pudimos guardar')).toBe('No pudimos guardar')
    expect(console.error).toHaveBeenCalledWith('No pudimos guardar', '23505')
    expect(esConflicto({ code: '40001' })).toBe(true)
  })

  it('el tipo de transporte se muestra con su etiqueta', () => {
    expect(etiquetaTipo('moto_propia')).toBe('Moto propia')
    expect(etiquetaTipo('expreso')).toBe('Expreso')
  })
})
