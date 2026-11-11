import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), organizacionId: 'org-1' as string | null }))

vi.mock('./useOrganizacionActiva', () => ({
  useOrganizacionActiva: () => ({ organizacionActiva: mocks.organizacionId ? { id: mocks.organizacionId } : null, isLoading: false }),
}))
vi.mock('../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { useListarFaltantes, type FiltrosFaltantes } from './useListarFaltantes'

const base: FiltrosFaltantes = { empresaId: null, pagina: 1, tamano: 10 }

const fila = (id: string, empresa: string, total = 1) => ({
  id,
  empresa_id: `emp-${empresa}`,
  empresa,
  cliente: 'Cliente',
  producto: 'Producto',
  sku: 'SKU-1',
  cantidad_faltante: 2,
  linea_orden: 1,
  comprobante_id: `comp-${id}`,
  comprobante: `0003-${id}`,
  fecha: '2026-10-01',
  desde: '2026-10-01T10:00:00Z',
  stock_estado: 'disponible',
  stock_disponible: 5,
  filas: total,
})

describe('useListarFaltantes', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
    mocks.organizacionId = 'org-1'
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('pide el listado con el filtro de tienda y la página', async () => {
    mocks.rpc.mockResolvedValue({ data: [fila('1', 'San Javucho', 12)], error: null })
    const { result } = renderHook(() => useListarFaltantes({ ...base, empresaId: 'emp-1', pagina: 2 }))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mocks.rpc).toHaveBeenCalledWith('listar_faltantes', { p_empresa_id: 'emp-1', p_pagina: 2, p_tamano: 10 })
    expect(result.current.total).toBe(12)
    expect(result.current.faltantes).toHaveLength(1)
  })

  it('no muestra filas de la empresa anterior al cambiar de tienda', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [fila('1', 'San Javucho', 1)], error: null })
    const { result, rerender } = renderHook((filtros: FiltrosFaltantes) => useListarFaltantes(filtros), {
      initialProps: { ...base, empresaId: 'emp-1' },
    })
    await waitFor(() => expect(result.current.faltantes).toHaveLength(1))
    expect(result.current.faltantes[0].empresa).toBe('San Javucho')

    let resolver: (v: unknown) => void = () => {}
    mocks.rpc.mockImplementationOnce(() => new Promise((r) => { resolver = r }))
    rerender({ ...base, empresaId: 'emp-2' })
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2))
    expect(result.current.faltantes).toEqual([])
    expect(result.current.total).toBe(0)

    resolver({ data: [fila('2', 'Centro', 1)], error: null })
    await waitFor(() => expect(result.current.faltantes).toHaveLength(1))
    expect(result.current.faltantes[0].empresa).toBe('Centro')
  })
})
