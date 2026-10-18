import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { useComprasCliente } from './useComprasCliente'

describe('useComprasCliente', () => {
  beforeEach(() => vi.clearAllMocks())

  it('llama a la RPC y normaliza numeric/bigint que llegan como texto', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ facturado_anio: '4000.00', numero: '0001-1', fecha: '2026-10-15', tipo: 'factura', estado: 'emitida', total_sin_iva: '1000.00', total_filas: '1' }],
      error: null,
    })
    const { result } = renderHook(() => useComprasCliente('c-1', 2, 10))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mocks.rpc).toHaveBeenCalledWith('compras_de_cliente', { p_cliente_id: 'c-1', p_pagina: 2, p_tamano: 10 })
    expect(result.current.facturadoAnio).toBe(4000)
    expect(result.current.total).toBe(1)
    expect(result.current.compras[0].total_sin_iva).toBe(1000)
  })

  it('la fila centinela aporta $ 0 y ninguna compra', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ facturado_anio: 0, numero: null, fecha: null, tipo: null, estado: null, total_sin_iva: null, total_filas: 0 }],
      error: null,
    })
    const { result } = renderHook(() => useComprasCliente('c-1', 1, 10))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.compras).toEqual([])
    expect(result.current.facturadoAnio).toBe(0)
    expect(result.current.total).toBe(0)
  })

  it('un error (o una excepción) deja isError y no rompe', async () => {
    mocks.rpc.mockRejectedValue(new Error('red'))
    const { result } = renderHook(() => useComprasCliente('c-1', 1, 10))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isError).toBe(true)
    expect(result.current.compras).toEqual([])
  })
})
