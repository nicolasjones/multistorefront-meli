import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import {
  type CuentaCobro,
  FORMULARIO_CUENTA_COBRO_VACIO,
  aFormulario,
  aParametrosActualizar,
  aParametrosCrear,
  actualizarCuentaCobro,
  cambiarEstadoCuentaCobro,
  crearCuentaCobro,
  esConflicto,
  mensajeDeError,
  validarCuentaCobro,
} from './cuentasCobro'

const VALIDO = {
  ...FORMULARIO_CUENTA_COBRO_VACIO,
  nombre: '  Banco Uno ···7370  ',
  titular: 'Comercial Uno SRL',
  cuit: '30-70123456-8',
  banco: 'Banco Uno',
  cbu: '0170 0992 2000 0067 7973 70',
  empresaIds: ['e-1'],
}

const CUENTA: CuentaCobro = {
  id: 'c-1', nombre: 'Banco Uno', titular: 'Comercial Uno SRL', banco: null, cbu: '0170099220000067797370',
  cuit: '30701234568', alias: null, tipo: 'caja_ahorro', moneda: 'USD', orden: 3, activa: false, notas: null,
  updated_at: '2026-01-01T10:00:00.123456+00:00', empresas: [{ id: 'e-2', nombre: 'Mundo JC' }],
}

describe('validarCuentaCobro', () => {
  it('acepta una cuenta completa con CBU y CUIT válidos', () => {
    expect(validarCuentaCobro(VALIDO)).toEqual({})
  })

  it('pide los datos obligatorios', () => {
    expect(validarCuentaCobro(FORMULARIO_CUENTA_COBRO_VACIO)).toEqual({
      nombre: 'Ingresá el nombre de la cuenta.',
      titular: 'Ingresá el titular.',
      cuit: 'Ingresá el CUIT.',
      cbu: 'Ingresá el CBU o CVU.',
    })
  })

  it('rechaza un CBU y un CUIT con dígito verificador inválido', () => {
    const errores = validarCuentaCobro({ ...VALIDO, cbu: '0170099220000067797371', cuit: '20123456787' })
    expect(errores.cbu).toContain('dígitos verificadores')
    expect(errores.cuit).toContain('dígito verificador')
  })

  it('rechaza un orden que no es un entero no negativo', () => {
    expect(validarCuentaCobro({ ...VALIDO, orden: '-1' }).orden).toBeDefined()
    expect(validarCuentaCobro({ ...VALIDO, orden: '1.5' }).orden).toBeDefined()
    expect(validarCuentaCobro({ ...VALIDO, orden: '' }).orden).toBeDefined()
  })

  it('limita el largo de los textos', () => {
    expect(validarCuentaCobro({ ...VALIDO, alias: 'a'.repeat(61) }).alias).toBe('Máximo 60 caracteres.')
  })
})

describe('parámetros de las RPC', () => {
  it('crear manda CUIT y CBU solo con dígitos, textos recortados y vacíos como null', () => {
    expect(aParametrosCrear(VALIDO)).toEqual({
      p_nombre: 'Banco Uno ···7370', p_titular: 'Comercial Uno SRL', p_cuit: '30701234568', p_banco: 'Banco Uno',
      p_alias: null, p_cbu: '0170099220000067797370', p_tipo: 'cuenta_corriente', p_moneda: 'ARS', p_orden: 0,
      p_activa: true, p_notas: null, p_empresa_ids: ['e-1'],
    })
  })

  it('actualizar suma el id y el updated_at leído (bloqueo optimista)', () => {
    expect(aParametrosActualizar(VALIDO, { id: 'c-1', actualizadoEn: 'ts' })).toMatchObject({ p_id: 'c-1', p_actualizado_en: 'ts', p_cbu: '0170099220000067797370' })
  })

  it('aFormulario carga la cuenta existente, con las empresas por id', () => {
    expect(aFormulario(CUENTA)).toMatchObject({ tipo: 'caja_ahorro', moneda: 'USD', orden: '3', activa: false, banco: '', empresaIds: ['e-2'] })
  })
})

describe('llamadas a la base', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rpc.mockResolvedValue({ data: null, error: null })
  })

  it('crear, actualizar y cambiar estado llaman a su RPC', async () => {
    await crearCuentaCobro(VALIDO)
    await actualizarCuentaCobro(VALIDO, { id: 'c-1', actualizadoEn: 'ts' })
    await cambiarEstadoCuentaCobro('c-1', false)
    expect(mocks.rpc.mock.calls.map(([nombre]) => nombre)).toEqual(['crear_cuenta_cobro', 'actualizar_cuenta_cobro', 'cambiar_estado_cuenta_cobro'])
    expect(mocks.rpc).toHaveBeenLastCalledWith('cambiar_estado_cuenta_cobro', { p_id: 'c-1', p_activa: false })
  })

  it('propaga el error de la base para que la pantalla lo muestre', async () => {
    const error = { code: '42501', message: 'x' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(cambiarEstadoCuentaCobro('c-1', true)).rejects.toBe(error)
  })
})

describe('mensajeDeError', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined))

  it('traduce los códigos de la base a castellano sin filtrar el mensaje crudo', () => {
    expect(esConflicto({ code: '40001' })).toBe(true)
    expect(mensajeDeError({ code: '40001' }, 'x')).toContain('Otra persona modificó')
    expect(mensajeDeError({ code: '42501', message: 'new row violates row-level security policy' }, 'x')).toContain('Administrador')
    expect(mensajeDeError({ code: 'P0002' }, 'x')).toContain('ya no existe')
    expect(mensajeDeError({ code: '22023', message: 'detalle técnico' }, 'x')).toBe('Algún dato no es válido. Revisá el formulario e intentá de nuevo.')
    expect(mensajeDeError({ code: 'XX000', message: 'detalle técnico' }, 'No pudimos guardar')).toBe('No pudimos guardar')
  })
})
