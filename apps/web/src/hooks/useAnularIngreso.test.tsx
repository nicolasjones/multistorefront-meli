import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { useAnularIngreso } from './useAnularIngreso'

describe('useAnularIngreso', () => {
  beforeEach(() => vi.clearAllMocks())

  it('llama a la RPC con el ingreso y el motivo recortado', async () => {
    mocks.rpc.mockResolvedValue({ data: { id: 'ingreso-1', estado: 'anulado' }, error: null })
    const { result } = renderHook(() => useAnularIngreso())
    await act(async () => {
      const respuesta = await result.current.anular('ingreso-1', '  Carga equivocada  ')
      expect(respuesta.ok).toBe(true)
    })
    expect(mocks.rpc).toHaveBeenCalledWith('anular_ingreso_mercaderia', {
      p_ingreso: 'ingreso-1',
      p_motivo: 'Carga equivocada',
    })
  })

  it('devuelve el error de la RPC sin lanzar', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'sin permiso' } })
    const { result } = renderHook(() => useAnularIngreso())
    await act(async () => {
      const respuesta = await result.current.anular('ingreso-1', 'Corrección')
      expect(respuesta.ok).toBe(false)
    })
  })
})
