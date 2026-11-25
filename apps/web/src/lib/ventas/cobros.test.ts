import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import {
  aParametrosRegistrar, cobroRevertible, codigoDeErrorCobro, comprobanteAdmiteCobros, errorDeCampoCobro, esContrarreembolso, FORMULARIO_COBRO_VACIO,
  MENSAJE_MOTIVO_REVERSION, mensajeDeErrorCobro, mensajeDeErrorReversion, parsearImporteCobro, revertirCobro, textoCuentaCobro, validarCobro, validarMotivoReversion, type Cobro, type FormularioCobro,
} from './cobros'

const formulario = (extra: Partial<FormularioCobro> = {}): FormularioCobro => ({ ...FORMULARIO_COBRO_VACIO, forma_pago_id: 'fp1', importe: '100', ...extra })

describe('importe de un cobro', () => {
  it.each([
    ['400', 400],
    ['400,50', 400.5],
    ['400.5', 400.5],
    ['0', 0],
    ['0,01', 0.01],
    ['  25  ', 25],
    ['999999999999,99', 999999999999.99],
  ])('lee %j como %d', (texto, esperado) => {
    expect(parsearImporteCobro(texto)).toBe(esperado)
  })

  it.each(['', ' ', 'abc', '-5', '+5', '1.000,50', '1,000.50', '12,345', '1e3', '0x10', ',5', '5,', '1234567890123', '１２３'])(
    'rechaza %j',
    (texto) => {
      expect(parsearImporteCobro(texto)).toBeNull()
    },
  )
})

describe('validación del cobro contra el saldo', () => {
  const contexto = { saldo: 1000, exigeCuenta: false }

  it('un cobro correcto no tiene errores', () => {
    expect(validarCobro(formulario(), contexto)).toEqual({})
  })

  it('permite cobrar exactamente el saldo y rechaza un centavo más', () => {
    expect(validarCobro(formulario({ importe: '1000' }), contexto)).toEqual({})
    expect(validarCobro(formulario({ importe: '1000,01' }), contexto).importe).toBe('El importe no puede superar el saldo pendiente ($ 1.000).')
  })

  it('el mensaje de tope formatea el saldo con decimales cuando los tiene', () => {
    expect(validarCobro(formulario({ importe: '2000' }), { saldo: 1234.5, exigeCuenta: false }).importe).toContain('$ 1.234,50')
  })

  it('exige elegir la forma de pago', () => {
    expect(validarCobro(formulario({ forma_pago_id: '  ' }), contexto).forma_pago_id).toBe('Elegí la forma de pago.')
  })

  it('exige cuenta de cobro solo si la forma de pago la pide', () => {
    expect(validarCobro(formulario(), contexto).cuenta_cobro_id).toBeUndefined()
    expect(validarCobro(formulario(), { ...contexto, exigeCuenta: true }).cuenta_cobro_id).toBe('La forma de pago exige una cuenta de cobro.')
    expect(validarCobro(formulario({ cuenta_cobro_id: 'c1' }), { ...contexto, exigeCuenta: true })).toEqual({})
  })

  it('distingue importe vacío, mal escrito y en cero', () => {
    expect(validarCobro(formulario({ importe: '' }), contexto).importe).toBe('Ingresá el importe del cobro.')
    expect(validarCobro(formulario({ importe: '   ' }), contexto).importe).toBe('Ingresá el importe del cobro.')
    expect(validarCobro(formulario({ importe: '12,345' }), contexto).importe).toBe('Ingresá el importe como número, con hasta dos decimales.')
    expect(validarCobro(formulario({ importe: '-3' }), contexto).importe).toBe('Ingresá el importe como número, con hasta dos decimales.')
    expect(validarCobro(formulario({ importe: '0' }), contexto).importe).toBe('El importe tiene que ser mayor a cero.')
    expect(validarCobro(formulario({ importe: '0,00' }), contexto).importe).toBe('El importe tiene que ser mayor a cero.')
  })

  it('con saldo no finito no se aplica el tope (lo decide la base)', () => {
    expect(validarCobro(formulario({ importe: '5000000' }), { saldo: Number.NaN, exigeCuenta: false })).toEqual({})
    expect(validarCobro(formulario({ importe: '5000000' }), { saldo: Number.POSITIVE_INFINITY, exigeCuenta: false })).toEqual({})
  })

  it('con saldo cero cualquier cobro positivo supera el tope', () => {
    expect(validarCobro(formulario({ importe: '1' }), { saldo: 0, exigeCuenta: false }).importe).toContain('saldo pendiente')
  })

  it('acumula los errores de varios campos a la vez', () => {
    const errores = validarCobro(formulario({ forma_pago_id: '', importe: '' }), { saldo: 10, exigeCuenta: true })
    expect(Object.keys(errores).sort()).toEqual(['cuenta_cobro_id', 'forma_pago_id', 'importe'])
  })
})

describe('parámetros de la RPC de registrar cobro', () => {
  it('manda el importe numérico, el bloqueo optimista en null y recorta los ids', () => {
    expect(aParametrosRegistrar('comp1', formulario({ importe: '1500,25', forma_pago_id: ' fp1 ', cuenta_cobro_id: ' c1 ' }))).toEqual({
      p_comprobante_id: 'comp1', p_importe: 1500.25, p_forma_pago_id: 'fp1', p_cuenta_cobro_id: 'c1', p_actualizado_en: null,
    })
  })

  it('la cuenta de cobro vacía viaja como null', () => {
    expect(aParametrosRegistrar('comp1', formulario()).p_cuenta_cobro_id).toBeNull()
  })

  it('la forma de pago vacía viaja como null', () => {
    expect(aParametrosRegistrar('comp1', formulario({ forma_pago_id: '' })).p_forma_pago_id).toBeNull()
  })

  it('lanza si el importe no es un número válido', () => {
    expect(() => aParametrosRegistrar('comp1', formulario({ importe: 'abc' }))).toThrow('El importe del cobro no es un número válido')
    expect(() => aParametrosRegistrar('comp1', formulario({ importe: '' }))).toThrow()
  })
})

describe('errores del cobro', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined) })
  afterEach(() => { vi.restoreAllMocks() })

  it('apunta al campo cuando la base manda el hint de un campo conocido', () => {
    expect(errorDeCampoCobro({ code: '22023', hint: 'importe', message: 'El importe es inválido' })).toEqual({ campo: 'importe', mensaje: 'El importe es inválido' })
    expect(errorDeCampoCobro({ code: 'P0001', hint: 'forma_pago_id', message: 'x' })).toEqual({ campo: 'forma_pago_id', mensaje: 'x' })
  })

  it.each([
    [{ code: '22023', hint: 'otro_campo', message: 'x' }],
    [{ code: '22023', hint: 'importe' }],
    [{ code: '22023', message: 'x' }],
    [{ code: '42501', hint: 'importe', message: 'x' }],
    [null],
    [undefined],
  ])('no apunta a ningún campo con %j', (error) => {
    expect(errorDeCampoCobro(error)).toBeNull()
  })

  it('traduce cada código de la base a un mensaje en castellano', () => {
    expect(mensajeDeErrorCobro({ code: '42501' }, 'x')).toContain('No tenés permiso para registrar cobros')
    expect(mensajeDeErrorCobro({ code: 'P0002' }, 'x')).toBe('Ese comprobante no existe o no pertenece a tu organización.')
    expect(mensajeDeErrorCobro({ code: 'PT404' }, 'x')).toBe('Ese comprobante no existe o no pertenece a tu organización.')
    expect(mensajeDeErrorCobro({ code: 'P0001' }, 'x')).toBe('El importe supera el saldo pendiente de la factura.')
    expect(mensajeDeErrorCobro({ code: '55000' }, 'x')).toBe('Esta factura no admite cobros: está en borrador o anulada.')
    expect(mensajeDeErrorCobro({ code: '22023', message: 'Cuenta inactiva' }, 'x')).toBe('Cuenta inactiva')
  })

  it('un 22023 sin mensaje y los códigos desconocidos usan el texto por defecto', () => {
    expect(mensajeDeErrorCobro({ code: '22023' }, 'por defecto')).toBe('por defecto')
    expect(mensajeDeErrorCobro({ code: 'XX000', message: 'relation "dominio.cobros" does not exist' }, 'por defecto')).toBe('por defecto')
    expect(mensajeDeErrorCobro(null, 'por defecto')).toBe('por defecto')
  })

  it('a la consola va solo el código, nunca el detalle de la base', () => {
    expect(codigoDeErrorCobro({ code: '23514', message: 'detalle con datos' })).toBe('23514')
    expect(codigoDeErrorCobro({ message: 'sin código' })).toBe('sin código')
    expect(codigoDeErrorCobro(null)).toBe('sin código')
  })
})

describe('qué comprobantes admiten cobros', () => {
  it('solo una factura confirmada y no anulada', () => {
    expect(comprobanteAdmiteCobros({ tipo: 'factura', estado: 'confirmada' })).toBe(true)
    expect(comprobanteAdmiteCobros({ tipo: 'factura', estado: 'deuda' })).toBe(true)
    expect(comprobanteAdmiteCobros({ tipo: 'factura', estado: 'cobrado' })).toBe(true)
    expect(comprobanteAdmiteCobros({ tipo: 'factura', estado: 'borrador' })).toBe(false)
    expect(comprobanteAdmiteCobros({ tipo: 'factura', estado: 'anulada' })).toBe(false)
  })

  it('un presupuesto nunca admite cobros, aunque esté aceptado', () => {
    expect(comprobanteAdmiteCobros({ tipo: 'presupuesto', estado: 'aceptado' })).toBe(false)
    expect(comprobanteAdmiteCobros({ tipo: 'presupuesto', estado: 'confirmada' })).toBe(false)
  })
})

describe('cómo se muestra un cobro', () => {
  const cobro = (extra: Partial<Cobro> = {}): Cobro => ({
    id: 'c', fecha: '2027-01-01', forma_pago: 'Efectivo', forma_pago_tipo: 'efectivo', cuenta_cobro: null, cuenta_cobro_banco: null,
    cuenta_cobro_titular: null, importe: 10, origen: 'manual', conciliado: false, aprobado_por: null, registrado_por: null, estado_reversion: null, motivo_reversion: null, ...extra,
  })

  it('sin cuenta de cobro el campo queda vacío', () => {
    expect(textoCuentaCobro(cobro())).toBeNull()
    expect(textoCuentaCobro(cobro({ cuenta_cobro: '  ', cuenta_cobro_banco: ' ', cuenta_cobro_titular: '' }))).toBeNull()
  })

  it('arma «Banco · Titular» y, si falta uno, muestra el que haya', () => {
    expect(textoCuentaCobro(cobro({ cuenta_cobro: 'Caja', cuenta_cobro_banco: 'Galicia', cuenta_cobro_titular: 'Ana Pérez' }))).toBe('Galicia · Ana Pérez')
    expect(textoCuentaCobro(cobro({ cuenta_cobro: 'Caja', cuenta_cobro_banco: 'Galicia' }))).toBe('Galicia')
    expect(textoCuentaCobro(cobro({ cuenta_cobro: 'Caja', cuenta_cobro_titular: 'Ana Pérez' }))).toBe('Ana Pérez')
  })

  it('con solo el nombre de la cuenta muestra ese nombre', () => {
    expect(textoCuentaCobro(cobro({ cuenta_cobro: ' Caja chica ' }))).toBe('Caja chica')
  })

  it('el contrarreembolso se reconoce por el tipo de la forma de pago, no por su nombre', () => {
    expect(esContrarreembolso(cobro({ forma_pago: 'Contrarreembolso', forma_pago_tipo: 'efectivo' }))).toBe(false)
    expect(esContrarreembolso(cobro({ forma_pago: 'Pago en destino', forma_pago_tipo: 'contrarreembolso' }))).toBe(true)
    expect(esContrarreembolso(cobro({ forma_pago_tipo: null }))).toBe(false)
  })
})

describe('revertir un cobro', () => {
  const base: Cobro = {
    id: 'c', fecha: '2027-01-01', forma_pago: 'Efectivo', forma_pago_tipo: 'efectivo', cuenta_cobro: null, cuenta_cobro_banco: null,
    cuenta_cobro_titular: null, importe: 10, origen: 'manual', conciliado: false, aprobado_por: null, registrado_por: null,
    estado_reversion: null, motivo_reversion: null,
  }

  it('solo un cobro manual, sin reversión y sin conciliar es revertible', () => {
    expect(cobroRevertible(base)).toBe(true)
    expect(cobroRevertible({ ...base, estado_reversion: 'revertido' })).toBe(false)
    expect(cobroRevertible({ ...base, origen: 'reversion', estado_reversion: 'reversion' })).toBe(false)
    expect(cobroRevertible({ ...base, origen: 'contrarreembolso' })).toBe(false)
    expect(cobroRevertible({ ...base, conciliado: true })).toBe(false)
  })

  it('el motivo es obligatorio, se recorta y admite hasta 300 caracteres', () => {
    expect(validarMotivoReversion('   ')).toBe(MENSAJE_MOTIVO_REVERSION)
    expect(validarMotivoReversion('Error de carga')).toBeNull()
    expect(validarMotivoReversion('x'.repeat(300))).toBeNull()
    expect(validarMotivoReversion('x'.repeat(301))).toMatch(/hasta 300/)
  })

  it('manda el motivo recortado a la RPC y devuelve el id del contra-asiento', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: 'b-contra', error: null })
    await expect(revertirCobro('c-1', '  Duplicado  ')).resolves.toBe('b-contra')
    expect(mocks.rpc).toHaveBeenCalledWith('revertir_cobro', { p_cobro_id: 'c-1', p_motivo: 'Duplicado' })
  })

  it('traduce los códigos de la base sin filtrar mensajes técnicos', () => {
    expect(mensajeDeErrorReversion({ code: '42501', message: 'x' }, 'por defecto')).toMatch(/Solo el administrador/)
    expect(mensajeDeErrorReversion({ code: 'PT404' }, 'por defecto')).toMatch(/ya no existe/)
    expect(mensajeDeErrorReversion({ code: '55000', message: 'El cobro ya fue revertido' }, 'por defecto')).toBe('El cobro ya fue revertido')
    expect(mensajeDeErrorReversion({ code: 'XX000', message: 'relation x' }, 'por defecto')).toBe('por defecto')
  })
})
