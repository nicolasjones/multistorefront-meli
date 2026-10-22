import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), organizacionId: 'org-1' as string | null }))

vi.mock('./useOrganizacionActiva', () => ({
  useOrganizacionActiva: () => ({ organizacionActiva: mocks.organizacionId ? { id: mocks.organizacionId } : null, isLoading: false }),
}))
vi.mock('../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { useHistorialCotizaciones } from './useHistorialCotizaciones'

const fila = (n: number, total = 2) => ({
  id: `c-${n}`, fecha: '2020-03-05', dolar_comprador: '64.25', dolar_vendedor: 68.75, cargado_por: 'Emilse', total_filas: total,
})

describe('useHistorialCotizaciones', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
    mocks.organizacionId = 'org-1'
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('llama a la RPC sin tienda, separa el total y convierte los importes a número', async () => {
    mocks.rpc.mockResolvedValue({ data: [fila(1, 60), fila(2, 60)], error: null })
    const { result } = renderHook(() => useHistorialCotizaciones())
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mocks.rpc).toHaveBeenCalledWith('listar_historial_cotizaciones', { p_busqueda: null, p_pagina: 1, p_tamano: 25 })
    expect(result.current.total).toBe(60)
    expect(result.current.filas).toHaveLength(2)
    expect(result.current.filas[0]).not.toHaveProperty('total_filas')
    expect(result.current.filas[0].dolar_comprador).toBe(64.25)
  })

  it('la búsqueda espera a que se deje de tipear, se envía recortada y reinicia la página', async () => {
    mocks.rpc.mockResolvedValue({ data: [fila(1, 80)], error: null })
    const { result } = renderHook(() => useHistorialCotizaciones())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    act(() => result.current.setPagina(3))
    await waitFor(() => expect(mocks.rpc).toHaveBeenLastCalledWith('listar_historial_cotizaciones', expect.objectContaining({ p_pagina: 3 })))
    const llamadas = mocks.rpc.mock.calls.length
    act(() => result.current.setTexto('  03/2020 '))
    expect(mocks.rpc).toHaveBeenCalledTimes(llamadas)
    await waitFor(() => expect(mocks.rpc).toHaveBeenLastCalledWith('listar_historial_cotizaciones', { p_busqueda: '03/2020', p_pagina: 1, p_tamano: 25 }))
  })

  it('un error de la RPC no deja filas viejas y permite reintentar', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    const { result } = renderHook(() => useHistorialCotizaciones())
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.filas).toEqual([])
    mocks.rpc.mockResolvedValueOnce({ data: [fila(1, 1)], error: null })
    await act(async () => { await result.current.refetch() })
    expect(result.current.isError).toBe(false)
    expect(result.current.filas).toHaveLength(1)
  })

  it('una excepción de red se trata como error', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('red'))
    const { result } = renderHook(() => useHistorialCotizaciones())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('si la página queda fuera de rango vuelve a la página 1', async () => {
    mocks.rpc.mockResolvedValue({ data: [fila(1, 80)], error: null })
    const { result } = renderHook(() => useHistorialCotizaciones())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    act(() => result.current.setPagina(4))
    await waitFor(() => expect(result.current.pagina).toBe(1))
  })

  it('última petición gana: una respuesta lenta anterior no pisa la búsqueda nueva', async () => {
    let resolverLenta: (valor: unknown) => void = () => {}
    mocks.rpc.mockImplementation((_rpc: string, args: { p_busqueda: string | null }) =>
      args.p_busqueda === null
        ? new Promise((resolver) => { resolverLenta = resolver })
        : Promise.resolve({ data: [fila(9, 1)], error: null }))
    const { result } = renderHook(() => useHistorialCotizaciones())
    act(() => result.current.setTexto('2020'))
    await waitFor(() => expect(result.current.filas.map((f) => f.id)).toEqual(['c-9']), { timeout: 3000 })
    await act(async () => { resolverLenta({ data: [fila(1, 5), fila(2, 5)], error: null }) })
    expect(result.current.filas.map((f) => f.id)).toEqual(['c-9'])
    expect(result.current.total).toBe(1)
  })
})
