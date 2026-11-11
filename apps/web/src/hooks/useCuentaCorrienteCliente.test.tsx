import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { useCuentaCorrienteCliente } from './useCuentaCorrienteCliente'

describe('useCuentaCorrienteCliente', () => {
  beforeEach(() => vi.clearAllMocks())

  it('llama a la RPC y normaliza los numeric que llegan como texto', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        id: 'a-1', saldo_total: '3310.00', comprobantes: '1', numero: '0001-00000001', fecha: '2026-10-15',
        tipo: 'factura', estado: 'deuda', total_con_iva: '1210.00', cobrado: '0.00', saldo: '1210.00',
      }],
      error: null,
    })
    const { result } = renderHook(() => useCuentaCorrienteCliente('c-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mocks.rpc).toHaveBeenCalledWith('cuenta_corriente_cliente', { p_cliente_id: 'c-1' })
    expect(result.current.saldo).toBe(3310)
    expect(result.current.documentos).toHaveLength(1)
    expect(result.current.documentos[0].id).toBe('a-1')
    expect(result.current.documentos[0].saldo).toBe(1210)
  })

  it('la fila de encabezado sin documentos deja el saldo en 0 y ninguna fila', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        id: null, saldo_total: 0, comprobantes: 0, numero: null, fecha: null, tipo: null, estado: null,
        total_con_iva: null, cobrado: null, saldo: null,
      }],
      error: null,
    })
    const { result } = renderHook(() => useCuentaCorrienteCliente('c-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.documentos).toEqual([])
    expect(result.current.saldo).toBe(0)
  })

  it('un error (o una excepción) deja isError y no rompe', async () => {
    mocks.rpc.mockRejectedValue(new Error('red'))
    const { result } = renderHook(() => useCuentaCorrienteCliente('c-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isError).toBe(true)
    expect(result.current.documentos).toEqual([])
    expect(result.current.saldo).toBe(0)
  })
})
