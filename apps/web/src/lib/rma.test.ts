import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import {
  FILTROS_RMA_VACIOS, MENSAJE_ERROR_CAMBIO_ESTADO_RMA, MENSAJE_ERROR_RESOLVER_RMA, MENSAJE_ERROR_RMA, MENSAJE_RMA_REGISTRADA, cambiarEstadoRma, lineasDeComprobante,
  listarRma, mensajeDeCambioEstadoRma, mensajeDeResolucionRma, mensajeDeRma, registrarRma, reingresarStockRma, vincularNotaCreditoRma,
} from './rma'

beforeEach(() => { mocks.rpc.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => vi.restoreAllMocks())

describe('listarRma', () => {
  it('manda nulos para los filtros vacíos y recorta la búsqueda', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await listarRma({ ...FILTROS_RMA_VACIOS, busqueda: '  ' }, 2, 5)
    expect(mocks.rpc).toHaveBeenCalledWith('listar_rma', { p_busqueda: null, p_forma_rma: null, p_estado: null, p_empresa_id: null, p_pagina: 2, p_tamano: 5 })
    await listarRma({ busqueda: ' abc ', formaRma: 'cambio_directo', empresaId: 'e1' }, 1)
    expect(mocks.rpc).toHaveBeenLastCalledWith('listar_rma', expect.objectContaining({ p_busqueda: 'abc', p_forma_rma: 'cambio_directo', p_empresa_id: 'e1', p_tamano: 8 }))
  })

  it('convierte la cantidad a número, quita la columna de conteo y toma el total de la primera fila', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: 'r1', cantidad: '3', filas: '12' }, { id: 'r2', cantidad: 1, filas: '12' }], error: null })
    const pagina = await listarRma(FILTROS_RMA_VACIOS, 1)
    expect(pagina.total).toBe(12)
    expect(pagina.devoluciones).toEqual([{ id: 'r1', cantidad: 3 }, { id: 'r2', cantidad: 1 }])
  })

  it('sin filas el total es 0 y un error se propaga', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await expect(listarRma(FILTROS_RMA_VACIOS, 1)).resolves.toEqual({ devoluciones: [], total: 0 })
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(listarRma(FILTROS_RMA_VACIOS, 1)).rejects.toMatchObject({ code: '42501' })
  })
})

describe('registrarRma', () => {
  const entrada = { comprobanteId: 'c1', lineaId: 'l1', cantidad: 2, formaRma: 'cambio_directo' as const, motivo: '  roto ', observaciones: '   ' }

  it('arma la línea, recorta el motivo y manda observaciones vacías como null', async () => {
    mocks.rpc.mockResolvedValue({ data: { id: 'r1', numero: 'D-1' }, error: null })
    await expect(registrarRma(entrada)).resolves.toEqual({ id: 'r1', numero: 'D-1' })
    expect(mocks.rpc).toHaveBeenCalledWith('registrar_rma', {
      p_comprobante_id: 'c1', p_lineas: [{ linea_id: 'l1', cantidad: 2 }], p_forma_rma: 'cambio_directo', p_motivo: 'roto', p_observaciones: null,
    })
  })

  it('rechaza una respuesta incompleta', async () => {
    mocks.rpc.mockResolvedValue({ data: { id: 'r1' }, error: null })
    await expect(registrarRma(entrada)).rejects.toThrow(/no devolvió/)
  })
})

describe('mensajes', () => {
  it('mensajeDeRma muestra solo los mensajes de la RPC y traduce inexistente', () => {
    expect(mensajeDeRma({ code: '22023', message: 'No podés devolver más de lo vendido.' })).toBe('No podés devolver más de lo vendido.')
    expect(mensajeDeRma({ code: '22023', message: 'invalid input' })).toBe(MENSAJE_ERROR_RMA)
    expect(mensajeDeRma({ code: 'P0002' })).toMatch(/factura no existe/)
  })

  it('mensajeDeCambioEstadoRma cubre conflicto, permiso, inexistente y genérico', () => {
    expect(mensajeDeCambioEstadoRma({ code: '40001' })).toMatch(/Otra persona/)
    expect(mensajeDeCambioEstadoRma({ code: '42501', message: 'Tu rol no puede cambiar el estado.' })).toBe('Tu rol no puede cambiar el estado.')
    expect(mensajeDeCambioEstadoRma({ code: '42501', message: 'permission denied' })).toBe(MENSAJE_ERROR_CAMBIO_ESTADO_RMA)
    expect(mensajeDeCambioEstadoRma({ code: 'P0002' })).toMatch(/ya no existe/)
  })

  it('mensajeDeResolucionRma admite los prefijos de resolución y oculta el resto', () => {
    expect(mensajeDeResolucionRma({ code: 'P0001', message: 'La devolución ya se resolvió.' })).toBe('La devolución ya se resolvió.')
    expect(mensajeDeResolucionRma({ code: 'P0001', message: 'syntax error' })).toBe(MENSAJE_ERROR_RESOLVER_RMA)
    expect(mensajeDeResolucionRma({ code: 'P0002' })).toMatch(/ya no existe/)
  })

  it('los mensajes de éxito usan la etiqueta de la forma o del estado', () => {
    expect(MENSAJE_RMA_REGISTRADA('devolucion_importe')).toBe('Devolución registrada · Devolución de importe')
  })
})

describe('otras llamadas', () => {
  it('lineasDeComprobante convierte cantidades y tolera la ausencia de líneas', async () => {
    mocks.rpc.mockResolvedValue({ data: { lineas: [{ id: 'l1', descripcion: 'Cable', cantidad: '2.5' }] }, error: null })
    await expect(lineasDeComprobante('c1')).resolves.toEqual([{ id: 'l1', descripcion: 'Cable', cantidad: 2.5 }])
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await expect(lineasDeComprobante('c1')).resolves.toEqual([])
  })

  it('cambiarEstadoRma, vincularNotaCreditoRma y reingresarStockRma validan la respuesta', async () => {
    mocks.rpc.mockResolvedValue({ data: { id: 'r1', estado: 'cerrada' }, error: null })
    await expect(cambiarEstadoRma('r1', 'cerrada', 'v1')).resolves.toEqual({ id: 'r1', estado: 'cerrada' })
    expect(mocks.rpc).toHaveBeenLastCalledWith('cambiar_estado_rma', { p_id: 'r1', p_estado: 'cerrada', p_actualizado_en: 'v1' })
    await vincularNotaCreditoRma('r1', 100, ' Reintegro ')
    expect(mocks.rpc).toHaveBeenLastCalledWith('vincular_nota_credito_rma', { p_rma_id: 'r1', p_tipo: 'devolucion_importe', p_lineas: [{ importe_sin_iva: 100 }], p_concepto: 'Reintegro' })
    await reingresarStockRma('r1')
    expect(mocks.rpc).toHaveBeenLastCalledWith('reingresar_stock_rma', { p_rma_id: 'r1', p_deposito_id: null })
    mocks.rpc.mockResolvedValue({ data: { id: 'r1' }, error: null })
    await expect(cambiarEstadoRma('r1', 'x', 'v')).rejects.toThrow(/no devolvió/)
    await expect(reingresarStockRma('r1')).rejects.toThrow(/no devolvió/)
  })
})
