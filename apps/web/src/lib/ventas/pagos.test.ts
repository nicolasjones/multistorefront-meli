import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import {
  conciliarPago,
  cuentasCobroMasUsadas,
  listarPagos,
  mensajeDeErrorPagos,
  resumenPagos,
  revertirConciliacionPago,
} from './pagos'

const FILA = {
  id: 'p-1',
  fecha: '2026-12-01T10:00:00+00:00',
  empresa_id: 'e-1',
  empresa: 'San Javucho',
  comprobante_id: 'f-1',
  numero: '0001-00000001',
  cliente: 'Cliente Uno',
  cuenta_cobro_id: 'c-1',
  cuenta_cobro: 'Banco Uno',
  importe: '400.00',
  aprobado_por: null,
  conciliado: false,
  saldo: '600.00',
  actualizado_en: '2026-12-01T10:00:00+00:00',
  filas: '6',
}

describe('listarPagos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('manda los filtros al servidor y convierte los importes', async () => {
    mocks.rpc.mockResolvedValue({ data: [FILA], error: null })

    const listado = await listarPagos({
      empresaId: 'e-1', cuentaCobroId: 'c-1', soloConSaldo: true, pagina: 2, tamano: 9,
    })

    expect(mocks.rpc).toHaveBeenCalledWith('listar_pagos', {
      p_empresa_id: 'e-1',
      p_cuenta_cobro_id: 'c-1',
      p_solo_con_saldo: true,
      p_pagina: 2,
      p_tamano: 9,
    })
    expect(listado.total).toBe(6)
    expect(listado.pagos).toHaveLength(1)
    expect(listado.pagos[0].importe).toBe(400)
    expect(listado.pagos[0].saldo).toBe(600)
    expect(listado.pagos[0].conciliado).toBe(false)
  })

  it('sin filas devuelve el total en cero', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })

    const listado = await listarPagos({
      empresaId: null, cuentaCobroId: null, soloConSaldo: false, pagina: 1, tamano: 9,
    })

    expect(listado.pagos).toEqual([])
    expect(listado.total).toBe(0)
  })

  it('propaga el error de la base', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denegado' } })

    await expect(listarPagos({
      empresaId: null, cuentaCobroId: null, soloConSaldo: false, pagina: 1, tamano: 9,
    })).rejects.toMatchObject({ code: '42501' })
  })
})

describe('resumenPagos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('manda la empresa y convierte los totales', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        por_conciliar_importe: '2100.00', por_conciliar_cantidad: '6',
        conciliado_importe: '400.00', conciliado_cantidad: '1', saldo_pendiente: '2500.00',
      }],
      error: null,
    })

    const resumen = await resumenPagos('e-1')

    expect(mocks.rpc).toHaveBeenCalledWith('resumen_pagos', { p_empresa_id: 'e-1' })
    expect(resumen).toEqual({
      por_conciliar_importe: 2100, por_conciliar_cantidad: 6,
      conciliado_importe: 400, conciliado_cantidad: 1, saldo_pendiente: 2500,
    })
  })

  it('sin datos devuelve ceros (la pantalla no muestra NaN)', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })

    expect(await resumenPagos(null)).toEqual({
      por_conciliar_importe: 0, por_conciliar_cantidad: 0,
      conciliado_importe: 0, conciliado_cantidad: 0, saldo_pendiente: 0,
    })
  })
})

describe('cuentasCobroMasUsadas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('manda la empresa y el límite, y convierte los usos', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ id: 'c-1', nombre: 'Banco Uno', banco: 'Galicia', activa: true, usos: '4', total_cuentas: '3' }],
      error: null,
    })

    const cuentas = await cuentasCobroMasUsadas('e-1')

    expect(mocks.rpc).toHaveBeenCalledWith('cuentas_cobro_mas_usadas', { p_empresa_id: 'e-1', p_limite: 8 })
    expect(cuentas).toEqual([{ id: 'c-1', nombre: 'Banco Uno', banco: 'Galicia', activa: true, usos: 4, total_cuentas: 3 }])
  })
})

describe('conciliar y revertir', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('conciliar manda el id y la versión leída (bloqueo optimista)', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        id: 'p-1', importe: '400.00', cuenta_cobro_id: 'c-1', aprobado_por: 'u-1',
        aprobado_por_nombre: 'Rita Ramírez', aprobado_en: '2026-12-02T10:00:00+00:00',
        actualizado_en: '2026-12-02T10:00:00+00:00',
      },
      error: null,
    })

    const pago = await conciliarPago('p-1', '2026-12-01T10:00:00+00:00')

    expect(mocks.rpc).toHaveBeenCalledWith('conciliar_pago', {
      p_id: 'p-1', p_actualizado_en: '2026-12-01T10:00:00+00:00',
    })
    expect(pago.importe).toBe(400)
    expect(pago.aprobado_por_nombre).toBe('Rita Ramírez')
  })

  it('revertir usa su propia RPC', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        id: 'p-1', importe: '400.00', cuenta_cobro_id: 'c-1', aprobado_por: null,
        aprobado_por_nombre: null, aprobado_en: null, actualizado_en: '2026-12-02T10:00:00+00:00',
      },
      error: null,
    })

    await revertirConciliacionPago('p-1', '2026-12-02T10:00:00+00:00')

    expect(mocks.rpc).toHaveBeenCalledWith('revertir_conciliacion_pago', {
      p_id: 'p-1', p_actualizado_en: '2026-12-02T10:00:00+00:00',
    })
  })
})

describe('mensajeDeErrorPagos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('traduce el conflicto de versión y el permiso', () => {
    expect(mensajeDeErrorPagos({ code: '40001' }, 'por defecto')).toContain('modificado por otra persona')
    expect(mensajeDeErrorPagos({ code: '42501' }, 'por defecto')).toContain('no puede conciliar')
  })

  it('traduce el pago que no existe y el que no tiene cuenta', () => {
    expect(mensajeDeErrorPagos({ code: 'P0002' }, 'por defecto')).toContain('no pertenece a tu organización')
    expect(mensajeDeErrorPagos({ code: '22023', message: 'Este cobro no tiene cuenta de cobro' }, 'por defecto'))
      .toBe('Este cobro no tiene cuenta de cobro')
  })

  it('con un error desconocido usa el texto por defecto', () => {
    expect(mensajeDeErrorPagos({ code: 'XX000' }, 'No pudimos conciliar el pago.')).toBe('No pudimos conciliar el pago.')
  })
})
