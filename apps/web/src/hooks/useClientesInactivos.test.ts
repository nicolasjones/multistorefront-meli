import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), organizacionId: 'org-1' as string | null }))

vi.mock('./useOrganizacionActiva', () => ({
  useOrganizacionActiva: () => ({ organizacionActiva: mocks.organizacionId ? { id: mocks.organizacionId } : null, isLoading: false }),
}))
vi.mock('../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { useClientesInactivos, type ParametrosInactivos } from './useClientesInactivos'

const base: ParametrosInactivos = { dias: 90, tipo: null, incluirConsumidorFinal: false, empresaId: null, pagina: 1, tamano: 25 }
const fila = (n: number, total = 2) => ({
  cliente_id: `c-${n}`, numero: String(n), nombre: `Cliente ${n}`, tipo: 'minorista', ultima_compra: '2026-06-01',
  dias_sin_comprar: '150', comprobantes: '3', facturado: '1234.50', total_filas: String(total),
})

describe('useClientesInactivos', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
    mocks.organizacionId = 'org-1'
  })

  it('llama a clientes_inactivos con los argumentos y normaliza las filas y el total', async () => {
    mocks.rpc.mockResolvedValue({ data: [fila(1, 60), fila(2, 60)], error: null })
    const { result } = renderHook(() => useClientesInactivos({ ...base, dias: 30, tipo: 'mayorista', empresaId: 'e-1', pagina: 2 }))
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mocks.rpc).toHaveBeenCalledWith('clientes_inactivos', {
      p_dias: 30, p_tipo: 'mayorista', p_incluir_consumidor_final: false, p_pagina: 2, p_tamano: 25, p_empresa_id: 'e-1',
    })
    expect(result.current.total).toBe(60)
    expect(result.current.filas[0]).toMatchObject({ numero: 1, dias_sin_comprar: 150, comprobantes: 3, facturado: 1234.5 })
    expect(result.current.filas[0]).not.toHaveProperty('total_filas')
  })

  it('sin resultados: total 0 y sin error', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    const { result } = renderHook(() => useClientesInactivos(base))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.filas).toEqual([])
    expect(result.current.total).toBe(0)
    expect(result.current.isError).toBe(false)
  })

  it('error de la RPC o excepción: isError y sin filas; refetch reintenta', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } })
    const { result } = renderHook(() => useClientesInactivos(base))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.filas).toEqual([])
    mocks.rpc.mockRejectedValueOnce(new Error('red'))
    await result.current.refetch()
    await waitFor(() => expect(result.current.isError).toBe(true))
    mocks.rpc.mockResolvedValueOnce({ data: [fila(1)], error: null })
    await result.current.refetch()
    await waitFor(() => expect(result.current.isError).toBe(false))
    expect(result.current.filas).toHaveLength(1)
  })

  it('recarga al cambiar la tienda (empresa activa)', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    const { result, rerender } = renderHook(({ p }) => useClientesInactivos(p), { initialProps: { p: base } })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    rerender({ p: { ...base, empresaId: 'e-2' } })
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2))
    expect(mocks.rpc.mock.calls[1][1].p_empresa_id).toBe('e-2')
  })

  it('al cambiar la tienda no muestra filas ni total de la anterior mientras llega la respuesta', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ ...fila(1), total_filas: 7 }], error: null })
    const { result, rerender } = renderHook(({ p }) => useClientesInactivos(p), { initialProps: { p: { ...base, empresaId: 'e-1' } } })
    await waitFor(() => expect(result.current.filas).toHaveLength(1))
    expect(result.current.total).toBe(7)
    mocks.rpc.mockReturnValueOnce(new Promise(() => {}))
    rerender({ p: { ...base, empresaId: 'e-2' } })
    expect(result.current.isLoading).toBe(true)
    expect(result.current.filas).toEqual([])
    expect(result.current.total).toBe(0)
  })

  it('al cambiar la tienda no arrastra el error de la anterior mientras llega la respuesta', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } })
    const { result, rerender } = renderHook(({ p }) => useClientesInactivos(p), { initialProps: { p: { ...base, empresaId: 'e-1' } } })
    await waitFor(() => expect(result.current.isError).toBe(true))
    mocks.rpc.mockReturnValueOnce(new Promise(() => {}))
    rerender({ p: { ...base, empresaId: 'e-2' } })
    expect(result.current.isLoading).toBe(true)
    expect(result.current.isError).toBe(false)
  })
})
