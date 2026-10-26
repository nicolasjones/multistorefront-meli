import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import {
  aParametrosRegistrar,
  cobrosDeComprobante,
  errorDeCampoCobro,
  FORMULARIO_COBRO_VACIO,
  mensajeDeErrorCobro,
  parsearImporteCobro,
  registrarCobro,
  saldoComprobante,
  validarCobro,
} from '../../lib/ventas/cobros'

// Bloque de la lib de cobros (F-VTA-12, T006): los bloques de la tarjeta Cobros y del diálogo
// «Registrar cobro» llegan con T007…T010 en este mismo archivo.

const FORMULARIO = {
  forma_pago_id: 'f-2',
  cuenta_cobro_id: 'c-1',
  importe: '400,50',
}

describe('parsearImporteCobro', () => {
  it('acepta «400» y «400,50»', () => {
    expect(parsearImporteCobro('400')).toBe(400)
    expect(parsearImporteCobro(' 400,50 ')).toBe(400.5)
  })

  it('rechaza lo que la base no acepta: letras, miles y más de dos decimales', () => {
    expect(parsearImporteCobro('400,555')).toBeNull()
    expect(parsearImporteCobro('1.000')).toBeNull()
    expect(parsearImporteCobro('cuatrocientos')).toBeNull()
    expect(parsearImporteCobro('-50')).toBeNull()
    expect(parsearImporteCobro('')).toBeNull()
  })
})

describe('validarCobro', () => {
  it('acepta un cobro válido', () => {
    expect(validarCobro(FORMULARIO, { saldo: 1000, exigeCuenta: true })).toEqual({})
  })

  it('pide la forma de pago', () => {
    expect(validarCobro({ ...FORMULARIO, forma_pago_id: '' }, { saldo: 1000, exigeCuenta: false }).forma_pago_id).toBeDefined()
  })

  it('pide la cuenta de cobro solo cuando la forma la exige', () => {
    expect(validarCobro({ ...FORMULARIO, cuenta_cobro_id: '' }, { saldo: 1000, exigeCuenta: true }).cuenta_cobro_id).toBeDefined()
    expect(validarCobro({ ...FORMULARIO, cuenta_cobro_id: '' }, { saldo: 1000, exigeCuenta: false }).cuenta_cobro_id).toBeUndefined()
  })

  it('pide el importe y lo valida como número mayor a cero', () => {
    expect(validarCobro(FORMULARIO_COBRO_VACIO, { saldo: 1000, exigeCuenta: false }).importe).toBeDefined()
    expect(validarCobro({ ...FORMULARIO, importe: 'cero' }, { saldo: 1000, exigeCuenta: false }).importe).toBeDefined()
    expect(validarCobro({ ...FORMULARIO, importe: '0' }, { saldo: 1000, exigeCuenta: false }).importe).toBeDefined()
    expect(validarCobro({ ...FORMULARIO, importe: '400,555' }, { saldo: 1000, exigeCuenta: false }).importe).toBeDefined()
  })

  it('no deja pasar un importe mayor al saldo pendiente', () => {
    const errores = validarCobro({ ...FORMULARIO, importe: '1000,01' }, { saldo: 1000, exigeCuenta: false })
    expect(errores.importe).toContain('saldo')
    expect(validarCobro({ ...FORMULARIO, importe: '1000' }, { saldo: 1000, exigeCuenta: false }).importe).toBeUndefined()
  })
})

describe('aParametrosRegistrar', () => {
  it('manda el importe como número y los vacíos como null', () => {
    expect(aParametrosRegistrar('k-1', FORMULARIO)).toEqual({
      p_comprobante_id: 'k-1',
      p_importe: 400.5,
      p_forma_pago_id: 'f-2',
      p_cuenta_cobro_id: 'c-1',
      p_actualizado_en: null,
    })
    expect(aParametrosRegistrar('k-1', { ...FORMULARIO, cuenta_cobro_id: ' ' }).p_cuenta_cobro_id).toBeNull()
  })

  it('no manda un importe que no es número', () => {
    expect(() => aParametrosRegistrar('k-1', { ...FORMULARIO, importe: 'cero' })).toThrow(/número/)
  })
})

describe('llamadas a la base', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rpc.mockResolvedValue({ data: null, error: null })
  })

  it('registrar, listar y consultar el saldo llaman a su RPC', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { id: 'b-1', importe: 400.5 }, error: null })
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null })
    mocks.rpc.mockResolvedValueOnce({ data: [{ total: 1000, cobrado: 400.5, saldo: 599.5 }], error: null })
    await registrarCobro('k-1', FORMULARIO)
    await cobrosDeComprobante('k-1')
    await saldoComprobante('k-1')

    expect(mocks.rpc.mock.calls.map(([nombre]) => nombre)).toEqual([
      'registrar_cobro',
      'cobros_de_comprobante',
      'saldo_comprobante',
    ])
    expect(mocks.rpc).toHaveBeenCalledWith('cobros_de_comprobante', { p_comprobante_id: 'k-1' })
    expect(mocks.rpc).toHaveBeenCalledWith('saldo_comprobante', { p_id: 'k-1' })
    expect(mocks.rpc).toHaveBeenCalledWith('registrar_cobro', {
      p_comprobante_id: 'k-1',
      p_importe: 400.5,
      p_forma_pago_id: 'f-2',
      p_cuenta_cobro_id: 'c-1',
      p_actualizado_en: null,
    })
  })

  it('el importe del cobro y el de la lista llegan como número', async () => {
    mocks.rpc.mockResolvedValue({ data: { id: 'b-1', importe: '400.50' }, error: null })
    expect((await registrarCobro('k-1', FORMULARIO)).importe).toBe(400.5)

    mocks.rpc.mockResolvedValue({
      data: [{ id: 'b-1', fecha: '2026-12-01', forma_pago: 'Transferencia', cuenta_cobro: 'Banco Uno', importe: '400.50', origen: 'manual', conciliado: false, aprobado_por: null, registrado_por: 'mostrador-uno@example.com' }],
      error: null,
    })
    const cobros = await cobrosDeComprobante('k-1')
    expect(cobros[0].importe).toBe(400.5)
    expect(cobros[0].forma_pago).toBe('Transferencia')
  })

  it('propaga el error de la base para que la pantalla lo muestre', async () => {
    const error = { code: 'P0001', message: 'x' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(registrarCobro('k-1', FORMULARIO)).rejects.toBe(error)
    await expect(cobrosDeComprobante('k-1')).rejects.toBe(error)
    await expect(saldoComprobante('k-1')).rejects.toBe(error)
  })
})

describe('errores de la base', () => {
  it('el hint dice qué campo marcar', () => {
    expect(errorDeCampoCobro({ code: '22023', hint: 'importe', message: 'El importe tiene que ser mayor a cero' })).toEqual({
      campo: 'importe',
      mensaje: 'El importe tiene que ser mayor a cero',
    })
    expect(errorDeCampoCobro({ code: '22023', hint: 'cuenta_cobro_id', message: 'La forma de pago exige una cuenta de cobro' })?.campo).toBe('cuenta_cobro_id')
    expect(errorDeCampoCobro({ code: '42501', message: 'x' })).toBeNull()
    expect(errorDeCampoCobro({ code: '22023', message: 'sin hint' })).toBeNull()
  })

  it('traduce los códigos a castellano sin filtrar el mensaje crudo', () => {
    expect(mensajeDeErrorCobro({ code: '42501' }, 'x')).toContain('permiso')
    expect(mensajeDeErrorCobro({ code: 'P0002' }, 'x')).toContain('no existe')
    expect(mensajeDeErrorCobro({ code: 'P0001' }, 'x')).toContain('saldo')
    expect(mensajeDeErrorCobro({ code: '55000' }, 'x')).toContain('no admite cobros')
    expect(mensajeDeErrorCobro({ code: '22023', message: 'El importe tiene que ser mayor a cero' }, 'x')).toBe('El importe tiene que ser mayor a cero')
    expect(mensajeDeErrorCobro({ code: 'XX000', message: 'detalle técnico' }, 'No pudimos registrar el cobro')).toBe('No pudimos registrar el cobro')
  })
})
