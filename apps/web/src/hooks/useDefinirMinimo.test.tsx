import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase', () => ({ supabaseClient: { rpc } }))

import { useDefinirMinimo } from './useDefinirMinimo'

describe('useDefinirMinimo', () => {
  beforeEach(() => {
    rpc.mockReset()
    rpc.mockResolvedValue({ data: {}, error: null })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('ignora un segundo envío en el mismo tick', async () => {
    const { result } = renderHook(() => useDefinirMinimo())
    let resultados: unknown[] = []
    await act(async () => {
      resultados = await Promise.all([result.current.definir('p-1', '3'), result.current.definir('p-1', '3')])
    })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(resultados).toEqual([{ ok: true }, null])
  })

  it('libera el guard tras un error y permite reintentar', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'boom' } })
    const { result } = renderHook(() => useDefinirMinimo())
    let primero: unknown
    let segundo: unknown
    await act(async () => { primero = await result.current.definir('p-1', '3') })
    await act(async () => { segundo = await result.current.definir('p-1', '3') })
    expect(primero).toMatchObject({ ok: false })
    expect(segundo).toEqual({ ok: true })
  })
})
