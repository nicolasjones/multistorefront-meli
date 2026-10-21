import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), organizacionId: 'org-1' as string | null }))

vi.mock('./useOrganizacionActiva', () => ({
  useOrganizacionActiva: () => ({ organizacionActiva: mocks.organizacionId ? { id: mocks.organizacionId } : null, isLoading: false }),
}))
vi.mock('../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { useHistorialVentasCobros } from './useHistorialVentasCobros'

const fila = (n: number, total = 2) => ({
  id: `v-${n}`, numero: `A-${n}`, total_filas: total, fecha_desde: '2020-01-01', fecha_hasta: '2020-03-01',
})

describe('useHistorialVentasCobros', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
    mocks.organizacionId = 'org-1'
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('llama a la RPC del tipo, separa los totales de las filas y expone Desde/Hasta', async () => {
    mocks.rpc.mockResolvedValue({ data: [fila(1, 60), fila(2, 60)], error: null })
    const { result } = renderHook(() => useHistorialVentasCobros('ventas', 'e-1'))
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mocks.rpc).toHaveBeenCalledWith('listar_historial_ventas', { p_busqueda: null, p_empresa_id: 'e-1', p_pagina: 1, p_tamano: 25 })
    expect(result.current.total).toBe(60)
    expect(result.current.desde).toBe('2020-01-01')
    expect(result.current.hasta).toBe('2020-03-01')
    expect(result.current.filas).toHaveLength(2)
    expect(result.current.filas[0]).not.toHaveProperty('total_filas')
  })

  it('cobros usa su propia RPC y sin tienda manda null', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    const { result } = renderHook(() => useHistorialVentasCobros('cobros', ''))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mocks.rpc).toHaveBeenCalledWith('listar_historial_cobros', expect.objectContaining({ p_empresa_id: null }))
    expect(result.current.total).toBe(0)
    expect(result.current.desde).toBeNull()
  })

  it('la búsqueda espera a que se deje de tipear, se envía recortada y reinicia la página', async () => {
    mocks.rpc.mockResolvedValue({ data: [fila(1, 80)], error: null })
    const { result } = renderHook(() => useHistorialVentasCobros('ventas', ''))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    act(() => result.current.setPagina(3))
    await waitFor(() => expect(mocks.rpc).toHaveBeenLastCalledWith('listar_historial_ventas', expect.objectContaining({ p_pagina: 3 })))
    const llamadas = mocks.rpc.mock.calls.length
    act(() => result.current.setTexto('  50%_  '))
    expect(mocks.rpc).toHaveBeenCalledTimes(llamadas)
    await waitFor(() => expect(mocks.rpc).toHaveBeenLastCalledWith('listar_historial_ventas', { p_busqueda: '50%_', p_empresa_id: null, p_pagina: 1, p_tamano: 25 }))
  })

  it('un error de la RPC no deja filas viejas y permite reintentar', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    const { result } = renderHook(() => useHistorialVentasCobros('ventas', ''))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.filas).toEqual([])
    mocks.rpc.mockResolvedValueOnce({ data: [fila(1, 1)], error: null })
    await act(async () => { await result.current.refetch() })
    expect(result.current.isError).toBe(false)
    expect(result.current.filas).toHaveLength(1)
  })

  it('una excepción de red se trata como error', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('red'))
    const { result } = renderHook(() => useHistorialVentasCobros('ventas', ''))
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
